import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { type ToolsService } from '@/server/tools';
import {
  createToolRequestSchema,
  toolListSchema,
  toolSchema,
  updateToolRequestSchema,
} from '@/shared/api';

import { validationHook } from './problems';

const toolLocation = (server: string, tool: string) =>
  `/api/v1/servers/${server}/tools/${encodeURIComponent(tool)}`;

/**
 * `/api/v1/servers/{server}/tools` and `/api/v1/servers/{server}/tools/{tool}`.
 *
 * @param tools - The tools service.
 */
export function createToolsRoutes(tools: ToolsService) {
  return new Hono()
    .get('/:server/tools', (c) =>
      c.json(
        toolListSchema.parse({ items: tools.list(c.req.param('server')) }),
        200,
      ),
    )
    .post(
      '/:server/tools',
      zValidator('json', createToolRequestSchema, validationHook),
      async (c) => {
        const server = c.req.param('server');
        const created = await tools.create(server, c.req.valid('json'));
        c.header('Location', toolLocation(server, created.name));
        return c.json(toolSchema.parse(created), 201);
      },
    )
    .get('/:server/tools/:tool', (c) =>
      c.json(
        toolSchema.parse(tools.get(c.req.param('server'), c.req.param('tool'))),
        200,
      ),
    )
    .patch(
      '/:server/tools/:tool',
      zValidator('json', updateToolRequestSchema, validationHook),
      async (c) => {
        const server = c.req.param('server');
        const name = c.req.param('tool');
        const updated = await tools.update(server, name, c.req.valid('json'));
        if (updated.name !== name) {
          c.header('Location', toolLocation(server, updated.name));
        }
        return c.json(toolSchema.parse(updated), 200);
      },
    )
    .delete('/:server/tools/:tool', async (c) => {
      await tools.delete(c.req.param('server'), c.req.param('tool'));
      return c.body(null, 204);
    });
}
