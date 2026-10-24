import { Hono } from 'hono';

import { ConflictError, NotFoundError } from '@/server/errors';
import { type OAuthStore, type OAuthTokenInfo } from '@/server/oauth';
import { type ServersService } from '@/server/servers';
import { oauthTokenListSchema, type OAuthToken } from '@/shared/api';

/** Dependencies of the OAuth API routes. */
export type OAuthApiDeps = {
  /** The servers service, to find and validate the server. */
  servers: ServersService;
  /** The OAuth store. */
  oauth: OAuthStore;
};

const toISO = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();

const toWire = ({
  expiresAt,
  issuedAt,
  ...token
}: OAuthTokenInfo): OAuthToken => ({
  ...token,
  issuedAt: toISO(issuedAt),
  expiresAt: expiresAt === null ? null : toISO(expiresAt),
});

/**
 * `/api/v1/servers/{server}/oauth/tokens` and
 * `/api/v1/servers/{server}/oauth/tokens/{token}`.
 *
 * @param deps - The servers service and the OAuth store.
 */
export function createOAuthRoutes({ servers, oauth }: OAuthApiDeps) {
  /** @throws {NotFoundError} When the server doesn't exist. @throws {ConflictError} When it isn't on OAuth. */
  const assertOAuthServer = (name: string) => {
    const config = servers.findConfig(name);
    if (config === undefined) {
      throw new NotFoundError(`No server named "${name}"`);
    }
    if (config.auth === undefined) {
      throw new ConflictError(`Server "${name}" is not protected by OAuth`);
    }
  };

  return new Hono()
    .get('/:server/oauth/tokens', (c) => {
      const name = c.req.param('server');
      assertOAuthServer(name);
      const items = oauth.listTokens(name).map(toWire);
      return c.json(oauthTokenListSchema.parse({ items }), 200);
    })
    .delete('/:server/oauth/tokens', (c) => {
      const name = c.req.param('server');
      assertOAuthServer(name);
      oauth.revokeAll(name);
      return c.body(null, 204);
    })
    .delete('/:server/oauth/tokens/:token', (c) => {
      const name = c.req.param('server');
      const id = c.req.param('token');
      assertOAuthServer(name);
      if (!oauth.revokeToken(name, id)) {
        throw new NotFoundError(`No token "${id}" on server "${name}"`);
      }
      return c.body(null, 204);
    });
}
