import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { type Capture, type SessionManager } from '@/server/mcp';
import { type OAuthStore } from '@/server/oauth';
import { createOAuthGate, createOAuthRoutes } from '@/server/oauth-http';
import { type ServerConfig } from '@/shared/api';

import { createExchangeLog, type ExchangeLogEnv } from './exchange-log';

/** Dependencies of the MCP listener's app. */
export type CreateMCPAppOptions = {
  /** The session manager that handles MCP requests. */
  sessions: SessionManager;
  /** The OAuth store, shared by every mock server on this instance. */
  oauth: OAuthStore;
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Every server, for the OAuth routes' exchange attribution. */
  listServers: () => readonly ServerConfig[];
  /** Where traffic is recorded. */
  capture: Capture;
};

/**
 * Creates the MCP listener's app: the OAuth authorization-server routes at
 * the root, and `/s/{server}/mcp` for every mock server, gated by OAuth
 * when the server is protected. CORS allows any origin because the listener
 * only serves mock data and the client under test may run in a browser.
 * Every exchange is recorded from the wire, CORS headers included.
 *
 * @param options - Sessions, OAuth store, server lookups and capture.
 */
export function createMCPApp({
  sessions,
  oauth,
  findServer,
  listServers,
  capture,
}: CreateMCPAppOptions) {
  const gate = createOAuthGate(oauth);

  return new Hono<ExchangeLogEnv>()
    .use(createExchangeLog({ capture, findServer, listServers, oauth }))
    .use(
      cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'content-type',
          'mcp-session-id',
          'mcp-protocol-version',
          'last-event-id',
          'authorization',
        ],
        exposeHeaders: ['mcp-session-id', 'www-authenticate'],
      }),
    )
    .on(['GET', 'POST', 'DELETE'], '/s/:server/mcp', async (c) => {
      const server = c.req.param('server');
      const config = findServer(server);
      if (config?.auth !== undefined) {
        const challenge = await gate(server, c.req.raw);
        if (challenge !== null) {
          return challenge;
        }
      }
      return sessions.handle(server, c.req.raw, c.get('exchange') ?? null);
    })
    .route('/', createOAuthRoutes({ store: oauth, findServer }));
}
