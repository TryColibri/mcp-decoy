import {
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  verifyBearerToken,
} from '@modelcontextprotocol/server';

import { type OAuthStore } from '@/server/oauth';

import { publicOriginOf } from './public-origin';

/** Checks a request's Bearer token against a server's OAuth protection. */
export type OAuthGate = (
  server: string,
  request: Request,
) => Promise<Response | null>;

/**
 * Creates the resource-server gate for `/s/:server/mcp`: `null` when the
 * request carries a valid access token for `server`, otherwise the
 * challenge response to answer with.
 *
 * @param store - The OAuth store, used to verify tokens.
 */
export function createOAuthGate(store: OAuthStore): OAuthGate {
  return async (server, request) => {
    const origin = publicOriginOf(request);
    const resourceUrl = new URL(`${origin}/s/${server}/mcp`);
    const resourceMetadataUrl =
      getOAuthProtectedResourceMetadataUrl(resourceUrl);
    try {
      await verifyBearerToken(request.headers.get('authorization'), {
        // `store.verify` throws the MCP SDK v1 (`@modelcontextprotocol/sdk`)
        // error classes; `bearerAuthChallengeResponse` below only recognizes
        // SDK v2's own `OAuthError`, so failures are translated here.
        verifier: {
          verifyAccessToken: async (token) => {
            try {
              return store.verify(token);
            } catch {
              throw new OAuthError(
                OAuthErrorCode.InvalidToken,
                'Invalid or expired access token',
              );
            }
          },
        },
        expectedResource: resourceUrl,
        resourceMetadataUrl,
      });
      return null;
    } catch (error) {
      return bearerAuthChallengeResponse(error, { resourceMetadataUrl });
    }
  };
}
