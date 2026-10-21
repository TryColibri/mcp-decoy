import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { type ServersService } from '@/server/servers';
import {
  createServerRequestSchema,
  serverListSchema,
  serverSummarySchema,
} from '@/shared/api';

import { validationHook } from './problems';

/**
 * `/api/v1/servers` and `/api/v1/servers/{server}`.
 *
 * @param servers - The servers service.
 */
export function createServersRoutes(servers: ServersService) {
  return new Hono()
    .get('/', (c) =>
      c.json(serverListSchema.parse({ items: servers.list() }), 200),
    )
    .post(
      '/',
      zValidator('json', createServerRequestSchema, validationHook),
      async (c) => {
        const created = await servers.create(c.req.valid('json'));
        c.header('Location', `/api/v1/servers/${created.name}`);
        return c.json(serverSummarySchema.parse(created), 201);
      },
    )
    .get('/:server', (c) =>
      c.json(
        serverSummarySchema.parse(servers.get(c.req.param('server'))),
        200,
      ),
    )
    .delete('/:server', async (c) => {
      await servers.delete(c.req.param('server'));
      return c.body(null, 204);
    });
}
