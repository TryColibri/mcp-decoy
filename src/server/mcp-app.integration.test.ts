import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCPApp } from '@/server/mcp-app';
import { createServices, type Services } from '@/server/services';
import { type InstanceInfo, type LogEntry } from '@/shared/api';

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
  return { services, app: createMCPApp(services.sessions) };
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

const summarize = (entries: LogEntry[]) =>
  entries.map((entry) => ({
    direction: entry.direction,
    kind: entry.kind,
    method: entry.method,
  }));

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
        name: 'decoy/weather',
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
      expect(summarize(entries)).toEqual([
        { direction: 'in', kind: 'request', method: 'initialize' },
        { direction: 'out', kind: 'response', method: 'initialize' },
        {
          direction: 'in',
          kind: 'notification',
          method: 'notifications/initialized',
        },
        { direction: 'in', kind: 'request', method: 'tools/list' },
        { direction: 'out', kind: 'response', method: 'tools/list' },
        {
          direction: 'out',
          kind: 'notification',
          method: 'notifications/tools/list_changed',
        },
        { direction: 'in', kind: 'request', method: 'tools/list' },
        { direction: 'out', kind: 'response', method: 'tools/list' },
        { direction: 'in', kind: 'request', method: 'tools/call' },
        { direction: 'out', kind: 'response', method: 'tools/call' },
        { direction: 'in', kind: 'request', method: 'tools/call' },
        { direction: 'out', kind: 'error', method: 'tools/call' },
      ]);
      const sessionId = transport.sessionId;
      expect(sessionId).toEqual(expect.any(String));
      for (const entry of entries) {
        expect(entry.sessionId).toBe(sessionId);
      }
      for (const entry of entries.filter(
        (candidate) =>
          candidate.kind === 'response' || candidate.kind === 'error',
      )) {
        expect(entry.durationMs).toEqual(expect.any(Number));
      }
      expect(entries.map((entry) => entry.id)).toEqual(
        entries.map((entry) => entry.id).sort((a, b) => a - b),
      );

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
        { direction: 'in', kind: 'invalid', method: null },
        { direction: 'out', kind: 'error', method: null },
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
      expect(services.logs.all('forecast').at(0)?.server).toBe('forecast');
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
        summarize(harness.services.logs.all('weather')).slice(0, 3),
      ).toEqual([
        { direction: 'in', kind: 'request', method: 'server/discover' },
        { direction: 'out', kind: 'error', method: 'server/discover' },
        { direction: 'in', kind: 'request', method: 'initialize' },
      ]);
    });
  });
});
