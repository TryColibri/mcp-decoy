import { randomUUID } from 'node:crypto';

import {
  type Server,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

import { NotFoundError } from '@/server/errors';
import { type MCPDecoyEvents, type EventBus } from '@/server/events';
import {
  type ClientInfo,
  type ServerConfig,
  type Session,
  type ToolConfig,
} from '@/shared/api';

import { type Capture, type CaptureOrigin, type Exchange } from './capture';
import { createSessionServer } from './session-server';

/** Dependencies of the session manager. */
export type SessionManagerDeps = {
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Names of every server, for the unknown-server error. */
  serverNames: () => string[];
  /** Published tools of a server, read on every request. */
  listPublishedTools: (server: string) => ToolConfig[];
  /** Where traffic is recorded. */
  capture: Capture;
  /** Mutations to react to. */
  events: EventBus<MCPDecoyEvents>;
  /** Current time. */
  now?: () => Date;
  /** Reports errors that have nowhere else to go. */
  onError?: (error: unknown) => void;
};

/** Live MCP sessions of every server, and the Streamable HTTP entry point. */
export type SessionManager = {
  /**
   * Handles an MCP request (`POST`, `GET` or `DELETE`) addressed to a server.
   *
   * @param server - Name of the server the request is addressed to.
   * @param request - The request.
   * @param exchange - The recording of the request's HTTP exchange, or `null`
   *   when it isn't recorded.
   */
  handle(
    server: string,
    request: Request,
    exchange: Exchange | null,
  ): Promise<Response>;
  /**
   * Live sessions of a server, oldest first.
   * @throws {NotFoundError} When the server doesn't exist.
   */
  list(server: string): Session[];
  /** Number of live sessions of a server. */
  count(server: string): number;
  /**
   * Closes a session server-side. Its client gets 404 on its next request.
   * @throws {NotFoundError} When the server or session doesn't exist.
   */
  close(server: string, sessionId: string): Promise<void>;
  /** Closes every session of every server. */
  closeAll(): Promise<void>;
};

type LiveSession = {
  id: string;
  server: string;
  // oxlint-disable-next-line typescript/no-deprecated -- see session-server.ts
  sdkServer: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  clientInfo: ClientInfo | null;
  requestedProtocolVersion: string | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
  connectedAt: string;
  lastSeenAt: string;
  /** The exchange of the `GET` that opened the session's standalone SSE stream. */
  standalone: Exchange | null;
};

/**
 * Creates the session manager and subscribes it to `toolsChanged` (sends
 * `notifications/tools/list_changed`) and `serverDeleted`, `serverRenamed` and `serverAuthChanged` (close sessions).
 *
 * @param deps - Server lookups, capture and event bus.
 */
export function createSessionManager({
  findServer,
  serverNames,
  listPublishedTools,
  capture,
  events,
  now = () => new Date(),
  onError = () => {},
}: SessionManagerDeps): SessionManager {
  const sessions = new Map<string, LiveSession>();

  const sessionsOf = (server: string) =>
    [...sessions.values()].filter((session) => session.server === server);

  const closeSession = async (session: LiveSession) => {
    sessions.delete(session.id);
    capture.forgetSession(session.server, session.id);
    try {
      await session.transport.close();
      await session.sdkServer.close();
    } catch (error) {
      onError(error);
    }
  };

  events.on('toolsChanged', ({ server }) => {
    for (const session of sessionsOf(server)) {
      session.sdkServer.sendToolListChanged().catch(onError);
    }
  });

  events.on('serverDeleted', ({ server }) => {
    for (const session of sessionsOf(server)) {
      void closeSession(session);
    }
  });

  events.on('serverRenamed', ({ from }) => {
    for (const session of sessionsOf(from)) {
      void closeSession(session);
    }
  });

  events.on('serverAuthChanged', ({ server }) => {
    for (const session of sessionsOf(server)) {
      void closeSession(session);
    }
  });

  const jsonRPCError = (
    status: number,
    code: number,
    message: string,
    { data, requestBody }: { data?: unknown; requestBody?: string | null } = {},
  ): Response =>
    new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code, message, ...(data === undefined ? {} : { data }) },
        id: requestIdOf(requestBody ?? null),
      }),
      { status, headers: { 'content-type': 'application/json' } },
    );

  const createSession = async (
    config: ServerConfig,
    initialize: InitializeParams,
  ): Promise<LiveSession> => {
    // The ID is generated up front so the transport and the send wrap below
    // agree on it.
    const id = randomUUID();
    const origin: CaptureOrigin = { server: config.name, sessionId: id };
    const sdkServer = createSessionServer({
      config,
      listPublishedTools: () => listPublishedTools(config.name),
    });
    const timestamp = now().toISOString();
    const session: LiveSession = {
      id,
      server: config.name,
      sdkServer,
      transport: new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => id,
        onsessioninitialized: () => {
          sessions.set(id, session);
        },
        onsessionclosed: () => {
          sessions.delete(id);
          capture.forgetSession(config.name, id);
        },
      }),
      clientInfo: initialize.clientInfo,
      requestedProtocolVersion: initialize.protocolVersion,
      protocolVersion: null,
      capabilities: initialize.capabilities,
      connectedAt: timestamp,
      lastSeenAt: timestamp,
      standalone: null,
    };

    const send = session.transport.send.bind(session.transport);
    session.transport.send = async (message, options) => {
      const answeredId = answeredIdOf(message);
      if (
        answeredId !== null &&
        answeredId === initialize.id &&
        session.protocolVersion === null
      ) {
        session.protocolVersion = negotiatedVersion(message);
      }
      // The SDK drops a message that isn't tied to a request when no
      // standalone stream is open (`if (standaloneSse === void 0) return`),
      // so it never reaches the wire and the capture can't see it there. It
      // also drops related messages (progress, for one) whose POST stream is
      // gone; Decoy sends none.
      if (
        answeredId === null &&
        options?.relatedRequestId === undefined &&
        session.standalone?.open !== true
      ) {
        capture.undelivered(origin, message);
      }
      return send(message, options);
    };

    await sdkServer.connect(session.transport);
    return session;
  };

  return {
    async handle(serverName, request, exchange) {
      const body =
        request.method === 'POST' ? await request.clone().text() : null;
      const config = findServer(serverName);
      if (config === undefined) {
        const known = serverNames();
        return jsonRPCError(
          404,
          -32001,
          `Unknown server "${serverName}". Known servers: ${
            known.length === 0 ? '(none)' : known.join(', ')
          }`,
          { data: { knownServers: known }, requestBody: body },
        );
      }

      const sessionId = request.headers.get('mcp-session-id');

      if (sessionId !== null) {
        const found = sessions.get(sessionId);
        const session = found?.server === serverName ? found : undefined;
        if (session === undefined) {
          return jsonRPCError(404, -32001, 'Session not found', {
            requestBody: body,
          });
        }
        session.lastSeenAt = now().toISOString();
        const response = await session.transport.handleRequest(request);
        if (request.method === 'GET' && response.status === 200) {
          session.standalone = exchange;
        }
        return response;
      }

      if (body === null) {
        return jsonRPCError(
          400,
          -32000,
          'Bad Request: Mcp-Session-Id header is required',
        );
      }

      const initialize = findInitialize(body);
      if (initialize === null) {
        return jsonRPCError(
          400,
          -32000,
          'Bad Request: No valid session ID provided',
          { requestBody: body },
        );
      }

      const session = await createSession(config, initialize);
      return session.transport.handleRequest(request);
    },

    list(server) {
      if (findServer(server) === undefined) {
        throw new NotFoundError(`No server named "${server}"`);
      }
      return sessionsOf(server).map((session) => ({
        id: session.id,
        clientInfo: session.clientInfo,
        requestedProtocolVersion: session.requestedProtocolVersion,
        protocolVersion: session.protocolVersion,
        capabilities: session.capabilities,
        connectedAt: session.connectedAt,
        lastSeenAt: session.lastSeenAt,
      }));
    },

    count: (server) => sessionsOf(server).length,

    async close(server, sessionId) {
      if (findServer(server) === undefined) {
        throw new NotFoundError(`No server named "${server}"`);
      }
      const session = sessions.get(sessionId);
      if (session === undefined || session.server !== server) {
        throw new NotFoundError(
          `No session "${sessionId}" on server "${server}"`,
        );
      }
      await closeSession(session);
    },

    async closeAll() {
      await Promise.all([...sessions.values()].map(closeSession));
    },
  };
}

type InitializeParams = {
  id: string | number;
  clientInfo: ClientInfo | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
};

/** Finds an `initialize` request in a POST body and extracts what sessions report. */
const findInitialize = (body: string): InitializeParams | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  for (const message of messages) {
    if (
      isRecord(message) &&
      message.method === 'initialize' &&
      'id' in message
    ) {
      const params = isRecord(message.params) ? message.params : {};
      const clientInfo = params.clientInfo;
      const id = message.id;
      if (typeof id !== 'string' && typeof id !== 'number') {
        return null;
      }
      return {
        id,
        clientInfo:
          isRecord(clientInfo) &&
          typeof clientInfo.name === 'string' &&
          typeof clientInfo.version === 'string'
            ? { name: clientInfo.name, version: clientInfo.version }
            : null,
        protocolVersion:
          typeof params.protocolVersion === 'string'
            ? params.protocolVersion
            : null,
        capabilities: isRecord(params.capabilities) ? params.capabilities : {},
      };
    }
  }
  return null;
};

/** The id of a single JSON-RPC request in `body`, so an error can answer it. */
const requestIdOf = (body: string | null): string | number | null => {
  if (body === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) &&
      (typeof parsed.id === 'string' || typeof parsed.id === 'number')
      ? parsed.id
      : null;
  } catch {
    return null;
  }
};

/** The JSON-RPC id a response or error message answers, or `null` for any other message. */
const answeredIdOf = (message: unknown): string | number | null =>
  isRecord(message) &&
  !('method' in message) &&
  (typeof message.id === 'string' || typeof message.id === 'number')
    ? message.id
    : null;

const negotiatedVersion = (message: unknown): string | null =>
  isRecord(message) &&
  isRecord(message.result) &&
  typeof message.result.protocolVersion === 'string'
    ? message.result.protocolVersion
    : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
