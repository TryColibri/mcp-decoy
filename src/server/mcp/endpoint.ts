import { type AuthInfo, isLegacyRequest } from '@modelcontextprotocol/server';

import { NotFoundError } from '@/server/errors';
import { type MCPClient, type ServerConfig } from '@/shared/api';

import { type Exchange } from './capture';
import { type ClientRegistry } from './clients';
import { jsonRPCError } from './json-rpc-error';
import { type ModernHandler } from './modern';
import { type SessionManager } from './session-manager';

/** Dependencies of the MCP endpoint. */
export type MCPEndpointDeps = {
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Names of every server, for the unknown-server error. */
  serverNames: () => string[];
  /** Serves 2025-11-25 requests. */
  sessions: SessionManager;
  /** Serves 2026-07-28 requests. */
  modern: ModernHandler;
  /** Tracks 2026-07-28 clients. */
  clients: ClientRegistry;
};

/** The MCP listener's entry point: routes each request to the protocol generation it speaks. */
export type MCPEndpoint = {
  /**
   * Handles an MCP request (`POST`, `GET` or `DELETE`) addressed to a server.
   * A server's `protocol.eras` decides who may talk to it: `legacy` sends
   * every request to the session manager, `modern` to the stateless handler,
   * and `both` follows the request's own shape.
   *
   * @param server - Name of the server the request is addressed to.
   * @param request - The request.
   * @param exchange - The recording of the request's HTTP exchange, or `null`
   *   when it isn't recorded.
   * @param authInfo - The verified token, when the server uses OAuth.
   */
  handle(
    server: string,
    request: Request,
    exchange: Exchange | null,
    authInfo?: AuthInfo,
  ): Promise<Response>;
  /**
   * Clients of a server, oldest first: live sessions and recently active
   * stateless clients.
   * @throws {NotFoundError} When the server doesn't exist.
   */
  listClients(server: string): MCPClient[];
  /** Number of listed clients of a server. */
  clientCount(server: string): number;
  /**
   * Closes a session, or forgets a stateless client and ends its streams.
   * @throws {NotFoundError} When the server or client doesn't exist.
   */
  closeClient(server: string, id: string): Promise<void>;
  /** Closes every session and stream of every server. */
  closeAll(): Promise<void>;
};

/**
 * Creates the MCP endpoint.
 *
 * @param deps - Server lookups and the two protocol handlers.
 */
export function createMCPEndpoint({
  findServer,
  serverNames,
  sessions,
  modern,
  clients,
}: MCPEndpointDeps): MCPEndpoint {
  const requireServer = (server: string) => {
    if (findServer(server) === undefined) {
      throw new NotFoundError(`No server named "${server}"`);
    }
  };

  return {
    async handle(server, request, exchange, authInfo) {
      const config = findServer(server);
      if (config === undefined) {
        const known = serverNames();
        return jsonRPCError(
          404,
          -32001,
          `Unknown server "${server}". Known servers: ${
            known.length === 0 ? '(none)' : known.join(', ')
          }`,
          {
            data: { knownServers: known },
            requestBody:
              request.method === 'POST' ? await request.clone().text() : null,
          },
        );
      }

      const { eras } = config.protocol;
      // The predicate reads a clone, so the body stays readable.
      const legacy =
        eras === 'legacy' ||
        (eras === 'both' && (await isLegacyRequest(request)));
      return legacy
        ? sessions.handle(config, request, exchange, authInfo)
        : modern.handle(config, request, exchange, authInfo);
    },

    listClients(server) {
      requireServer(server);
      return [...sessions.list(server), ...clients.list(server)].sort((a, b) =>
        a.connectedAt.localeCompare(b.connectedAt),
      );
    },

    clientCount(server) {
      return sessions.count(server) + clients.count(server);
    },

    async closeClient(server, id) {
      requireServer(server);
      if (sessions.list(server).some((session) => session.id === id)) {
        await sessions.close(server, id);
        return;
      }
      if (!clients.forget(server, id)) {
        throw new NotFoundError(`No client "${id}" on server "${server}"`);
      }
    },

    async closeAll() {
      await Promise.all([sessions.closeAll(), modern.closeAll()]);
    },
  };
}
