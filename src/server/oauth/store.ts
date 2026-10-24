import { randomBytes } from 'node:crypto';

import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { type AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  type OAuthClientInformationFull,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { type MCPDecoyEvents, type EventBus } from '@/server/events';
import { type ServerConfig } from '@/shared/api';

/** How long a consent request stays open before it must be restarted. */
const CONSENT_TTL_MS = 5 * 60 * 1000;

/** How long an authorization code can be exchanged before it expires. */
const CODE_TTL_MS = 60 * 1000;

/** How long an access token is valid for. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** Information about a verified access token, structurally compatible with the MCP SDKs' `AuthInfo`. */
export type OAuthAuthInfo = {
  /** The access token. */
  token: string;
  /** The client the token was issued to. */
  clientId: string;
  /** Scopes granted to the token. */
  scopes: string[];
  /** Expiry, in seconds since epoch. */
  expiresAt: number;
  /** The resource (server) the token is valid for. */
  resource: URL;
};

/** What the consent page needs to render. */
export type ConsentRequest = {
  /** The client requesting access. */
  client: OAuthClientInformationFull;
  /** The server (resource) access is requested for. */
  server: string;
  /** Where the user agent is sent after a decision. */
  redirectUri: string;
  /** The resource indicator (RFC 8707) the token will be bound to. */
  resource: URL;
  /** Requested scopes. */
  scopes: string[];
};

/** Dependencies of the OAuth store. */
export type OAuthStoreDeps = {
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Every server, for resolving a pre-registered client by its client ID. */
  listServers: () => readonly ServerConfig[];
  /** Mutations to react to: state tied to a server is dropped on each. */
  events: EventBus<MCPDecoyEvents>;
  /** Current time. */
  now?: () => Date;
  /** Generates client IDs, secrets, authorization codes and tokens. */
  randomToken?: () => string;
};

/**
 * In-memory OAuth state shared by every mock server on this instance:
 * Dynamically-registered clients, pending consent requests, authorization
 * codes, and access and refresh tokens. Holds no Hono or HTTP concerns —
 * {@link https://www.rfc-editor.org/rfc/rfc6749 | RFC 6749} error classes
 * are thrown so `@hono/mcp`'s handlers can turn them into protocol
 * responses.
 */
export type OAuthStore = {
  /** Resolves a client by ID: a DCR client, or a server's pre-registered client. */
  getClient(clientId: string): OAuthClientInformationFull | undefined;
  /** Registers a new DCR client, generating its ID. */
  registerClient(
    metadata: Omit<
      OAuthClientInformationFull,
      'client_id' | 'client_id_issued_at'
    >,
  ): OAuthClientInformationFull;
  /**
   * Starts a consent flow for `client`, validating that `params.resource`
   * names an existing OAuth-protected server.
   * @throws {InvalidTargetError} When the resource is missing or unknown.
   */
  beginConsent(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
  ): string;
  /** The pending consent request, for rendering the consent page. */
  consent(requestId: string): ConsentRequest | undefined;
  /**
   * Resolves a pending consent request: approved issues a code, denied
   * carries `error=access_denied`. Both carry `state` (if present) and
   * `iss`. `undefined` when the request is unknown or expired.
   */
  decide(
    requestId: string,
    approved: boolean,
    issuer: string,
  ): string | undefined;
  /**
   * @throws {InvalidGrantError} When the code is unknown, expired or not the client's.
   */
  challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): string;
  /**
   * Single use.
   * @throws {InvalidGrantError} When the code is unknown, expired or not the client's, or the redirect URI doesn't match.
   * @throws {InvalidTargetError} When the resource doesn't match the authorization request.
   */
  exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    redirectUri?: string,
    resource?: URL,
  ): OAuthTokens;
  /**
   * Rotates the refresh token.
   * @throws {InvalidGrantError} When the refresh token is unknown or not the client's.
   * @throws {InvalidTargetError} When the resource doesn't match the original grant.
   */
  exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): OAuthTokens;
  /**
   * @throws {InvalidTokenError} When the token is unknown or expired.
   */
  verify(token: string): OAuthAuthInfo;
  /** Revokes a token if it belongs to `clientId`. Does nothing otherwise. */
  revoke(clientId: string, token: string): void;
  /** Drops every token and authorization code of `server`. DCR clients survive. */
  revokeAll(server: string): void;
  /** Number of live access and refresh tokens of `server`. */
  tokenCount(server: string): number;
};

type PendingConsent = {
  client: OAuthClientInformationFull;
  params: AuthorizationParams & { resource: URL };
  server: string;
  createdAt: number;
};

type AuthorizationCode = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  server: string;
  scopes: string[];
  createdAt: number;
};

type IssuedToken = {
  clientId: string;
  server: string;
  resource: string;
  scopes: string[];
};

type AccessTokenRecord = IssuedToken & { expiresAt: number };

/** Extracts the server name from a `.../s/:server/mcp` resource URL. */
const serverNameOf = (resource: URL): string | null => {
  const match = /^\/s\/([^/]+)\/mcp$/.exec(resource.pathname);
  return match === null ? null : match[1];
};

/**
 * Creates the OAuth store.
 *
 * @param deps - Server lookups and the event bus.
 */
export function createOAuthStore({
  findServer,
  listServers,
  events,
  now = () => new Date(),
  randomToken = () => randomBytes(32).toString('base64url'),
}: OAuthStoreDeps): OAuthStore {
  const dcrClients = new Map<string, OAuthClientInformationFull>();
  const consents = new Map<string, PendingConsent>();
  const codes = new Map<string, AuthorizationCode>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const refreshTokens = new Map<string, IssuedToken>();

  const sweepConsents = () => {
    const cutoff = now().getTime() - CONSENT_TTL_MS;
    for (const [key, record] of consents) {
      if (record.createdAt < cutoff) {
        consents.delete(key);
      }
    }
  };

  const sweepCodes = () => {
    const cutoff = now().getTime() - CODE_TTL_MS;
    for (const [key, record] of codes) {
      if (record.createdAt < cutoff) {
        codes.delete(key);
      }
    }
  };

  const sweepTokens = () => {
    const nowSeconds = Math.floor(now().getTime() / 1000);
    for (const [key, record] of accessTokens) {
      if (record.expiresAt <= nowSeconds) {
        accessTokens.delete(key);
      }
    }
  };

  const dropServerState = (server: string) => {
    for (const [key, record] of accessTokens) {
      if (record.server === server) {
        accessTokens.delete(key);
      }
    }
    for (const [key, record] of refreshTokens) {
      if (record.server === server) {
        refreshTokens.delete(key);
      }
    }
    for (const [key, record] of codes) {
      if (record.server === server) {
        codes.delete(key);
      }
    }
    for (const [key, record] of consents) {
      if (record.server === server) {
        consents.delete(key);
      }
    }
  };

  events.on('serverAuthChanged', ({ server }) => {
    dropServerState(server);
  });
  events.on('serverDeleted', ({ server }) => {
    dropServerState(server);
  });
  events.on('serverRenamed', ({ from }) => {
    dropServerState(from);
  });

  const issueTokens = ({
    clientId,
    server,
    resource,
    scopes,
  }: IssuedToken): OAuthTokens => {
    sweepTokens();
    const accessToken = `decoy_at_${randomToken()}`;
    const refreshToken = `decoy_rt_${randomToken()}`;
    const expiresAt =
      Math.floor(now().getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    accessTokens.set(accessToken, {
      clientId,
      server,
      resource,
      scopes,
      expiresAt,
    });
    refreshTokens.set(refreshToken, { clientId, server, resource, scopes });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      ...(scopes.length === 0 ? {} : { scope: scopes.join(' ') }),
    };
  };

  return {
    getClient(clientId) {
      const dcrClient = dcrClients.get(clientId);
      if (dcrClient !== undefined) {
        return dcrClient;
      }
      const server = listServers().find(
        (candidate) =>
          candidate.auth?.mode === 'oauth' &&
          candidate.auth.clientId === clientId &&
          candidate.auth.redirectUris.length > 0,
      );
      if (server === undefined || server.auth === undefined) {
        return undefined;
      }
      return {
        client_id: server.auth.clientId,
        client_secret: server.auth.clientSecret,
        redirect_uris: server.auth.redirectUris,
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: `${server.name} (pre-registered)`,
      };
    },

    registerClient(metadata) {
      const client: OAuthClientInformationFull = {
        ...metadata,
        client_id: randomToken(),
        client_id_issued_at: Math.floor(now().getTime() / 1000),
      };
      dcrClients.set(client.client_id, client);
      return client;
    },

    beginConsent(client, params) {
      if (params.resource === undefined) {
        throw new InvalidTargetError('A resource parameter is required');
      }
      const serverName = serverNameOf(params.resource);
      const config = serverName === null ? undefined : findServer(serverName);
      if (
        serverName === null ||
        config === undefined ||
        config.auth === undefined
      ) {
        throw new InvalidTargetError(
          `Unknown or unprotected resource "${params.resource.href}"`,
        );
      }
      sweepConsents();
      const requestId = randomToken();
      consents.set(requestId, {
        client,
        params: { ...params, resource: params.resource },
        server: serverName,
        createdAt: now().getTime(),
      });
      return requestId;
    },

    consent(requestId) {
      sweepConsents();
      const pending = consents.get(requestId);
      if (pending === undefined) {
        return undefined;
      }
      return {
        client: pending.client,
        server: pending.server,
        redirectUri: pending.params.redirectUri,
        resource: pending.params.resource,
        scopes: pending.params.scopes ?? [],
      };
    },

    decide(requestId, approved, issuer) {
      sweepConsents();
      const pending = consents.get(requestId);
      if (pending === undefined) {
        return undefined;
      }
      consents.delete(requestId);
      const url = new URL(pending.params.redirectUri);
      if (pending.params.state !== undefined) {
        url.searchParams.set('state', pending.params.state);
      }
      url.searchParams.set('iss', issuer);
      if (!approved) {
        url.searchParams.set('error', 'access_denied');
        return url.href;
      }
      sweepCodes();
      const code = randomToken();
      codes.set(code, {
        clientId: pending.client.client_id,
        codeChallenge: pending.params.codeChallenge,
        redirectUri: pending.params.redirectUri,
        resource: pending.params.resource.href,
        server: pending.server,
        scopes: pending.params.scopes ?? [],
        createdAt: now().getTime(),
      });
      url.searchParams.set('code', code);
      return url.href;
    },

    challengeForAuthorizationCode(client, authorizationCode) {
      sweepCodes();
      const record = codes.get(authorizationCode);
      if (record === undefined || record.clientId !== client.client_id) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }
      return record.codeChallenge;
    },

    exchangeAuthorizationCode(
      client,
      authorizationCode,
      redirectUri,
      resource,
    ) {
      sweepCodes();
      const record = codes.get(authorizationCode);
      if (record === undefined || record.clientId !== client.client_id) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }
      if (redirectUri !== undefined && redirectUri !== record.redirectUri) {
        throw new InvalidGrantError(
          'redirect_uri does not match the authorization request',
        );
      }
      if (resource !== undefined && resource.href !== record.resource) {
        throw new InvalidTargetError(
          'resource does not match the authorization request',
        );
      }
      codes.delete(authorizationCode);
      return issueTokens({
        clientId: client.client_id,
        server: record.server,
        resource: record.resource,
        scopes: record.scopes,
      });
    },

    exchangeRefreshToken(client, refreshToken, scopes, resource) {
      const record = refreshTokens.get(refreshToken);
      if (record === undefined || record.clientId !== client.client_id) {
        throw new InvalidGrantError('Invalid refresh token');
      }
      if (resource !== undefined && resource.href !== record.resource) {
        throw new InvalidTargetError(
          'resource does not match the original grant',
        );
      }
      refreshTokens.delete(refreshToken);
      return issueTokens({
        clientId: client.client_id,
        server: record.server,
        resource: record.resource,
        scopes: scopes ?? record.scopes,
      });
    },

    verify(token) {
      sweepTokens();
      const record = accessTokens.get(token);
      if (record === undefined) {
        throw new InvalidTokenError('Invalid or expired access token');
      }
      return {
        token,
        clientId: record.clientId,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        resource: new URL(record.resource),
      };
    },

    revoke(clientId, token) {
      const accessRecord = accessTokens.get(token);
      if (accessRecord !== undefined) {
        if (accessRecord.clientId === clientId) {
          accessTokens.delete(token);
        }
        return;
      }
      const refreshRecord = refreshTokens.get(token);
      if (refreshRecord !== undefined && refreshRecord.clientId === clientId) {
        refreshTokens.delete(token);
      }
    },

    revokeAll(server) {
      dropServerState(server);
    },

    tokenCount(server) {
      sweepTokens();
      let count = 0;
      for (const record of accessTokens.values()) {
        if (record.server === server) {
          count += 1;
        }
      }
      for (const record of refreshTokens.values()) {
        if (record.server === server) {
          count += 1;
        }
      }
      return count;
    },
  };
}
