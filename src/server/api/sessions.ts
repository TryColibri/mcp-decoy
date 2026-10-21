import { Hono } from 'hono';

import { type SessionManager } from '@/server/mcp';
import { sessionListSchema } from '@/shared/api';

/**
 * `/api/v1/servers/{server}/sessions` and `/api/v1/servers/{server}/sessions/{session}`.
 *
 * @param sessions - The session manager.
 */
export function createSessionsRoutes(sessions: SessionManager) {
  return new Hono()
    .get('/:server/sessions', (c) =>
      c.json(
        sessionListSchema.parse({
          items: sessions.list(c.req.param('server')),
        }),
        200,
      ),
    )
    .delete('/:server/sessions/:session', async (c) => {
      await sessions.close(c.req.param('server'), c.req.param('session'));
      return c.body(null, 204);
    });
}
