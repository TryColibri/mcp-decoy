import { type OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { type OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { type Context } from 'hono';

import { type OAuthStore } from '@/server/oauth';

import { renderConsentPage } from './consent-page';

/**
 * Implements `@hono/mcp`'s `OAuthServerProvider` extension point on top of
 * an `OAuthStore`: a clients store, consent (rendered as Decoy's consent
 * page), and code and token bookkeeping.
 *
 * @param store - The OAuth store.
 */
export function createDecoyProvider(store: OAuthStore): OAuthServerProvider {
  return {
    get clientsStore(): OAuthRegisteredClientsStore {
      return {
        getClient: (clientId) => store.getClient(clientId),
        registerClient: (client) => store.registerClient(client),
      };
    },

    async authorize(client, params, c: Context) {
      const requestId = store.beginConsent(client, params);
      const pending = store.consent(requestId);
      if (pending === undefined) {
        throw new Error('Consent request vanished right after it was created');
      }
      c.header('Content-Security-Policy', "frame-ancestors 'none'");
      c.header('Cache-Control', 'no-store');
      c.res = await c.html(renderConsentPage({ requestId, ...pending }));
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      return store.challengeForAuthorizationCode(client, authorizationCode);
    },

    async exchangeAuthorizationCode(
      client,
      authorizationCode,
      _codeVerifier,
      redirectUri,
      resource,
    ) {
      return store.exchangeAuthorizationCode(
        client,
        authorizationCode,
        redirectUri,
        resource,
      );
    },

    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      return store.exchangeRefreshToken(client, refreshToken, scopes, resource);
    },

    async verifyAccessToken(token) {
      return store.verify(token);
    },

    async revokeToken(client, request) {
      store.revoke(client.client_id, request.token);
    },
  };
}
