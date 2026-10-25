import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCPApp } from '@/server/mcp-app';
import { createServices, type Services } from '@/server/services';
import {
  type HTTPEntry,
  type InstanceInfo,
  type LogEntry,
  logEntrySchema,
  type MCPEntry,
} from '@/shared/api';
import { factsOf } from '@/shared/logs';

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
  return {
    services,
    app: createMCPApp({
      sessions: services.sessions,
      oauth: services.oauth,
      findServer: (name) => services.servers.findConfig(name),
      listServers: services.listServerConfigs,
      capture: services.capture,
    }),
  };
};

const connect = async (
  { app }: Harness,
  server: string,
  options: { onListChanged?: () => void } = {},
) => {
  const client = new Client({ name: 'test-client', version: '1.2.3' });
  if (options.onListChanged !== undefined) {
    client.setNotificationHandler(
      'notifications/tools/list_changed',
      options.onListChanged,
    );
  }
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:6280/s/${server}/mcp`),
    { fetch: async (url, init) => app.request(url, init) },
  );
  await client.connect(transport);
  return { client, transport };
};

const mcpEntriesOf = (entries: LogEntry[]) =>
  entries.filter((entry): entry is MCPEntry => entry.type === 'mcp');

const httpEntriesOf = (entries: LogEntry[]) =>
  entries.filter((entry): entry is HTTPEntry => entry.type === 'http');

/** MCP entries reduced to who sent what and how it ended. */
const summarize = (entries: LogEntry[]) =>
  mcpEntriesOf(entries).map((entry) => ({
    from: entry.message.from,
    kind: entry.message.kind,
    method: entry.message.method,
    reply:
      entry.reply === null
        ? null
        : entry.reply.type === 'mcp'
          ? entry.reply.kind
          : entry.reply.type,
    state: entry.state,
  }));

const ACCEPT = 'application/json, text/event-stream';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw-client', version: '0.0.1' },
  },
};

const postTo = (
  { app }: Harness,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request('/s/weather/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: ACCEPT,
      ...headers,
    },
    body: JSON.stringify(body),
  });

/** Opens a session without a standalone stream and returns its ID. */
const openRawSession = async (harness: Harness): Promise<string> => {
  const response = await postTo(harness, INITIALIZE);
  await response.text();
  const sessionId = response.headers.get('mcp-session-id');
  if (sessionId === null) {
    throw new Error('No session ID');
  }
  const initialized = await postTo(
    harness,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { 'mcp-session-id': sessionId },
  );
  await initialized.text();
  return sessionId;
};

const waitFor = async (check: () => boolean) => {
  await vi.waitFor(() => {
    expect(check()).toBe(true);
  });
};

describe('mcpApp', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await harness.services.servers.create({ name: 'weather' });
  });

  afterEach(async () => {
    await harness.services.sessions.closeAll();
  });

  describe('a full client session', () => {
    it('lists, notifies, calls, logs and closes on delete', async () => {
      const { services } = harness;
      const onListChanged = vi.fn();
      const { client, transport } = await connect(harness, 'weather', {
        onListChanged,
      });

      expect(client.getServerVersion()).toEqual({
        name: 'mcp-decoy/weather',
        version: '0.1.0',
      });
      expect(client.getServerCapabilities()).toEqual({
        tools: { listChanged: true },
      });
      await expect(client.listTools()).resolves.toEqual({ tools: [] });

      await services.tools.create('weather', {
        name: 'get_forecast',
        description: 'Forecast for a city',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
        annotations: { readOnlyHint: true },
        responseTemplate: {
          content: [{ type: 'text', text: 'Forecast for ${args.city}: 14°C' }],
        },
        published: true,
      });
      await waitFor(() => onListChanged.mock.calls.length === 1);

      await expect(client.listTools()).resolves.toEqual({
        tools: [
          {
            name: 'get_forecast',
            description: 'Forecast for a city',
            inputSchema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
            annotations: { readOnlyHint: true },
          },
        ],
      });

      await expect(
        client.callTool({ name: 'get_forecast', arguments: { city: 'Paris' } }),
      ).resolves.toEqual({
        content: [{ type: 'text', text: 'Forecast for Paris: 14°C' }],
      });

      await expect(
        client.callTool({ name: 'get_weather', arguments: {} }),
      ).rejects.toMatchObject({
        code: -32602,
        message: expect.stringContaining('Unknown tool: get_weather'),
      });

      const entries = services.logs.all('weather');
      const answered = (from: 'client' | 'server', method: string) => ({
        from,
        kind: 'request',
        method,
        reply: 'response',
        state: 'complete',
      });
      expect(summarize(entries)).toEqual([
        answered('client', 'initialize'),
        {
          from: 'client',
          kind: 'notification',
          method: 'notifications/initialized',
          reply: null,
          state: 'complete',
        },
        answered('client', 'tools/list'),
        {
          from: 'server',
          kind: 'notification',
          method: 'notifications/tools/list_changed',
          reply: null,
          state: 'complete',
        },
        answered('client', 'tools/list'),
        answered('client', 'tools/call'),
        { ...answered('client', 'tools/call'), reply: 'error' },
      ]);
      const sessionId = transport.sessionId;
      expect(sessionId).toEqual(expect.any(String));
      for (const entry of entries) {
        for (const fact of factsOf(entry)) {
          expect(fact.sessionId).toBe(sessionId);
        }
        expect(() => logEntrySchema.parse(entry)).not.toThrow();
      }
      for (const entry of mcpEntriesOf(entries).filter(
        (candidate) => candidate.message.kind === 'request',
      )) {
        expect(entry.durationMs).toEqual(expect.any(Number));
      }
      const ids = entries.map((entry) => entry.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));

      expect(services.sessions.list('weather')).toEqual([
        expect.objectContaining({
          id: sessionId,
          clientInfo: { name: 'test-client', version: '1.2.3' },
          protocolVersion: expect.any(String),
        }),
      ]);

      await services.servers.delete('weather');
      await services.servers.create({ name: 'weather' });
      await expect(client.listTools()).rejects.toThrow(/404|Session not found/);
    });
  });

  describe('HTTP exchanges', () => {
    const entryOf = (entries: LogEntry[], method: string) => {
      const found = mcpEntriesOf(entries).find(
        (entry) => entry.message.method === method,
      );
      if (found === undefined) {
        throw new Error(`No ${method} entry`);
      }
      return found;
    };

    it('records initialize as a completed exchange that carried its request and reply', async () => {
      await connect(harness, 'weather');

      const entries = harness.services.logs.all('weather');
      const initialize = entryOf(entries, 'initialize');
      const exchange = httpEntriesOf(entries).find(
        (entry) => entry.id === initialize.message.carriedBy,
      );

      expect(exchange).toMatchObject({
        state: 'complete',
        exchange: {
          endpoint: 'mcp',
          request: {
            method: 'POST',
            url: 'http://localhost:6280/s/weather/mcp',
            headers: {
              accept: expect.stringContaining('text/event-stream'),
              'content-type': expect.stringContaining('application/json'),
            },
            body: { method: 'initialize' },
          },
          response: {
            status: 200,
            stream: true,
            headers: {
              'content-type': expect.stringContaining('text/event-stream'),
              'mcp-session-id': expect.any(String),
            },
          },
        },
        end: { state: 'complete', events: 1 },
      });
      expect(initialize.reply).toMatchObject({
        type: 'mcp',
        carriedBy: initialize.message.carriedBy,
        sse: { event: 'message' },
      });
    });

    it('records the CORS headers of the response', async () => {
      await connect(harness, 'weather');

      const [first] = httpEntriesOf(harness.services.logs.all('weather'));

      expect(first.exchange.response?.headers).toMatchObject({
        'access-control-allow-origin': '*',
        'access-control-expose-headers':
          expect.stringContaining('mcp-session-id'),
      });
    });

    it('records notifications/initialized as a client notification answered with 202', async () => {
      await connect(harness, 'weather');

      const entries = harness.services.logs.all('weather');
      const initialized = entryOf(entries, 'notifications/initialized');
      const exchange = httpEntriesOf(entries).find(
        (entry) => entry.id === initialized.message.carriedBy,
      );

      expect(initialized).toMatchObject({
        message: { from: 'client', kind: 'notification' },
        reply: null,
        state: 'complete',
      });
      expect(exchange).toMatchObject({
        state: 'complete',
        exchange: { response: { status: 202, stream: false } },
      });
    });

    it('keeps the standalone GET streaming and carries pushed notifications on it', async () => {
      const onListChanged = vi.fn();
      await connect(harness, 'weather', { onListChanged });
      await harness.services.tools.create('weather', {
        name: 'get_forecast',
        published: true,
      });
      await waitFor(() => onListChanged.mock.calls.length === 1);

      const entries = harness.services.logs.all('weather');
      const get = httpEntriesOf(entries).find(
        (entry) => entry.exchange.request.method === 'GET',
      );
      const notification = entryOf(entries, 'notifications/tools/list_changed');

      expect(get).toMatchObject({
        state: 'streaming',
        end: null,
        durationMs: null,
        exchange: { response: { status: 200, stream: true } },
      });
      expect(notification.message).toMatchObject({
        from: 'server',
        carriedBy: get?.id,
        sse: { event: 'message' },
      });
      const carried = harness.services.logs.page('weather', {
        carriedBy: get?.id,
        limit: 10,
      });
      expect(carried.items.map((entry) => entry.id)).toEqual([notification.id]);
    });

    it('marks a notification as not sent when no standalone stream is open', async () => {
      const sessionId = await openRawSession(harness);

      await harness.services.tools.create('weather', {
        name: 'late',
        published: true,
      });

      await vi.waitFor(() => {
        expect(
          mcpEntriesOf(harness.services.logs.all('weather')).find(
            (entry) =>
              entry.message.method === 'notifications/tools/list_changed',
          )?.message,
        ).toMatchObject({
          from: 'server',
          carriedBy: null,
          sse: null,
          sessionId,
        });
      });
    });

    it('ends the GET as aborted when its body is cancelled', async () => {
      const sessionId = await openRawSession(harness);
      const response = await harness.app.request('/s/weather/mcp', {
        headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId },
      });

      await response.body?.cancel();

      await vi.waitFor(() => {
        const get = httpEntriesOf(harness.services.logs.all('weather')).find(
          (entry) => entry.exchange.request.method === 'GET',
        );
        expect(get).toMatchObject({
          state: 'aborted',
          end: { state: 'aborted', events: 0 },
        });
      });
    });

    it('records the status and JSON body of an unknown-session error', async () => {
      await postTo(
        harness,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { 'mcp-session-id': 'nope' },
      );

      const entries = harness.services.logs.all('weather');
      const list = entryOf(entries, 'tools/list');
      const exchange = httpEntriesOf(entries).find(
        (entry) => entry.id === list.message.carriedBy,
      );

      expect(exchange?.exchange.response).toMatchObject({
        status: 404,
        stream: false,
        headers: { 'content-type': 'application/json' },
        body: { error: { message: 'Session not found' } },
      });
      expect(list).toMatchObject({
        state: 'complete',
        reply: { kind: 'error', carriedBy: exchange?.id },
      });
    });

    it('records a gated request as a 401 with the challenge and no reply', async () => {
      await harness.services.servers.update('weather', {
        auth: { mode: 'oauth' },
      });

      const response = await postTo(harness, INITIALIZE);

      expect(response.status).toBe(401);
      const entries = harness.services.logs.all('weather');
      expect(httpEntriesOf(entries)).toMatchObject([
        {
          state: 'complete',
          exchange: {
            response: {
              status: 401,
              headers: {
                'www-authenticate': expect.stringContaining('Bearer'),
                'access-control-allow-origin': '*',
              },
            },
          },
        },
      ]);
      expect(entryOf(entries, 'initialize')).toMatchObject({
        state: 'aborted',
        reply: { type: 'no-reply', reason: 'exchange-ended' },
      });
    });
  });

  describe('tools/call', () => {
    it('returns a tool execution error when the template fails', async () => {
      await harness.services.tools.create('weather', {
        name: 'broken',
        responseTemplate: {
          content: [{ type: 'text', text: '${args.city.name}' }],
        },
        published: true,
      });
      const { client } = await connect(harness, 'weather');

      const result = await client.callTool({ name: 'broken', arguments: {} });

      expect(result).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('city') }],
      });
    });

    it('echoes arguments with the default template', async () => {
      await harness.services.tools.create('weather', {
        name: 'echo',
        published: true,
      });
      const { client } = await connect(harness, 'weather');

      await expect(
        client.callTool({ name: 'echo', arguments: { a: 1 } }),
      ).resolves.toEqual({ content: [{ type: 'text', text: '{"a":1}' }] });
    });

    it('treats drafts as unknown tools', async () => {
      await harness.services.tools.create('weather', { name: 'draft' });
      const { client } = await connect(harness, 'weather');

      await expect(client.listTools()).resolves.toEqual({ tools: [] });
      await expect(
        client.callTool({ name: 'draft', arguments: {} }),
      ).rejects.toMatchObject({ code: -32602 });
    });
  });

  describe('routing', () => {
    it('answers 404 with the known servers for an unknown server', async () => {
      const response = await harness.app.request('/s/nope/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: { data: { knownServers: ['weather'] } },
      });
    });

    it('answers 404 for an unknown session', async () => {
      const response = await harness.app.request('/s/weather/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': 'nope',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(404);
    });

    it('logs malformed JSON as invalid', async () => {
      await harness.app.request('/s/weather/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });

      expect(summarize(harness.services.logs.all('weather'))).toEqual([
        {
          from: 'client',
          kind: 'invalid',
          method: null,
          reply: null,
          state: 'complete',
        },
        {
          from: 'server',
          kind: 'error',
          method: null,
          reply: null,
          state: 'complete',
        },
      ]);
    });

    it('answers CORS preflights without logging them', async () => {
      const response = await harness.app.request('/s/weather/mcp', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://example.com',
          'access-control-request-method': 'POST',
        },
      });

      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(harness.services.logs.all('weather')).toEqual([]);
    });

    it('closes a session server-side', async () => {
      const { client, transport } = await connect(harness, 'weather');
      const sessionId = transport.sessionId ?? '';

      await harness.services.sessions.close('weather', sessionId);

      expect(harness.services.sessions.count('weather')).toBe(0);
      await expect(client.listTools()).rejects.toThrow(/404|Session not found/);
    });
  });

  describe('changing a server’s authentication', () => {
    it('closes that server’s sessions only', async () => {
      const { services } = harness;
      await services.servers.create({ name: 'echo' });
      const weather = await connect(harness, 'weather');
      const echo = await connect(harness, 'echo');

      await services.servers.update('weather', { auth: { mode: 'oauth' } });

      expect(services.sessions.count('weather')).toBe(0);
      expect(services.sessions.count('echo')).toBe(1);
      // The OAuth gate now answers before the session lookup would.
      await expect(weather.client.listTools()).rejects.toThrow(/invalid_token/);
      await expect(echo.client.listTools()).resolves.toBeDefined();
    });
  });

  describe('renaming a server', () => {
    it('closes its sessions and moves its logs to the new name', async () => {
      const { services } = harness;
      const { client } = await connect(harness, 'weather');
      const logged = services.logs.all('weather').length;

      await services.servers.update('weather', { name: 'forecast' });

      expect(services.sessions.count('weather')).toBe(0);
      await expect(client.listTools()).rejects.toThrow(/Unknown server/);
      expect(services.logs.all('forecast').length).toBeGreaterThanOrEqual(
        logged,
      );
      for (const entry of services.logs.all('forecast')) {
        expect(factsOf(entry).every((fact) => fact.server === 'forecast')).toBe(
          true,
        );
      }
      const fresh = await connect(harness, 'forecast');
      await expect(fresh.client.listTools()).resolves.toBeDefined();
    });
  });

  describe('version negotiation', () => {
    it('falls back to initialize for clients that probe the 2026 era', async () => {
      const client = new Client(
        { name: 'auto-client', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      );
      const transport = new StreamableHTTPClientTransport(
        new URL('http://localhost:6280/s/weather/mcp'),
        { fetch: async (url, init) => harness.app.request(url, init) },
      );

      await client.connect(transport);

      await expect(client.listTools()).resolves.toEqual({ tools: [] });
      expect(
        summarize(harness.services.logs.all('weather')).slice(0, 2),
      ).toEqual([
        {
          from: 'client',
          kind: 'request',
          method: 'server/discover',
          reply: 'error',
          state: 'complete',
        },
        {
          from: 'client',
          kind: 'request',
          method: 'initialize',
          reply: 'response',
          state: 'complete',
        },
      ]);
    });
  });
});
