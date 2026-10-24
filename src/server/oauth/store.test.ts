import {
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { type OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEventBus,
  type EventBus,
  type MCPDecoyEvents,
} from '@/server/events';
import { type ServerConfig } from '@/shared/api';

import { createOAuthStore, type OAuthStore } from './store';

const OAUTH_SERVER: ServerConfig = {
  name: 'weather',
  serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
  tools: [],
  auth: {
    mode: 'oauth',
    clientId: 'preregistered-client',
    clientSecret: 'preregistered-secret',
    redirectUris: ['http://localhost/cb'],
  },
  createdAt: '2026-10-21T12:00:00.000Z',
};

const OPEN_SERVER: ServerConfig = {
  name: 'echo',
  serverInfo: { name: 'mcp-decoy/echo', version: '0.1.0' },
  tools: [],
  createdAt: '2026-10-21T12:00:00.000Z',
};

const DCR_METADATA: Omit<
  OAuthClientInformationFull,
  'client_id' | 'client_id_issued_at'
> = {
  redirect_uris: ['http://localhost/dcr-cb'],
  client_name: 'Claude',
};

describe('OAuthStore', () => {
  let servers: Map<string, ServerConfig>;
  let events: EventBus<MCPDecoyEvents>;
  let store: OAuthStore;
  let tokenCounter: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    servers = new Map([
      [OAUTH_SERVER.name, OAUTH_SERVER],
      [OPEN_SERVER.name, OPEN_SERVER],
    ]);
    events = createEventBus<MCPDecoyEvents>();
    tokenCounter = 0;
    store = createOAuthStore({
      findServer: (name) => servers.get(name),
      listServers: () => [...servers.values()],
      events,
      randomToken: () => `token-${(tokenCounter += 1)}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const resourceOf = (server: string) =>
    new URL(`http://localhost:6280/s/${server}/mcp`);

  const registerDCRClient = () => store.registerClient(DCR_METADATA);

  describe('registerClient', () => {
    it('generates a client ID and stores the client', () => {
      const client = registerDCRClient();

      expect(client.client_id).toEqual(expect.any(String));
      expect(store.getClient(client.client_id)).toEqual(client);
    });
  });

  describe('getClient', () => {
    it('resolves a DCR client', () => {
      const client = registerDCRClient();

      expect(store.getClient(client.client_id)?.client_name).toBe('Claude');
    });

    it('resolves a pre-registered client from the server config', () => {
      const client = store.getClient('preregistered-client');

      expect(client).toMatchObject({
        client_id: 'preregistered-client',
        client_secret: 'preregistered-secret',
        redirect_uris: ['http://localhost/cb'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    });

    it('does not offer a pre-registered client with no redirect URIs', () => {
      servers.set(OAUTH_SERVER.name, {
        ...OAUTH_SERVER,
        auth: { ...OAUTH_SERVER.auth!, redirectUris: [] },
      });

      expect(store.getClient('preregistered-client')).toBeUndefined();
    });

    it('returns undefined for an unknown client', () => {
      expect(store.getClient('nope')).toBeUndefined();
    });
  });

  describe('beginConsent', () => {
    it('throws InvalidTargetError when resource is missing', () => {
      const client = registerDCRClient();

      expect(() =>
        store.beginConsent(client, {
          codeChallenge: 'challenge',
          redirectUri: client.redirect_uris[0],
        }),
      ).toThrow(InvalidTargetError);
    });

    it('throws InvalidTargetError for an unknown resource', () => {
      const client = registerDCRClient();

      expect(() =>
        store.beginConsent(client, {
          codeChallenge: 'challenge',
          redirectUri: client.redirect_uris[0],
          resource: new URL('http://localhost:6280/s/nope/mcp'),
        }),
      ).toThrow(InvalidTargetError);
    });

    it('throws InvalidTargetError for a server that is not on OAuth', () => {
      const client = registerDCRClient();

      expect(() =>
        store.beginConsent(client, {
          codeChallenge: 'challenge',
          redirectUri: client.redirect_uris[0],
          resource: resourceOf(OPEN_SERVER.name),
        }),
      ).toThrow(InvalidTargetError);
    });

    it('returns a request ID for a known OAuth server', () => {
      const client = registerDCRClient();

      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });

      expect(store.consent(requestId)).toMatchObject({
        client,
        server: OAUTH_SERVER.name,
      });
    });
  });

  describe('decide', () => {
    const begin = (client: OAuthClientInformationFull) =>
      store.beginConsent(client, {
        state: 'xyz',
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });

    it('returns undefined for an unknown request', () => {
      expect(
        store.decide('nope', true, 'http://localhost:6281'),
      ).toBeUndefined();
    });

    it('carries error=access_denied, state and iss on denial', () => {
      const client = registerDCRClient();
      const requestId = begin(client);

      const redirect = store.decide(requestId, false, 'http://localhost:6281');

      const url = new URL(redirect!);
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('state')).toBe('xyz');
      expect(url.searchParams.get('iss')).toBe('http://localhost:6281');
    });

    it('carries a code, state and iss on approval, and consumes the request', () => {
      const client = registerDCRClient();
      const requestId = begin(client);

      const redirect = store.decide(requestId, true, 'http://localhost:6281');

      const url = new URL(redirect!);
      expect(url.searchParams.get('code')).toEqual(expect.any(String));
      expect(url.searchParams.get('state')).toBe('xyz');
      expect(url.searchParams.get('iss')).toBe('http://localhost:6281');
      expect(store.consent(requestId)).toBeUndefined();
    });

    it('expires a pending consent after 5 minutes', () => {
      const client = registerDCRClient();
      const requestId = begin(client);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(
        store.decide(requestId, true, 'http://localhost:6281'),
      ).toBeUndefined();
    });
  });

  describe('authorization codes', () => {
    const approve = (
      client: OAuthClientInformationFull,
      redirectUri?: string,
    ) => {
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: redirectUri ?? client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      return new URL(redirect).searchParams.get('code')!;
    };

    it('challengeForAuthorizationCode returns the stored challenge', () => {
      const client = registerDCRClient();
      const code = approve(client);

      expect(store.challengeForAuthorizationCode(client, code)).toBe(
        'challenge',
      );
    });

    it('throws InvalidGrantError for an unknown code', () => {
      const client = registerDCRClient();

      expect(() => store.challengeForAuthorizationCode(client, 'nope')).toThrow(
        InvalidGrantError,
      );
    });

    it('throws InvalidGrantError when the code belongs to another client', () => {
      const client = registerDCRClient();
      const other = registerDCRClient();
      const code = approve(client);

      expect(() => store.challengeForAuthorizationCode(other, code)).toThrow(
        InvalidGrantError,
      );
    });

    it('exchanges a code for tokens exactly once', () => {
      const client = registerDCRClient();
      const code = approve(client);

      const tokens = store.exchangeAuthorizationCode(client, code);

      expect(tokens.access_token).toEqual(expect.any(String));
      expect(tokens.refresh_token).toEqual(expect.any(String));
      expect(tokens.token_type).toBe('bearer');
      expect(() => store.exchangeAuthorizationCode(client, code)).toThrow(
        InvalidGrantError,
      );
    });

    it('expires an unused code after 60 seconds', () => {
      const client = registerDCRClient();
      const code = approve(client);

      vi.advanceTimersByTime(60 * 1000 + 1);

      expect(() => store.exchangeAuthorizationCode(client, code)).toThrow(
        InvalidGrantError,
      );
    });

    it('rejects a mismatched redirect URI', () => {
      const client = registerDCRClient();
      const code = approve(client);

      expect(() =>
        store.exchangeAuthorizationCode(client, code, 'http://localhost/other'),
      ).toThrow(InvalidGrantError);
    });

    it('rejects a mismatched resource', () => {
      const client = registerDCRClient();
      const code = approve(client);

      expect(() =>
        store.exchangeAuthorizationCode(
          client,
          code,
          undefined,
          resourceOf(OPEN_SERVER.name),
        ),
      ).toThrow(InvalidTargetError);
    });
  });

  describe('exchangeRefreshToken', () => {
    const issueTokens = (client: OAuthClientInformationFull) => {
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      return store.exchangeAuthorizationCode(client, code);
    };

    it('rotates the refresh token', () => {
      const client = registerDCRClient();
      const tokens = issueTokens(client);

      const rotated = store.exchangeRefreshToken(client, tokens.refresh_token!);

      expect(rotated.access_token).not.toBe(tokens.access_token);
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
      expect(() =>
        store.exchangeRefreshToken(client, tokens.refresh_token!),
      ).toThrow(InvalidGrantError);
    });

    it('throws InvalidGrantError for an unknown refresh token', () => {
      const client = registerDCRClient();

      expect(() => store.exchangeRefreshToken(client, 'nope')).toThrow(
        InvalidGrantError,
      );
    });
  });

  describe('verify', () => {
    it('returns AuthInfo for a live access token', () => {
      const client = registerDCRClient();
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      const tokens = store.exchangeAuthorizationCode(client, code);

      const info = store.verify(tokens.access_token);

      expect(info).toMatchObject({
        token: tokens.access_token,
        clientId: client.client_id,
        resource: resourceOf(OAUTH_SERVER.name),
      });
    });

    it('throws InvalidTokenError for an unknown token', () => {
      expect(() => store.verify('nope')).toThrow(InvalidTokenError);
    });
  });

  describe('revokeAll', () => {
    it('drops tokens and codes of the server but keeps DCR clients', () => {
      const client = registerDCRClient();
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      const tokens = store.exchangeAuthorizationCode(client, code);

      store.revokeAll(OAUTH_SERVER.name);

      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(0);
      expect(() => store.verify(tokens.access_token)).toThrow(
        InvalidTokenError,
      );
      expect(store.getClient(client.client_id)).toEqual(client);
    });
  });

  describe('tokenCount', () => {
    it('counts access and refresh tokens of the server', () => {
      const client = registerDCRClient();
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      store.exchangeAuthorizationCode(client, code);

      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(2);
      expect(store.tokenCount(OPEN_SERVER.name)).toBe(0);
    });
  });

  describe('listTokens', () => {
    const issue = (client: OAuthClientInformationFull, server: string) => {
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(server),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      return store.exchangeAuthorizationCode(client, code);
    };

    it('lists access and refresh tokens with their client and expiry', () => {
      const client = registerDCRClient();
      const tokens = issue(client, OAUTH_SERVER.name);

      expect(store.listTokens(OAUTH_SERVER.name)).toEqual([
        {
          id: expect.any(String),
          kind: 'access',
          value: tokens.access_token,
          clientId: client.client_id,
          clientName: 'Claude',
          scopes: [],
          issuedAt: 1792756800,
          expiresAt: 1792756800 + 3600,
        },
        {
          id: expect.any(String),
          kind: 'refresh',
          value: tokens.refresh_token,
          clientId: client.client_id,
          clientName: 'Claude',
          scopes: [],
          issuedAt: 1792756800,
          expiresAt: null,
        },
      ]);
    });

    it('names a pre-registered client', () => {
      const client = store.getClient('preregistered-client')!;
      issue(client, OAUTH_SERVER.name);

      expect(
        store.listTokens(OAUTH_SERVER.name).map((token) => token.clientName),
      ).toEqual(['weather (pre-registered)', 'weather (pre-registered)']);
    });

    it('lists the newest tokens first', () => {
      const client = registerDCRClient();
      const first = issue(client, OAUTH_SERVER.name);
      vi.advanceTimersByTime(1000);
      const second = issue(client, OAUTH_SERVER.name);

      expect(
        store.listTokens(OAUTH_SERVER.name).map((token) => token.value),
      ).toEqual([
        second.access_token,
        second.refresh_token,
        first.access_token,
        first.refresh_token,
      ]);
    });

    it('leaves out expired access tokens but keeps refresh tokens', () => {
      const client = registerDCRClient();
      const tokens = issue(client, OAUTH_SERVER.name);

      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(
        store.listTokens(OAUTH_SERVER.name).map((token) => token.value),
      ).toEqual([tokens.refresh_token]);
    });

    it('only lists the tokens of the server', () => {
      servers.set('forecast', {
        ...OAUTH_SERVER,
        name: 'forecast',
        auth: { ...OAUTH_SERVER.auth!, clientId: 'forecast-client' },
      });
      const client = registerDCRClient();
      issue(client, 'forecast');

      expect(store.listTokens(OAUTH_SERVER.name)).toEqual([]);
      expect(store.listTokens('forecast')).toHaveLength(2);
    });

    it('gives each token its own ID', () => {
      issue(registerDCRClient(), OAUTH_SERVER.name);

      const ids = store.listTokens(OAUTH_SERVER.name).map(({ id }) => id);

      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('revokeToken', () => {
    const issue = () => {
      const client = registerDCRClient();
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      return {
        client,
        tokens: store.exchangeAuthorizationCode(client, code),
      };
    };

    it('revokes an access token by ID', () => {
      const { tokens } = issue();
      const access = store
        .listTokens(OAUTH_SERVER.name)
        .find(({ kind }) => kind === 'access')!;

      expect(store.revokeToken(OAUTH_SERVER.name, access.id)).toBe(true);

      expect(() => store.verify(tokens.access_token)).toThrow(
        InvalidTokenError,
      );
      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(1);
    });

    it('revokes a refresh token by ID', () => {
      const { client, tokens } = issue();
      const refresh = store
        .listTokens(OAUTH_SERVER.name)
        .find(({ kind }) => kind === 'refresh')!;

      expect(store.revokeToken(OAUTH_SERVER.name, refresh.id)).toBe(true);

      expect(() =>
        store.exchangeRefreshToken(client, tokens.refresh_token!),
      ).toThrow(InvalidGrantError);
      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(1);
    });

    it('returns false for an unknown ID', () => {
      issue();

      expect(store.revokeToken(OAUTH_SERVER.name, 'nope')).toBe(false);
      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(2);
    });

    it('returns false for an ID that belongs to another server', () => {
      const { tokens } = issue();
      const [token] = store.listTokens(OAUTH_SERVER.name);

      expect(store.revokeToken('forecast', token.id)).toBe(false);
      expect(store.verify(tokens.access_token).token).toBe(tokens.access_token);
    });

    it('returns false the second time', () => {
      issue();
      const [token] = store.listTokens(OAUTH_SERVER.name);

      expect(store.revokeToken(OAUTH_SERVER.name, token.id)).toBe(true);
      expect(store.revokeToken(OAUTH_SERVER.name, token.id)).toBe(false);
    });
  });

  describe.each([
    ['serverAuthChanged' as const, { server: OAUTH_SERVER.name }],
    ['serverDeleted' as const, { server: OAUTH_SERVER.name }],
    ['serverRenamed' as const, { from: OAUTH_SERVER.name, to: 'forecast' }],
  ])('on %s', (event, payload) => {
    it('drops the server state', () => {
      const client = registerDCRClient();
      const requestId = store.beginConsent(client, {
        codeChallenge: 'challenge',
        redirectUri: client.redirect_uris[0],
        resource: resourceOf(OAUTH_SERVER.name),
      });
      const redirect = store.decide(requestId, true, 'http://localhost:6281')!;
      const code = new URL(redirect).searchParams.get('code')!;
      const tokens = store.exchangeAuthorizationCode(client, code);

      events.emit(event, payload);

      expect(() => store.verify(tokens.access_token)).toThrow(
        InvalidTokenError,
      );
      expect(store.tokenCount(OAUTH_SERVER.name)).toBe(0);
      expect(store.getClient(client.client_id)).toEqual(client);
    });
  });
});
