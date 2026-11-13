import { type OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { type OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { type OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { type Context } from 'hono';

import { type OAuthStore } from '@/server/oauth';
import { SUPPORTED_SCOPES } from '@/shared/api';

import { renderConsentPage } from './consent-page';

/**
 * `@hono/mcp`'s `/authorize` refuses any scope missing from `client.scope`
 * before the provider runs, which would refuse `mcp` to every client that
 * registered without a scope. It doesn't know the server yet, so it can't
 * apply that server's scope policy. This widens `scope` with the advertised
 * scopes so the check passes, and `OAuthStore.beginConsent` enforces the
 * policy once the resource is known.
 */
const withAdvertisedScopes = (
  client: OAuthClientInformationFull | undefined,
): OAuthClientInformationFull | undefined => {
  if (client === undefined) {
    return undefined;
  }
  const registered = client.scope?.split(' ') ?? [];
  const scopes = new Set([...registered, ...SUPPORTED_SCOPES]);
  return { ...client, scope: [...scopes].join(' ') };
};

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
        getClient: (clientId) =>
          withAdvertisedScopes(store.getClient(clientId)),
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
