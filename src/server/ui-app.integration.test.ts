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
import { createUIApp } from '@/server/ui-app';
import {
  type InstanceInfo,
  instanceInfoSchema,
  logEntrySchema,
  logEvictedSchema,
  logPageSchema,
  problemSchema,
  type ServerConfig,
  serverListSchema,
  serverSummarySchema,
  sessionListSchema,
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
      type: `https://decoy.dev/problems/${type}`,
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
    await services.sessions.closeAll();
  });

  describe('GET /api/v1', () => {
    it('returns instance info', async () => {
      const response = await request('/api/v1');

      expect(response.status).toBe(200);
      expect(instanceInfoSchema.parse(await response.json())).toEqual(INSTANCE);
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
        serverInfo: { name: 'decoy/weather', version: '0.1.0' },
        instructions: 'Fake data.',
        createdAt: expect.any(String),
        mcpUrl: 'http://localhost:6280/s/weather/mcp',
        toolCount: 0,
        publishedToolCount: 0,
        sessionCount: 0,
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
        serverInfo: { name: 'decoy/weather', version: '2.0.0' },
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

  describe('sessions and logs', () => {
    const connect = async () => {
      const mcpApp = createMCPApp(services.sessions);
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

    it('lists and closes sessions', async () => {
      const { transport } = await connect();

      const list = await request('/api/v1/servers/weather/sessions');
      const sessions = sessionListSchema.parse(await list.json()).items;
      expect(sessions).toEqual([
        expect.objectContaining({
          id: transport.sessionId,
          clientInfo: { name: 'test-client', version: '1.0.0' },
        }),
      ]);
      const server = await request('/api/v1/servers/weather');
      expect(serverSummarySchema.parse(await server.json()).sessionCount).toBe(
        1,
      );

      const closed = await request(
        `/api/v1/servers/weather/sessions/${transport.sessionId ?? ''}`,
        { method: 'DELETE' },
      );
      expect(closed.status).toBe(204);
      await expectProblem(
        await request('/api/v1/servers/weather/sessions/nope', {
          method: 'DELETE',
        }),
        404,
        'not-found',
      );
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

    it('searches logs', async () => {
      const { client } = await connect();
      await client.listTools();

      const page = logPageSchema.parse(
        await (
          await request('/api/v1/servers/weather/logs?q=TOOLS/LIST')
        ).json(),
      );

      expect(page.items.map((entry) => entry.method)).toEqual([
        'tools/list',
        'tools/list',
      ]);
    });

    const append = (store: Services['store'], method: string) =>
      store.append({
        at: '2026-10-21T12:00:00.000Z',
        server: 'weather',
        sessionId: null,
        direction: 'in',
        kind: 'request',
        method,
        jsonrpcId: 1,
        durationMs: null,
        raw: `{"jsonrpc":"2.0","id":1,"method":"${method}"}`,
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
      expect(stream.text().match(/event: entry/g)).toHaveLength(2);
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
      await small.sessions.closeAll();

      const data = /event: evicted\ndata: (.*)\n/.exec(stream.text());
      expect(logEvictedSchema.parse(JSON.parse(data?.[1] ?? ''))).toEqual({
        id: evictedCall.id,
      });
      expect(stream.text().match(/event: evicted/g)).toHaveLength(1);
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
      root = await mkdtemp(join(tmpdir(), 'decoy-ui-'));
      await mkdir(join(root, 'ui', 'assets'), { recursive: true });
      await writeFile(
        join(root, 'ui', 'index.html'),
        '<!doctype html><title>decoy</title>',
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
      await expect(response.text()).resolves.toContain('<title>decoy</title>');
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
