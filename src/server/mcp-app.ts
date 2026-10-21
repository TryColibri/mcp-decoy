import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { type SessionManager } from '@/server/mcp';

/**
 * Creates the MCP listener's app: `/s/{server}/mcp` for every mock server.
 * CORS allows any origin because the listener only serves mock data and the
 * client under test may run in a browser.
 *
 * @param sessions - The session manager that handles MCP requests.
 */
export function createMCPApp(sessions: SessionManager) {
  return new Hono()
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
        exposeHeaders: ['mcp-session-id'],
      }),
    )
    .on(['GET', 'POST', 'DELETE'], '/s/:server/mcp', async (c) =>
      sessions.handle(c.req.param('server'), c.req.raw),
    );
}
