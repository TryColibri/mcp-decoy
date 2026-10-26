import { mcpAuthRouter, createOAuthMetadata } from '@hono/mcp/auth';
import { buildOAuthProtectedResourceMetadata } from '@modelcontextprotocol/server';
import { Hono } from 'hono';

import { type OAuthStore } from '@/server/oauth';
import { type ServerConfig } from '@/shared/api';

import { createDecoyProvider } from './provider';
import { publicOriginOf } from './public-origin';

/** Dependencies of the OAuth routes app. */
export type OAuthRoutesDeps = {
  /** The OAuth store. */
  store: OAuthStore;
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
};

/**
 * Creates the OAuth authorization-server routes, mounted at the MCP
 * listener's root: the per-server protected-resource metadata, the consent
 * page's submit endpoint, and `@hono/mcp`'s authorization-server router
 * (metadata, `/authorize`, `/token`, `/register`, `/revoke`), one instance
 * cached per origin since the issuer is derived from it.
 *
 * @param deps - Store and server lookup.
 */
export function createOAuthRoutes({ store, findServer }: OAuthRoutesDeps) {
  const provider = createDecoyProvider(store);
  const routersByOrigin = new Map<string, Hono>();

  const routerFor = (origin: string): Hono => {
    let router = routersByOrigin.get(origin);
    if (router === undefined) {
      router = mcpAuthRouter({
        provider,
        issuerUrl: origin,
        scopesSupported: ['mcp'],
        authorizationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false },
        clientRegistrationOptions: {
          rateLimit: false,
          clientIdGeneration: false,
        },
        revocationOptions: { rateLimit: false },
      });
      routersByOrigin.set(origin, router);
    }
    return router;
  };

  return new Hono()
    .get('/.well-known/oauth-protected-resource/s/:server/mcp', (c) => {
      const name = c.req.param('server');
      const config = findServer(name);
      if (config === undefined || config.auth === undefined) {
        return c.body(null, 404);
      }
      const origin = publicOriginOf(c.req.raw);
      const oauthMetadata = createOAuthMetadata({
        issuerUrl: origin,
        scopesSupported: ['mcp'],
      });
      const metadata = buildOAuthProtectedResourceMetadata({
        oauthMetadata,
        resourceServerUrl: new URL(`${origin}/s/${name}/mcp`),
        scopesSupported: ['mcp'],
      });
      return c.json(metadata);
    })
    .post('/consent/:requestId', async (c) => {
      const requestId = c.req.param('requestId');
      const body = await c.req.parseBody();
      const approved = body.decision === 'approve';
      const origin = publicOriginOf(c.req.raw);
      const redirect = store.decide(requestId, approved, origin);
      if (redirect === undefined) {
        return c.text(
          'This authorization request has expired. Close this tab and try again.',
          410,
        );
      }
      return c.redirect(redirect);
    })
    .all('*', async (c) => {
      const origin = publicOriginOf(c.req.raw);
      return routerFor(origin).fetch(c.req.raw);
    });
}
