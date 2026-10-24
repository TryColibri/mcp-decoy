import { z } from 'zod';

/** A live OAuth token, as returned by `GET /api/v1/servers/{server}/oauth/tokens`. */
export type OAuthToken = {
  /** Opaque ID to revoke the token with. */
  id: string;
  /** Whether this is an access or a refresh token. */
  kind: 'access' | 'refresh';
  /** The token value. */
  value: string;
  /** The client the token was issued to. */
  clientId: string;
  /** Name of the client, or `null` when it is no longer known. */
  clientName: string | null;
  /** Scopes granted to the token. */
  scopes: string[];
  /** When the token was issued, ISO 8601. */
  issuedAt: string;
  /** When the token expires, ISO 8601. `null` for refresh tokens, which don't expire. */
  expiresAt: string | null;
};

export const oauthTokenSchema: z.ZodType<OAuthToken> = z.strictObject({
  id: z.string().describe('Opaque ID to revoke the token with.'),
  kind: z
    .enum(['access', 'refresh'])
    .describe('Whether this is an access or a refresh token.'),
  value: z.string().describe('The token value.'),
  clientId: z.string().describe('The client the token was issued to.'),
  clientName: z
    .string()
    .nullable()
    .describe('Name of the client, or `null` when it is no longer known.'),
  scopes: z.array(z.string()).describe('Scopes granted to the token.'),
  issuedAt: z.iso.datetime().describe('When the token was issued, ISO 8601.'),
  expiresAt: z.iso
    .datetime()
    .nullable()
    .describe(
      'When the token expires, ISO 8601. `null` for refresh tokens, which don’t expire.',
    ),
});

/** Response body of `GET /api/v1/servers/{server}/oauth/tokens`. */
export type OAuthTokenList = {
  /** Live tokens, newest first. */
  items: OAuthToken[];
};

export const oauthTokenListSchema: z.ZodType<OAuthTokenList> = z.strictObject({
  items: z.array(oauthTokenSchema).describe('Live tokens, newest first.'),
});
