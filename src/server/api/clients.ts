import { Hono } from 'hono';

import { type MCPEndpoint } from '@/server/mcp';
import { mcpClientListSchema } from '@/shared/api';

/**
 * `/api/v1/servers/{server}/clients` and `/api/v1/servers/{server}/clients/{client}`.
 * A client's id is a session ID or a client key such as `oauth:<client_id>`,
 * so it arrives URL-encoded.
 *
 * @param mcp - The MCP endpoint.
 */
export function createClientsRoutes(mcp: MCPEndpoint) {
  return new Hono()
    .get('/:server/clients', (c) =>
      c.json(
        mcpClientListSchema.parse({
          items: mcp.listClients(c.req.param('server')),
        }),
        200,
      ),
    )
    .delete('/:server/clients/:client', async (c) => {
      await mcp.closeClient(c.req.param('server'), c.req.param('client'));
      return c.body(null, 204);
    });
}
