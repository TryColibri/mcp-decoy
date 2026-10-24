import { Hono } from 'hono';

import { ConflictError, NotFoundError } from '@/server/errors';
import { type OAuthStore } from '@/server/oauth';
import { type ServersService } from '@/server/servers';

/** Dependencies of the OAuth API routes. */
export type OAuthApiDeps = {
  /** The servers service, to find and validate the server. */
  servers: ServersService;
  /** The OAuth store. */
  oauth: OAuthStore;
};

/**
 * `/api/v1/servers/{server}/oauth/tokens`.
 *
 * @param deps - The servers service and the OAuth store.
 */
export function createOAuthRoutes({ servers, oauth }: OAuthApiDeps) {
  return new Hono().delete('/:server/oauth/tokens', async (c) => {
    const name = c.req.param('server');
    const config = servers.findConfig(name);
    if (config === undefined) {
      throw new NotFoundError(`No server named "${name}"`);
    }
    if (config.auth === undefined) {
      throw new ConflictError(`Server "${name}" is not protected by OAuth`);
    }
    oauth.revokeAll(name);
    return c.body(null, 204);
  });
}
