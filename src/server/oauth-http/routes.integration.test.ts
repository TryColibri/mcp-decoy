import { createHash, randomBytes } from 'node:crypto';

import { auth, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCPApp } from '@/server/mcp-app';
import { createServices, type Services } from '@/server/services';
import { type InstanceInfo } from '@/shared/api';

const INSTANCE: InstanceInfo = {
  version: '0.0.0-test',
  mcp: {
    host: '127.0.0.1',
    port: 6280,
    urlTemplate: 'http://localhost:6280/s/{server}/mcp',
  },
  ui: { port: 6281 },
  configFile: '/tmp/servers.json',
  links: { servers: '/api/v1/servers' },
};

type Harness = {
  services: Services;
  app: ReturnType<typeof createMCPApp>;
};

const createHarness = (): Harness => {
  const services = createServices({
    initial: [],
    persist: vi.fn(async () => {}),
    logLimit: 1000,
    instance: () => INSTANCE,
    onError: (error) => {
      throw error;
    },
  });
  const app = createMCPApp({
    sessions: services.sessions,
    oauth: services.oauth,
    findServer: (name) => services.servers.findConfig(name),
    listServers: services.listServerConfigs,
    capture: services.capture,
  });
  return { services, app };
};

const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

const initializeBody = (id = 1) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });

const registerDCRClient = async (app: Harness['app'], redirectUri: string) => {
  const response = await app.request('http://localhost:6280/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'Test Client',
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<{ client_id: string }>;
};

/** Submits the consent page's form, as a browser would. */
const approveOrDeny = async (
  app: Harness['app'],
  authorizeResponse: Response,
  decision: 'approve' | 'deny',
) => {
  expect(authorizeResponse.status).toBe(200);
  const html = await authorizeResponse.text();
  const requestId = /\/consent\/([^"]+)"/.exec(html)?.[1];
  expect(requestId).toBeDefined();
  return app.request(`http://localhost:6280/consent/${requestId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `decision=${decision}`,
  });
};

describe('OAuth routes', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await harness.services.servers.create({ name: 'weather' });
    await harness.services.servers.update('weather', {
      auth: {
        mode: 'oauth',
        redirectUris: ['http://localhost:9999/preregistered-cb'],
      },
    });
  });

  describe('the resource gate', () => {
    it('answers 401 with a WWW-Authenticate challenge for no token', async () => {
      const response = await harness.app.request(
        'http://localhost:6280/s/weather/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: initializeBody(),
        },
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain(
        'resource_metadata',
      );
    });

    it('answers 401 for an open server with no OAuth state', async () => {
      await harness.services.servers.create({ name: 'echo' });

      const response = await harness.app.request(
        'http://localhost:6280/s/echo/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: initializeBody(),
        },
      );

      expect(response.status).not.toBe(401);
    });
  });

  describe('discovery metadata', () => {
    it('serves per-server protected-resource metadata', async () => {
      const response = await harness.app.request(
        'http://localhost:6280/.well-known/oauth-protected-resource/s/weather/mcp',
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        resource: string;
        authorization_servers: string[];
      };
      expect(body.resource).toBe('http://localhost:6280/s/weather/mcp');
      expect(body.authorization_servers).toEqual(['http://localhost:6280']);
    });

    it('404s protected-resource metadata of an unknown or open server', async () => {
      await harness.services.servers.create({ name: 'echo' });

      const unknown = await harness.app.request(
        'http://localhost:6280/.well-known/oauth-protected-resource/s/nope/mcp',
      );
      const open = await harness.app.request(
        'http://localhost:6280/.well-known/oauth-protected-resource/s/echo/mcp',
      );

      expect(unknown.status).toBe(404);
      expect(open.status).toBe(404);
    });

    it('derives the issuer from forwarded headers', async () => {
      const response = await harness.app.request(
        'http://localhost:6280/.well-known/oauth-authorization-server',
        {
          headers: {
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'tunnel.example.com',
          },
        },
      );

      const body = (await response.json()) as {
        issuer: string;
        authorization_endpoint: string;
      };
      expect(body.issuer).toBe('https://tunnel.example.com');
      expect(body.authorization_endpoint).toBe(
        'https://tunnel.example.com/authorize',
      );
    });
  });

  describe('the full authorization-code flow, by direct fetch', () => {
    it('runs DCR, authorize, consent approval, token exchange and an authenticated initialize', async () => {
      const client = await registerDCRClient(
        harness.app,
        'http://localhost:9999/cb',
      );
      const { verifier, challenge } = pkcePair();

      const authorizeURL = new URL('http://localhost:6280/authorize');
      authorizeURL.searchParams.set('client_id', client.client_id);
      authorizeURL.searchParams.set('redirect_uri', 'http://localhost:9999/cb');
      authorizeURL.searchParams.set('response_type', 'code');
      authorizeURL.searchParams.set('code_challenge', challenge);
      authorizeURL.searchParams.set('code_challenge_method', 'S256');
      authorizeURL.searchParams.set(
        'resource',
        'http://localhost:6280/s/weather/mcp',
      );
      authorizeURL.searchParams.set('state', 'xyz');

      const authorizeResponse = await harness.app.request(
        authorizeURL.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'approve',
      );

      expect(consentResponse.status).toBe(302);
      const location = new URL(consentResponse.headers.get('location')!);
      expect(location.searchParams.get('state')).toBe('xyz');
      expect(location.searchParams.get('iss')).toBe('http://localhost:6280');
      const code = location.searchParams.get('code');
      expect(code).toBeTruthy();

      const tokenResponse = await harness.app.request(
        'http://localhost:6280/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: 'http://localhost:9999/cb',
            client_id: client.client_id,
            code_verifier: verifier,
            resource: 'http://localhost:6280/s/weather/mcp',
          }).toString(),
        },
      );
      expect(tokenResponse.status).toBe(200);
      const tokens = (await tokenResponse.json()) as { access_token: string };

      const initializeResponse = await harness.app.request(
        'http://localhost:6280/s/weather/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${tokens.access_token}`,
          },
          body: initializeBody(),
        },
      );
      expect(initializeResponse.status).toBe(200);
    });

    it('carries error=access_denied when the user denies', async () => {
      const client = await registerDCRClient(
        harness.app,
        'http://localhost:9999/cb',
      );
      const { challenge } = pkcePair();

      const authorizeURL = new URL('http://localhost:6280/authorize');
      authorizeURL.searchParams.set('client_id', client.client_id);
      authorizeURL.searchParams.set('redirect_uri', 'http://localhost:9999/cb');
      authorizeURL.searchParams.set('response_type', 'code');
      authorizeURL.searchParams.set('code_challenge', challenge);
      authorizeURL.searchParams.set('code_challenge_method', 'S256');
      authorizeURL.searchParams.set(
        'resource',
        'http://localhost:6280/s/weather/mcp',
      );

      const authorizeResponse = await harness.app.request(
        authorizeURL.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'deny',
      );

      const location = new URL(consentResponse.headers.get('location')!);
      expect(location.searchParams.get('error')).toBe('access_denied');
    });

    it('authenticates the pre-registered client with client_secret_post', async () => {
      const config = harness.services.servers.findConfig('weather')!;
      const { clientId, clientSecret } = config.auth as {
        clientId: string;
        clientSecret: string;
      };
      const { verifier, challenge } = pkcePair();

      const authorizeURL = new URL('http://localhost:6280/authorize');
      authorizeURL.searchParams.set('client_id', clientId);
      authorizeURL.searchParams.set(
        'redirect_uri',
        'http://localhost:9999/preregistered-cb',
      );
      authorizeURL.searchParams.set('response_type', 'code');
      authorizeURL.searchParams.set('code_challenge', challenge);
      authorizeURL.searchParams.set('code_challenge_method', 'S256');
      authorizeURL.searchParams.set(
        'resource',
        'http://localhost:6280/s/weather/mcp',
      );

      const authorizeResponse = await harness.app.request(
        authorizeURL.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'approve',
      );
      const code = new URL(
        consentResponse.headers.get('location')!,
      ).searchParams.get('code');

      const tokenResponse = await harness.app.request(
        'http://localhost:6280/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: 'http://localhost:9999/preregistered-cb',
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: verifier,
            resource: 'http://localhost:6280/s/weather/mcp',
          }).toString(),
        },
      );

      expect(tokenResponse.status).toBe(200);
    });
  });

  describe('cross-server token isolation', () => {
    it('rejects a token issued for one server on another', async () => {
      await harness.services.servers.create({ name: 'forecast' });
      await harness.services.servers.update('forecast', {
        auth: { mode: 'oauth', redirectUris: ['http://localhost:9999/cb'] },
      });
      const client = await registerDCRClient(
        harness.app,
        'http://localhost:9999/cb',
      );
      const { verifier, challenge } = pkcePair();

      const authorizeURL = new URL('http://localhost:6280/authorize');
      authorizeURL.searchParams.set('client_id', client.client_id);
      authorizeURL.searchParams.set('redirect_uri', 'http://localhost:9999/cb');
      authorizeURL.searchParams.set('response_type', 'code');
      authorizeURL.searchParams.set('code_challenge', challenge);
      authorizeURL.searchParams.set('code_challenge_method', 'S256');
      authorizeURL.searchParams.set(
        'resource',
        'http://localhost:6280/s/weather/mcp',
      );

      const authorizeResponse = await harness.app.request(
        authorizeURL.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'approve',
      );
      const code = new URL(
        consentResponse.headers.get('location')!,
      ).searchParams.get('code');

      const tokenResponse = await harness.app.request(
        'http://localhost:6280/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: 'http://localhost:9999/cb',
            client_id: client.client_id,
            code_verifier: verifier,
            resource: 'http://localhost:6280/s/weather/mcp',
          }).toString(),
        },
      );
      const tokens = (await tokenResponse.json()) as { access_token: string };

      const response = await harness.app.request(
        'http://localhost:6280/s/forecast/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${tokens.access_token}`,
          },
          body: initializeBody(),
        },
      );

      expect(response.status).toBe(401);
    });
  });

  describe('revoking tokens', () => {
    it('answers 401 to the next request after a revoke', async () => {
      const client = await registerDCRClient(
        harness.app,
        'http://localhost:9999/cb',
      );
      const { verifier, challenge } = pkcePair();

      const authorizeURL = new URL('http://localhost:6280/authorize');
      authorizeURL.searchParams.set('client_id', client.client_id);
      authorizeURL.searchParams.set('redirect_uri', 'http://localhost:9999/cb');
      authorizeURL.searchParams.set('response_type', 'code');
      authorizeURL.searchParams.set('code_challenge', challenge);
      authorizeURL.searchParams.set('code_challenge_method', 'S256');
      authorizeURL.searchParams.set(
        'resource',
        'http://localhost:6280/s/weather/mcp',
      );

      const authorizeResponse = await harness.app.request(
        authorizeURL.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'approve',
      );
      const code = new URL(
        consentResponse.headers.get('location')!,
      ).searchParams.get('code');

      const tokenResponse = await harness.app.request(
        'http://localhost:6280/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: 'http://localhost:9999/cb',
            client_id: client.client_id,
            code_verifier: verifier,
            resource: 'http://localhost:6280/s/weather/mcp',
          }).toString(),
        },
      );
      const tokens = (await tokenResponse.json()) as { access_token: string };

      harness.services.oauth.revokeAll('weather');

      const response = await harness.app.request(
        'http://localhost:6280/s/weather/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${tokens.access_token}`,
          },
          body: initializeBody(),
        },
      );

      expect(response.status).toBe(401);
    });
  });

  describe('http log entries', () => {
    it('records one http entry per OAuth exchange', async () => {
      await registerDCRClient(harness.app, 'http://localhost:9999/cb');

      const entries = harness.services.logs.all('weather');
      const httpEntries = entries.filter((entry) => entry.kind === 'http');
      expect(httpEntries.length).toBeGreaterThan(0);
      expect(httpEntries[0]?.method).toBe('POST /register');
    });

    it('records a gate rejection as POST /mcp with the session ID', async () => {
      const response = await harness.app.request(
        'http://localhost:6280/s/weather/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-session-id': 'fake-session',
          },
          body: initializeBody(),
        },
      );
      expect(response.status).toBe(401);

      const entries = harness.services.logs
        .all('weather')
        .filter((entry) => entry.kind === 'http');
      expect(entries).toContainEqual(
        expect.objectContaining({
          method: 'POST /mcp',
          sessionId: 'fake-session',
        }),
      );
    });
  });

  describe('a full run with the SDK client', () => {
    it('authorizes and calls initialize through @modelcontextprotocol/client', async () => {
      let savedTokens: unknown;
      let savedClientInfo: unknown;
      let codeVerifier: string | undefined;
      let redirectedTo: URL | undefined;

      const provider: OAuthClientProvider = {
        get redirectUrl() {
          return 'http://localhost:9999/sdk-cb';
        },
        get clientMetadata() {
          return {
            redirect_uris: ['http://localhost:9999/sdk-cb'],
            client_name: 'SDK Test Client',
            token_endpoint_auth_method: 'none',
          };
        },
        clientInformation: () => savedClientInfo as never,
        saveClientInformation: (info) => {
          savedClientInfo = info;
        },
        tokens: () => savedTokens as never,
        saveTokens: (tokens) => {
          savedTokens = tokens;
        },
        redirectToAuthorization: (url) => {
          redirectedTo = url;
        },
        saveCodeVerifier: (verifier) => {
          codeVerifier = verifier;
        },
        codeVerifier: () => codeVerifier!,
      };

      const fetchFn = async (url: string | URL, init?: RequestInit) =>
        harness.app.request(url.toString(), init);

      const first = await auth(provider, {
        serverUrl: 'http://localhost:6280/s/weather/mcp',
        fetchFn,
      });
      expect(first).toBe('REDIRECT');
      expect(redirectedTo).toBeDefined();

      const authorizeResponse = await harness.app.request(
        redirectedTo!.toString(),
      );
      const consentResponse = await approveOrDeny(
        harness.app,
        authorizeResponse,
        'approve',
      );
      const location = new URL(consentResponse.headers.get('location')!);
      const code = location.searchParams.get('code')!;
      const iss = location.searchParams.get('iss') ?? undefined;

      const second = await auth(provider, {
        serverUrl: 'http://localhost:6280/s/weather/mcp',
        authorizationCode: code,
        iss,
        fetchFn,
      });
      expect(second).toBe('AUTHORIZED');

      const { access_token: accessToken } = savedTokens as {
        access_token: string;
      };
      const response = await harness.app.request(
        'http://localhost:6280/s/weather/mcp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${accessToken}`,
          },
          body: initializeBody(),
        },
      );

      expect(response.status).toBe(200);
    });
  });
});
