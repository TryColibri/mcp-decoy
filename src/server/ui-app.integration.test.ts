import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCPApp } from '@/server/mcp-app';
import { createServices, type Services } from '@/server/services';
import { SKILL } from '@/server/skill';
import { createUIApp } from '@/server/ui-app';
import {
  type InstanceInfo,
  instanceInfoSchema,
  logEntrySchema,
  logEvictedSchema,
  type LogFact,
  logPageSchema,
  type MCPEntry,
  type MCPFact,
  oauthTokenListSchema,
  problemSchema,
  type ServerConfig,
  serverListSchema,
  serverSummarySchema,
  mcpClientListSchema,
  toolListSchema,
  toolSchema,
} from '@/shared/api';

const PORT = 6281;
const ORIGIN = `http://localhost:${PORT}`;

const INSTANCE: InstanceInfo = {
  version: '0.0.0-test',
  mcp: {
    host: '127.0.0.1',
    port: 6280,
    urlTemplate: 'http://localhost:6280/s/{server}/mcp',
  },
  ui: { port: PORT },
  configFile: '/tmp/servers.json',
  links: { servers: '/api/v1/servers' },
};

type RequestOptions = {
  method?: string;
  json?: unknown;
  headers?: Record<string, string>;
};

describe('uiApp', () => {
  let services: Services;
  let persist: ReturnType<
    typeof vi.fn<(servers: ServerConfig[]) => Promise<void>>
  >;
  let app: ReturnType<typeof createUIApp>;

  const request = async (
    path: string,
    { method = 'GET', json, headers = {} }: RequestOptions = {},
  ) =>
    app.request(`http://localhost:${PORT}${path}`, {
      method,
      headers: {
        host: `localhost:${PORT}`,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });

  const expectProblem = async (
    response: Response,
    status: number,
    type: string,
  ) => {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    const problem = problemSchema.parse(await response.json());
    expect(problem).toMatchObject({
      status,
      type: `https://mcp-decoy.dev/problems/${type}`,
    });
    return problem;
  };

  beforeEach(() => {
    persist = vi.fn(async () => {});
    services = createServices({
      initial: [],
      persist,
      logLimit: 1000,
      instance: () => INSTANCE,
      onError: (error) => {
        throw error;
      },
    });
    app = createUIApp({
      api: services.api,
      port: () => PORT,
      staticRoot: null,
      dev: false,
    });
  });

  afterEach(async () => {
    await services.mcp.closeAll();
  });

  describe('GET /api/v1', () => {
    it('returns instance info', async () => {
      const response = await request('/api/v1');

      expect(response.status).toBe(200);
      expect(instanceInfoSchema.parse(await response.json())).toEqual(INSTANCE);
    });
  });

  describe('GET /SKILL.md', () => {
    it('serves the agent skill as Markdown', async () => {
      const response = await request('/SKILL.md');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/markdown; charset=UTF-8',
      );
      await expect(response.text()).resolves.toBe(SKILL);
    });

    it('is also served when the SPA is', async () => {
      const root = await mkdtemp(join(tmpdir(), 'mcp-decoy-ui-'));
      try {
        await writeFile(join(root, 'index.html'), '<!doctype html>');
        app = createUIApp({
          api: services.api,
          port: () => PORT,
          staticRoot: root,
          dev: false,
        });

        const response = await request('/SKILL.md');

        await expect(response.text()).resolves.toBe(SKILL);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('answers a foreign Host with 403', async () => {
      const response = await request('/SKILL.md', {
        headers: { host: 'evil.example' },
      });

      await expectProblem(response, 403, 'forbidden');
    });
  });

  describe('GET /llms-full.txt', () => {
    it('serves the same text as the skill', async () => {
      const response = await request('/llms-full.txt');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/markdown; charset=UTF-8',
      );
      await expect(response.text()).resolves.toBe(SKILL);
    });
  });

  describe('GET /llms.txt', () => {
    it('serves an index that links to the skill and the API', async () => {
      const response = await request('/llms.txt');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'text/markdown; charset=UTF-8',
      );
      const text = await response.text();
      expect(text).toMatch(/^# MCP Decoy\n\n> /);
      expect(text).toContain(`(${ORIGIN}/SKILL.md)`);
      expect(text).toContain(`(${ORIGIN}/api/v1)`);
      expect(text).toContain(`(${ORIGIN}/llms-full.txt)`);
    });
  });

  describe('servers', () => {
    it('creates, lists, gets and deletes a server', async () => {
      const created = await request('/api/v1/servers', {
        method: 'POST',
        json: { name: 'weather', instructions: 'Fake data.' },
      });
      expect(created.status).toBe(201);
      expect(created.headers.get('location')).toBe('/api/v1/servers/weather');
      expect(serverSummarySchema.parse(await created.json())).toEqual({
        name: 'weather',
        serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
        instructions: 'Fake data.',
        createdAt: expect.any(String),
        mcpUrl: 'http://localhost:6280/s/weather/mcp',
        toolCount: 0,
        publishedToolCount: 0,
        clientCount: 0,
        auth: { mode: 'none' },
        protocol: { eras: 'both', cache: { ttlMs: 0, scope: 'private' } },
      });
      expect(persist).toHaveBeenCalledTimes(1);

      const list = await request('/api/v1/servers');
      expect(serverListSchema.parse(await list.json()).items).toHaveLength(1);

      const one = await request('/api/v1/servers/weather');
      expect(serverSummarySchema.parse(await one.json()).name).toBe('weather');

      const deleted = await request('/api/v1/servers/weather', {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(204);

      await expectProblem(
        await request('/api/v1/servers/weather'),
        404,
        'not-found',
      );
    });

    it('updates a server and moves it when renamed', async () => {
      await request('/api/v1/servers', {
        method: 'POST',
        json: { name: 'weather' },
      });

      const edited = await request('/api/v1/servers/weather', {
        method: 'PATCH',
        json: { serverInfo: { version: '2.0.0' }, instructions: 'Fake data.' },
      });
      expect(edited.status).toBe(200);
      expect(edited.headers.get('location')).toBeNull();
      expect(serverSummarySchema.parse(await edited.json())).toMatchObject({
        name: 'weather',
        serverInfo: { name: 'mcp-decoy/weather', version: '2.0.0' },
        instructions: 'Fake data.',
      });

      const renamed = await request('/api/v1/servers/weather', {
        method: 'PATCH',
        json: { name: 'forecast' },
      });
      expect(renamed.status).toBe(200);
      expect(renamed.headers.get('location')).toBe('/api/v1/servers/forecast');
      expect(serverSummarySchema.parse(await renamed.json()).mcpUrl).toBe(
        'http://localhost:6280/s/forecast/mcp',
      );
      await expectProblem(
        await request('/api/v1/servers/weather'),
        404,
        'not-found',
      );
    });

    it('answers 409 when renaming onto an existing server', async () => {
      await request('/api/v1/servers', { method: 'POST', json: { name: 'a' } });
      await request('/api/v1/servers', { method: 'POST', json: { name: 'b' } });

      await expectProblem(
        await request('/api/v1/servers/a', {
          method: 'PATCH',
          json: { name: 'b' },
        }),
        409,
        'conflict',
      );
    });

    it('answers 422 for an invalid update and 404 for an unknown server', async () => {
      await request('/api/v1/servers', { method: 'POST', json: { name: 'a' } });

      await expectProblem(
        await request('/api/v1/servers/a', {
          method: 'PATCH',
          json: { name: 'Not A Slug' },
        }),
        422,
        'validation',
      );
      await expectProblem(
        await request('/api/v1/servers/nope', {
          method: 'PATCH',
          json: {},
        }),
        404,
        'not-found',
      );
    });

    it('answers 409 for a duplicate name', async () => {
      await request('/api/v1/servers', { method: 'POST', json: { name: 'a' } });

      await expectProblem(
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'a' },
        }),
        409,
        'conflict',
      );
    });

    it('answers 422 with field errors for an invalid body', async () => {
      const problem = await expectProblem(
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'Not A Slug', extra: true },
        }),
        422,
        'validation',
      );

      expect(problem.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name' }),
          expect.objectContaining({ path: '' }),
        ]),
      );
    });

    it('answers 404 for an unknown API route', async () => {
      await expectProblem(await request('/api/v1/nope'), 404, 'not-found');
      await expectProblem(await request('/api/v2'), 404, 'not-found');
    });

    describe('auth', () => {
      beforeEach(async () => {
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'weather' },
        });
      });

      it('switches a server to OAuth and back', async () => {
        const toOAuth = await request('/api/v1/servers/weather', {
          method: 'PATCH',
          json: {
            auth: {
              mode: 'oauth',
              redirectUris: ['http://localhost:9999/cb'],
            },
          },
        });
        expect(toOAuth.status).toBe(200);
        const summary = serverSummarySchema.parse(await toOAuth.json());
        expect(summary.auth).toMatchObject({
          mode: 'oauth',
          clientId: expect.any(String),
          clientSecret: expect.any(String),
          redirectUris: ['http://localhost:9999/cb'],
          clientScopes: ['mcp'],
          tokenCount: 0,
        });

        const toNone = await request('/api/v1/servers/weather', {
          method: 'PATCH',
          json: { auth: { mode: 'none' } },
        });
        expect(serverSummarySchema.parse(await toNone.json()).auth).toEqual({
          mode: 'none',
        });
      });

      it('sets the pre-registered client scopes', async () => {
        const response = await request('/api/v1/servers/weather', {
          method: 'PATCH',
          json: {
            auth: { mode: 'oauth', clientScopes: ['mcp', 'files:read'] },
          },
        });

        expect(response.status).toBe(200);
        expect(
          serverSummarySchema.parse(await response.json()).auth,
        ).toMatchObject({ clientScopes: ['mcp', 'files:read'] });
      });

      it.each([
        ['a scope with a space', { clientScopes: ['two words'] }],
        ['a scope policy, which no longer exists', { scopePolicy: 'strict' }],
      ])('answers 422 for %s', async (_, fields) => {
        await expectProblem(
          await request('/api/v1/servers/weather', {
            method: 'PATCH',
            json: { auth: { mode: 'oauth', ...fields } },
          }),
          422,
          'validation',
        );
      });

      it('answers 422 for a redirect URI that is not an absolute URL', async () => {
        await expectProblem(
          await request('/api/v1/servers/weather', {
            method: 'PATCH',
            json: { auth: { mode: 'oauth', redirectUris: ['not-a-url'] } },
          }),
          422,
          'validation',
        );
      });
    });

    describe('oauth/tokens', () => {
      const createOAuthServer = async () => {
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'weather' },
        });
        await request('/api/v1/servers/weather', {
          method: 'PATCH',
          json: {
            auth: {
              mode: 'oauth',
              redirectUris: ['http://localhost:9999/cb'],
            },
          },
        });
      };

      const issueTokens = () => {
        const client = services.oauth.registerClient({
          redirect_uris: ['http://localhost:9999/cb'],
          client_name: 'Claude',
        });
        const requestId = services.oauth.beginConsent(client, {
          codeChallenge: 'challenge',
          redirectUri: 'http://localhost:9999/cb',
          resource: new URL('http://localhost:6280/s/weather/mcp'),
        });
        const redirect = services.oauth.decide(
          requestId,
          true,
          'http://localhost:6281',
        )!;
        const code = new URL(redirect).searchParams.get('code')!;
        return services.oauth.exchangeAuthorizationCode(client, code);
      };

      describe('GET', () => {
        it('lists no tokens, then the issued ones', async () => {
          await createOAuthServer();

          const empty = await request('/api/v1/servers/weather/oauth/tokens');
          expect(empty.status).toBe(200);
          expect(oauthTokenListSchema.parse(await empty.json()).items).toEqual(
            [],
          );

          const tokens = issueTokens();
          const list = await request('/api/v1/servers/weather/oauth/tokens');

          expect(list.status).toBe(200);
          const { items } = oauthTokenListSchema.parse(await list.json());
          expect(items).toEqual([
            expect.objectContaining({
              kind: 'access',
              value: tokens.access_token,
              clientName: 'Claude',
              expiresAt: expect.any(String),
            }),
            expect.objectContaining({
              kind: 'refresh',
              value: tokens.refresh_token,
              clientName: 'Claude',
              expiresAt: null,
            }),
          ]);
        });

        it('answers 409 off OAuth and 404 for an unknown server', async () => {
          await request('/api/v1/servers', {
            method: 'POST',
            json: { name: 'echo' },
          });

          await expectProblem(
            await request('/api/v1/servers/echo/oauth/tokens'),
            409,
            'conflict',
          );
          await expectProblem(
            await request('/api/v1/servers/nope/oauth/tokens'),
            404,
            'not-found',
          );
        });
      });

      describe('DELETE', () => {
        it('revokes tokens with 204, 409 off OAuth and 404 for an unknown server', async () => {
          await createOAuthServer();

          const revoked = await request(
            '/api/v1/servers/weather/oauth/tokens',
            { method: 'DELETE' },
          );
          expect(revoked.status).toBe(204);

          await request('/api/v1/servers', {
            method: 'POST',
            json: { name: 'echo' },
          });
          await expectProblem(
            await request('/api/v1/servers/echo/oauth/tokens', {
              method: 'DELETE',
            }),
            409,
            'conflict',
          );
          await expectProblem(
            await request('/api/v1/servers/nope/oauth/tokens', {
              method: 'DELETE',
            }),
            404,
            'not-found',
          );
        });
      });

      describe('DELETE /{token}', () => {
        it('revokes one token with 204, then answers 404', async () => {
          await createOAuthServer();
          const tokens = issueTokens();
          const listed = oauthTokenListSchema.parse(
            await (
              await request('/api/v1/servers/weather/oauth/tokens')
            ).json(),
          ).items;
          const access = listed.find(({ kind }) => kind === 'access')!;

          const revoked = await request(
            `/api/v1/servers/weather/oauth/tokens/${access.id}`,
            { method: 'DELETE' },
          );

          expect(revoked.status).toBe(204);
          expect(() => services.oauth.verify(tokens.access_token)).toThrow(
            'Invalid or expired access token',
          );
          const remaining = oauthTokenListSchema.parse(
            await (
              await request('/api/v1/servers/weather/oauth/tokens')
            ).json(),
          ).items;
          expect(remaining.map(({ kind }) => kind)).toEqual(['refresh']);
          await expectProblem(
            await request(`/api/v1/servers/weather/oauth/tokens/${access.id}`, {
              method: 'DELETE',
            }),
            404,
            'not-found',
          );
        });

        it('answers 409 off OAuth and 404 for an unknown server', async () => {
          await request('/api/v1/servers', {
            method: 'POST',
            json: { name: 'echo' },
          });

          await expectProblem(
            await request('/api/v1/servers/echo/oauth/tokens/abc', {
              method: 'DELETE',
            }),
            409,
            'conflict',
          );
          await expectProblem(
            await request('/api/v1/servers/nope/oauth/tokens/abc', {
              method: 'DELETE',
            }),
            404,
            'not-found',
          );
        });
      });
    });
  });

  describe('tools', () => {
    beforeEach(async () => {
      await services.servers.create({ name: 'weather' });
    });

    it('creates, updates, publishes, renames and deletes a tool', async () => {
      const created = await request('/api/v1/servers/weather/tools', {
        method: 'POST',
        json: { name: 'get_forecast' },
      });
      expect(created.status).toBe(201);
      expect(created.headers.get('location')).toBe(
        '/api/v1/servers/weather/tools/get_forecast',
      );
      expect(toolSchema.parse(await created.json())).toMatchObject({
        name: 'get_forecast',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        published: false,
      });

      const patched = await request(
        '/api/v1/servers/weather/tools/get_forecast',
        {
          method: 'PATCH',
          json: {
            description: 'Forecast',
            responseTemplate: {
              content: [{ type: 'text', text: '${args.city.name}' }],
            },
          },
        },
      );
      expect(patched.status).toBe(200);
      const patchedTool = toolSchema.parse(await patched.json());
      expect(patchedTool.description).toBe('Forecast');

      const published = await request(
        '/api/v1/servers/weather/tools/get_forecast',
        { method: 'PATCH', json: { published: true } },
      );
      expect(toolSchema.parse(await published.json()).published).toBe(true);

      const renamed = await request(
        '/api/v1/servers/weather/tools/get_forecast',
        {
          method: 'PATCH',
          json: { name: 'forecast' },
        },
      );
      expect(renamed.headers.get('location')).toBe(
        '/api/v1/servers/weather/tools/forecast',
      );

      const list = await request('/api/v1/servers/weather/tools');
      expect(
        toolListSchema.parse(await list.json()).items.map((tool) => tool.name),
      ).toEqual(['forecast']);

      const server = await request('/api/v1/servers/weather');
      expect(serverSummarySchema.parse(await server.json())).toMatchObject({
        toolCount: 1,
        publishedToolCount: 1,
      });

      const deleted = await request('/api/v1/servers/weather/tools/forecast', {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(204);
      await expectProblem(
        await request('/api/v1/servers/weather/tools/forecast'),
        404,
        'not-found',
      );
    });

    it('rejects an input schema that is not an object schema', async () => {
      const problem = await expectProblem(
        await request('/api/v1/servers/weather/tools', {
          method: 'POST',
          json: { name: 'x', inputSchema: { type: 'string' } },
        }),
        422,
        'validation',
      );

      expect(problem.errors).toEqual([
        expect.objectContaining({ path: 'inputSchema.type' }),
      ]);
    });

    it('accepts every MCP tool hint', async () => {
      const annotations = {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      };

      const created = await request('/api/v1/servers/weather/tools', {
        method: 'POST',
        json: { name: 'get_forecast', annotations },
      });

      expect(created.status).toBe(201);
      expect(toolSchema.parse(await created.json()).annotations).toEqual(
        annotations,
      );
    });

    it('answers 409 when renaming onto an existing tool', async () => {
      await services.tools.create('weather', { name: 'a' });
      await services.tools.create('weather', { name: 'b' });

      await expectProblem(
        await request('/api/v1/servers/weather/tools/a', {
          method: 'PATCH',
          json: { name: 'b' },
        }),
        409,
        'conflict',
      );
    });

    it('answers 404 for tools of an unknown server', async () => {
      await expectProblem(
        await request('/api/v1/servers/nope/tools'),
        404,
        'not-found',
      );
    });
  });

  describe('clients and logs', () => {
    const connect = async () => {
      const mcpApp = createMCPApp({
        mcp: services.mcp,
        oauth: services.oauth,
        findServer: (name) => services.servers.findConfig(name),
        listServers: services.listServerConfigs,
        capture: services.capture,
      });
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(
        new URL('http://localhost:6280/s/weather/mcp'),
        { fetch: async (url, init) => mcpApp.request(url, init) },
      );
      await client.connect(transport);
      return { client, transport };
    };

    beforeEach(async () => {
      await services.servers.create({ name: 'weather' });
    });

    it('lists and closes sessions as legacy clients', async () => {
      const { transport } = await connect();

      const list = await request('/api/v1/servers/weather/clients');
      const clients = mcpClientListSchema.parse(await list.json()).items;
      expect(clients).toEqual([
        expect.objectContaining({
          id: transport.sessionId,
          era: 'legacy',
          clientInfo: { name: 'test-client', version: '1.0.0' },
          oauthClientId: null,
        }),
      ]);
      const server = await request('/api/v1/servers/weather');
      expect(serverSummarySchema.parse(await server.json()).clientCount).toBe(
        1,
      );

      const closed = await request(
        `/api/v1/servers/weather/clients/${encodeURIComponent(transport.sessionId ?? '')}`,
        { method: 'DELETE' },
      );
      expect(closed.status).toBe(204);
      await expectProblem(
        await request('/api/v1/servers/weather/clients/nope', {
          method: 'DELETE',
        }),
        404,
        'not-found',
      );
    });

    it('lists and forgets stateless clients', async () => {
      const mcpApp = createMCPApp({
        mcp: services.mcp,
        oauth: services.oauth,
        findServer: (name) => services.servers.findConfig(name),
        listServers: services.listServerConfigs,
        capture: services.capture,
      });
      const client = new Client(
        { name: 'auto-client', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL('http://localhost:6280/s/weather/mcp'),
          { fetch: async (url, init) => mcpApp.request(url, init) },
        ),
      );
      await client.listTools();

      const list = await request('/api/v1/servers/weather/clients');
      const clients = mcpClientListSchema.parse(await list.json()).items;
      expect(clients).toEqual([
        expect.objectContaining({
          id: 'info:auto-client/2.0.0',
          era: 'modern',
          clientInfo: { name: 'auto-client', version: '2.0.0' },
          oauthClientId: null,
          openStreams: 0,
        }),
      ]);

      const closed = await request(
        `/api/v1/servers/weather/clients/${encodeURIComponent('info:auto-client/2.0.0')}`,
        { method: 'DELETE' },
      );
      expect(closed.status).toBe(204);
      const after = await request('/api/v1/servers/weather/clients');
      expect(mcpClientListSchema.parse(await after.json()).items).toEqual([]);
      await expectProblem(
        await request(
          `/api/v1/servers/weather/clients/${encodeURIComponent('info:auto-client/2.0.0')}`,
          { method: 'DELETE' },
        ),
        404,
        'not-found',
      );
    });

    it('filters logs by client', async () => {
      const { client, transport } = await connect();
      await client.listTools();
      const sessionId = transport.sessionId ?? '';

      const mine = logPageSchema.parse(
        await (
          await request(
            `/api/v1/servers/weather/logs?client=${encodeURIComponent(sessionId)}`,
          )
        ).json(),
      );
      const other = logPageSchema.parse(
        await (
          await request('/api/v1/servers/weather/logs?client=someone-else')
        ).json(),
      );

      expect(mine.total).toBe(services.logs.all('weather').length);
      expect(other.items).toEqual([]);
      expect(other.total).toBe(0);
    });

    it('paginates logs newest first with a cursor', async () => {
      const { client } = await connect();
      await client.listTools();
      const total = services.logs.all('weather').length;

      const first = logPageSchema.parse(
        await (await request('/api/v1/servers/weather/logs?limit=2')).json(),
      );
      expect(first.items).toHaveLength(2);
      expect(first.items[0].id).toBeGreaterThan(first.items[1].id);
      expect(first.nextCursor).toEqual(expect.any(String));

      const ids = first.items.map((entry) => entry.id);
      let cursor = first.nextCursor;
      while (cursor !== null) {
        const page = logPageSchema.parse(
          await (
            await request(
              `/api/v1/servers/weather/logs?limit=2&cursor=${cursor}`,
            )
          ).json(),
        );
        ids.push(...page.items.map((entry) => entry.id));
        cursor = page.nextCursor;
      }
      expect(ids).toHaveLength(total);
      expect(new Set(ids).size).toBe(total);
    });

    it('searches logs through every fact of an entry', async () => {
      const { client } = await connect();
      await client.listTools();

      const page = logPageSchema.parse(
        await (
          await request('/api/v1/servers/weather/logs?q=TOOLS/LIST')
        ).json(),
      );

      const mcp = page.items.filter(
        (entry): entry is MCPEntry => entry.type === 'mcp',
      );
      expect(mcp.map((entry) => entry.message.method)).toEqual(['tools/list']);
      // The POST that carried the request mentions it too.
      expect(page.items.filter((entry) => entry.type === 'http')).toHaveLength(
        1,
      );
    });

    it('returns the highest fact id as after, and filters by carriedBy', async () => {
      append(services.store, 'tools/list');
      const carried = append(services.store, 'notifications/x', {
        kind: 'notification',
        carriedBy: 77,
      });
      append(services.store, 'tools/call');

      const page = logPageSchema.parse(
        await (
          await request('/api/v1/servers/weather/logs?carriedBy=77')
        ).json(),
      );

      expect(page.items.map((entry) => entry.id)).toEqual([carried.id]);
      expect(page.total).toBe(1);
      expect(page.after).toBe(services.store.lastId());
    });

    const append = (
      store: Services['store'],
      method: string,
      fields: Partial<Omit<MCPFact, 'id' | 'type'>> = {},
    ): LogFact =>
      store.append({
        type: 'mcp',
        at: '2026-10-21T12:00:00.000Z',
        server: 'weather',
        sessionId: null,
        client: null,
        from: 'client',
        kind: 'request',
        method,
        jsonrpcId: 1,
        raw: `{"jsonrpc":"2.0","id":1,"method":"${method}"}`,
        truncated: false,
        carriedBy: null,
        sse: null,
        replyTo: null,
        durationMs: null,
        ...fields,
      });

    /** Reads a response body as text until a needle shows up. */
    const sseReader = (response: Response) => {
      const reader = response
        .body!.pipeThrough(new TextDecoderStream())
        .getReader();
      let text = '';
      return {
        text: () => text,
        readUntil: async (needle: string) => {
          while (!text.includes(needle)) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }
            text += value;
          }
        },
        cancel: async () => reader.cancel(),
      };
    };

    it('reports the total of matching entries on every page', async () => {
      for (const method of ['tools/list', 'tools/call', 'tools/list']) {
        append(services.store, method);
      }
      append(services.store, 'tools/call');
      append(services.store, 'initialize');
      const getPage = async (query: string) =>
        logPageSchema.parse(
          await (await request(`/api/v1/servers/weather/logs?${query}`)).json(),
        );

      const all = await getPage('limit=2');
      const allOlder = await getPage(`limit=2&cursor=${all.nextCursor ?? ''}`);
      const calls = await getPage('limit=1&q=TOOLS/CALL');
      const callsOlder = await getPage(
        `limit=1&q=TOOLS/CALL&cursor=${calls.nextCursor ?? ''}`,
      );

      expect([all.total, allOlder.total]).toEqual([5, 5]);
      expect([calls.total, callsOlder.total]).toEqual([2, 2]);
      expect(callsOlder.nextCursor).toBeNull();
    });

    it('streams only the entries matching q, backlog and live', async () => {
      const old = append(services.store, 'tools/call');
      append(services.store, 'tools/list');

      const response = await request(
        '/api/v1/servers/weather/logs/stream?after=0&q=tools/call',
      );
      const stream = sseReader(response);
      await stream.readUntil(`id: ${old.id}\n`);
      const skipped = append(services.store, 'tools/list');
      const live = append(services.store, 'tools/call');
      await stream.readUntil(`id: ${live.id}\n`);
      await stream.cancel();

      expect(stream.text()).not.toContain(`id: ${skipped.id}\n`);
      expect(stream.text().match(/event: fact/g)).toHaveLength(2);
    });

    it('sends evicted over SSE for matching entries only', async () => {
      const small = createServices({
        initial: [],
        persist: vi.fn(async () => {}),
        logLimit: 3,
        instance: () => INSTANCE,
        onError: (error) => {
          throw error;
        },
      });
      await small.servers.create({ name: 'weather' });
      const smallApp = createUIApp({
        api: small.api,
        port: () => PORT,
        staticRoot: null,
        dev: false,
      });
      const evictedCall = append(small.store, 'tools/call');
      const evictedList = append(small.store, 'tools/list');
      append(small.store, 'tools/list');
      const response = await smallApp.request(
        `${ORIGIN}/api/v1/servers/weather/logs/stream?after=${evictedList.id}&q=tools/call`,
        { headers: { host: `localhost:${PORT}` } },
      );
      const stream = sseReader(response);

      append(small.store, 'tools/list');
      append(small.store, 'tools/list');
      await stream.readUntil('event: evicted');
      await stream.cancel();
      await small.mcp.closeAll();

      const data = /event: evicted\ndata: (.*)\n/.exec(stream.text());
      expect(logEvictedSchema.parse(JSON.parse(data?.[1] ?? ''))).toEqual({
        id: evictedCall.id,
      });
      expect(stream.text().match(/event: evicted/g)).toHaveLength(1);
    });

    it('streams a late anchor without an id, then its attachment with one', async () => {
      const anchor = append(services.store, 'tools/call');
      const response = await request(
        `/api/v1/servers/weather/logs/stream?after=${services.store.lastId()}&q=needle`,
      );
      const stream = sseReader(response);

      const reply = append(services.store, '', {
        from: 'server',
        kind: 'response',
        method: null,
        raw: '{"jsonrpc":"2.0","id":1,"result":"needle"}',
        replyTo: anchor.id,
      });
      await stream.readUntil(`id: ${reply.id}\n`);
      await stream.cancel();

      const [late, attachment] = stream
        .text()
        .split('\n\n')
        .filter((block) => block.includes('event: fact'));
      expect(late).not.toContain('id: ');
      expect(JSON.parse(/data: (.*)/.exec(late)?.[1] ?? '')).toMatchObject({
        id: anchor.id,
        type: 'mcp',
      });
      expect(attachment).toContain(`id: ${reply.id}`);
    });

    it('resumes from Last-Event-ID by fact id', async () => {
      append(services.store, 'tools/call');
      const last = append(services.store, 'tools/call');

      const response = await request(
        '/api/v1/servers/weather/logs/stream?after=0&q=tools/call',
        { headers: { 'last-event-id': String(last.id) } },
      );
      const stream = sseReader(response);
      const next = append(services.store, 'tools/call');
      await stream.readUntil(`id: ${next.id}\n`);
      await stream.cancel();

      expect(stream.text().match(/event: fact/g)).toHaveLength(1);
      expect(stream.text()).not.toContain(`id: ${last.id}\n`);
    });

    it('returns one entry by the id of its anchor', async () => {
      await connect();
      const initialize = services.logs
        .all('weather')
        .find(
          (entry): entry is MCPEntry =>
            entry.type === 'mcp' && entry.message.method === 'initialize',
        );

      const response = await request(
        `/api/v1/servers/weather/logs/${initialize?.id ?? 0}`,
      );

      expect(response.status).toBe(200);
      expect(logEntrySchema.parse(await response.json())).toEqual(initialize);
    });

    it('answers 404 for the id of an attachment', async () => {
      await connect();
      const initialize = services.logs
        .all('weather')
        .find(
          (entry): entry is MCPEntry =>
            entry.type === 'mcp' && entry.message.method === 'initialize',
        );

      await expectProblem(
        await request(
          `/api/v1/servers/weather/logs/${initialize?.reply?.id ?? 0}`,
        ),
        404,
        'not-found',
      );
    });

    it('answers 404 for an unknown log entry', async () => {
      await expectProblem(
        await request('/api/v1/servers/weather/logs/999999'),
        404,
        'not-found',
      );
    });

    it('rejects an invalid cursor or limit', async () => {
      await expectProblem(
        await request('/api/v1/servers/weather/logs?cursor=nope'),
        422,
        'validation',
      );
      await expectProblem(
        await request('/api/v1/servers/weather/logs?limit=0'),
        422,
        'validation',
      );
    });

    it('exports and clears logs', async () => {
      await connect();

      const exported = await request('/api/v1/servers/weather/logs/export');
      expect(exported.headers.get('content-type')).toBe('application/x-ndjson');
      expect(exported.headers.get('content-disposition')).toContain(
        'attachment',
      );
      const lines = (await exported.text()).trim().split('\n');
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        logEntrySchema.parse(JSON.parse(line));
      }

      const cleared = await request('/api/v1/servers/weather/logs', {
        method: 'DELETE',
      });
      expect(cleared.status).toBe(204);
      expect(services.logs.all('weather')).toEqual([]);
    });

    it('streams the backlog then live entries over SSE', async () => {
      await connect();
      const backlog = services.logs.all('weather');
      const after = backlog[0].id;

      const response = await request(
        `/api/v1/servers/weather/logs/stream?after=${after}`,
      );
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      const reader = response
        .body!.pipeThrough(new TextDecoderStream())
        .getReader();

      let text = '';
      const readUntil = async (needle: string) => {
        while (!text.includes(needle)) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          text += value;
        }
      };

      await readUntil(`id: ${backlog.at(-1)!.id}\n`);
      expect(text).not.toContain(`id: ${after}\n`);

      services.logs.clear('weather');
      await readUntil('event: cleared');
      await reader.cancel();
    });
  });

  describe('Host and CSRF checks', () => {
    it('rejects a foreign Host', async () => {
      await expectProblem(
        await request('/api/v1', { headers: { host: 'evil.example:6281' } }),
        403,
        'forbidden',
      );
    });

    it('accepts 127.0.0.1 as Host', async () => {
      const response = await request('/api/v1', {
        headers: { host: `127.0.0.1:${PORT}` },
      });

      expect(response.status).toBe(200);
    });

    it('rejects a mutating request without a JSON content type', async () => {
      const response = await app.request(`${ORIGIN}/api/v1/servers`, {
        method: 'POST',
        headers: { host: `localhost:${PORT}`, 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'a' }),
      });

      await expectProblem(response, 415, 'unsupported-media-type');
    });

    it('rejects a mutating request from a foreign Origin', async () => {
      await expectProblem(
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'a' },
          headers: { origin: 'http://evil.example' },
        }),
        403,
        'forbidden',
      );
    });

    it('accepts a mutating request from its own Origin', async () => {
      const response = await request('/api/v1/servers', {
        method: 'POST',
        json: { name: 'a' },
        headers: { origin: ORIGIN },
      });

      expect(response.status).toBe(201);
    });

    it('accepts the Vite origin only in dev mode', async () => {
      const viteOrigin = { origin: 'http://localhost:5173' };
      await expectProblem(
        await request('/api/v1/servers', {
          method: 'POST',
          json: { name: 'a' },
          headers: viteOrigin,
        }),
        403,
        'forbidden',
      );

      app = createUIApp({
        api: services.api,
        port: () => PORT,
        staticRoot: null,
        dev: true,
      });
      const response = await request('/api/v1/servers', {
        method: 'POST',
        json: { name: 'a' },
        headers: viteOrigin,
      });
      expect(response.status).toBe(201);
    });
  });

  describe('static SPA', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'mcp-decoy-ui-'));
      await mkdir(join(root, 'ui', 'assets'), { recursive: true });
      await writeFile(
        join(root, 'ui', 'index.html'),
        '<!doctype html><title>MCP Decoy</title>',
      );
      await writeFile(
        join(root, 'ui', 'assets', 'app-abc123.js'),
        'console.log(1)',
      );
      await writeFile(join(root, 'secret.txt'), 'secret');
      app = createUIApp({
        api: services.api,
        port: () => PORT,
        staticRoot: join(root, 'ui'),
        dev: false,
      });
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('serves hashed assets with immutable caching', async () => {
      const response = await request('/assets/app-abc123.js');

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('immutable');
      await expect(response.text()).resolves.toBe('console.log(1)');
    });

    it('falls back to index.html for client-side routes', async () => {
      const response = await request('/servers/weather/logs');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      await expect(response.text()).resolves.toContain(
        '<title>MCP Decoy</title>',
      );
    });

    it('never serves files outside the root', async () => {
      const response = await request('/%2e%2e/secret.txt');

      await expect(response.text()).resolves.not.toContain('secret');
    });

    it('answers unknown API routes with problem+json, not index.html', async () => {
      await expectProblem(await request('/api/v1/nope'), 404, 'not-found');
    });
  });
});
