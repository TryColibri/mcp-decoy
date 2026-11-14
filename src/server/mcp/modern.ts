import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  PROTOCOL_VERSION_META_KEY,
  type AuthInfo,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';

import { type EventBus, type MCPDecoyEvents } from '@/server/events';
import { type ServerConfig, type ToolConfig } from '@/shared/api';

import { type Exchange } from './capture';
import { type ClientIdentity, type ClientRegistry } from './clients';
import { createMockServer } from './mock-server';

/** Dependencies of the modern (2026-07-28) handler. */
export type ModernHandlerDeps = {
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Published tools of a server, read on every request. */
  listPublishedTools: (server: string) => ToolConfig[];
  /** Where stateless clients are tracked. */
  clients: ClientRegistry;
  /** Mutations to react to. */
  events: EventBus<MCPDecoyEvents>;
  /** Reports errors that have nowhere else to go. */
  onError?: (error: unknown) => void;
};

/** Serves 2026-07-28 requests, which carry their own context and need no session. */
export type ModernHandler = {
  /**
   * Handles one 2026-07-28 request: attributes it to its client, serves it,
   * and keeps `subscriptions/listen` streams closable.
   *
   * @param config - The server the request is addressed to.
   * @param request - The request.
   * @param exchange - The recording of the request's HTTP exchange, or `null`.
   * @param authInfo - The verified token, when the server uses OAuth.
   */
  handle(
    config: ServerConfig,
    request: Request,
    exchange: Exchange | null,
    authInfo?: AuthInfo,
  ): Promise<Response>;
  /** Ends every `subscriptions/listen` stream and drops every server's handler. */
  closeAll(): Promise<void>;
};

/**
 * Creates the modern handler and subscribes it to `toolsChanged` (notifies
 * `subscriptions/listen` streams) and `serverDeleted`, `serverRenamed`,
 * `serverAuthChanged` and `serverProtocolChanged` to `legacy` (ends them).
 *
 * @param deps - Server lookups, client registry and event bus.
 */
export function createModernHandler({
  findServer,
  listPublishedTools,
  clients,
  events,
  onError = () => {},
}: ModernHandlerDeps): ModernHandler {
  const handlers = new Map<string, McpHttpHandler>();

  const handlerOf = (server: string): McpHttpHandler => {
    const existing = handlers.get(server);
    if (existing !== undefined) {
      return existing;
    }
    const created = createMcpHandler(
      () => {
        // Read per request: edits to the cache hint apply at once.
        const config = findServer(server);
        if (config === undefined) {
          throw new Error(`No server named "${server}"`);
        }
        return createMockServer({
          config,
          listPublishedTools: () => listPublishedTools(server),
        });
      },
      {
        legacy: 'reject',
        onerror: onError,
      },
    );
    handlers.set(server, created);
    return created;
  };

  const drop = (server: string) => {
    clients.clear(server);
    const handler = handlers.get(server);
    handlers.delete(server);
    handler?.close().catch(onError);
  };

  events.on('toolsChanged', ({ server }) => {
    handlers.get(server)?.notify.toolsChanged();
  });
  events.on('serverDeleted', ({ server }) => {
    drop(server);
  });
  events.on('serverRenamed', ({ from }) => {
    drop(from);
  });
  events.on('serverAuthChanged', ({ server }) => {
    drop(server);
  });
  events.on('serverProtocolChanged', ({ server, eras }) => {
    if (eras === 'legacy') {
      drop(server);
    }
  });

  return {
    async handle(config, request, exchange, authInfo) {
      const envelope =
        request.method === 'POST'
          ? readEnvelope(await request.clone().text())
          : undefined;

      let client: string | undefined;
      if (envelope !== undefined) {
        client = clients.touch({
          server: config.name,
          oauthClientId: authInfo?.clientId ?? null,
          ...envelope.identity,
        });
        exchange?.attribute({ client });
      }

      const response = await handlerOf(config.name).fetch(
        request,
        authInfo === undefined ? undefined : { authInfo },
      );

      if (
        client === undefined ||
        envelope?.method !== 'subscriptions/listen' ||
        response.body === null ||
        !(response.headers.get('content-type') ?? '').includes(
          'text/event-stream',
        )
      ) {
        return response;
      }
      return closable(response, response.body, (close) => {
        const unregister = clients.openSubscription(config.name, client, close);
        exchange?.onEnd(unregister);
        return unregister;
      });
    },

    async closeAll() {
      const open = [...handlers.keys()];
      await Promise.all(
        open.map(async (server) => {
          clients.clear(server);
          const handler = handlers.get(server);
          handlers.delete(server);
          await handler?.close();
        }),
      );
    },
  };
}

/**
 * Wraps an event stream so the server can end it: the SDK offers no way to
 * end one stream, only all of a handler's.
 *
 * @param response - The streaming response.
 * @param body - Its body.
 * @param register - Receives the function that ends the stream; returns what
 *   to call once the stream is over.
 */
const closable = (
  response: Response,
  body: ReadableStream<Uint8Array>,
  register: (close: () => void) => () => void,
): Response => {
  const reader = body.getReader();
  let closed = false;
  // For checks after an `await`, where `closed` may have changed.
  const hasClosed = () => closed;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let unregister = () => {};

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    unregister();
    reader.cancel().catch(() => {});
    try {
      controller?.close();
    } catch {
      // Already closed or errored by the client leaving.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      unregister = register(close);
    },
    async pull(streamController) {
      if (closed) {
        return;
      }
      const chunk = await reader.read();
      if (hasClosed()) {
        return;
      }
      if (chunk.done) {
        closed = true;
        unregister();
        streamController.close();
      } else {
        streamController.enqueue(chunk.value);
      }
    },
    async cancel(reason) {
      closed = true;
      unregister();
      await reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

type Envelope = {
  method: string | null;
  identity: Pick<
    ClientIdentity,
    'clientInfo' | 'protocolVersion' | 'capabilities'
  >;
};

/**
 * What a 2026-07-28 request body says about its sender, from the `_meta`
 * envelope. Undefined when the body isn't a JSON-RPC message, which the SDK
 * answers with an error.
 */
const readEnvelope = (body: string): Envelope | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const params = isRecord(parsed.params) ? parsed.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const info = meta[CLIENT_INFO_META_KEY];
  const version = meta[PROTOCOL_VERSION_META_KEY];
  const capabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  return {
    method: typeof parsed.method === 'string' ? parsed.method : null,
    identity: {
      clientInfo:
        isRecord(info) &&
        typeof info.name === 'string' &&
        typeof info.version === 'string'
          ? { name: info.name, version: info.version }
          : null,
      protocolVersion: typeof version === 'string' ? version : null,
      capabilities: isRecord(capabilities) ? capabilities : {},
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
