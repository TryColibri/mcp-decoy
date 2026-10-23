import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Instance, PortInUseError, start, VERSION } from '@/server/main';
import { AlreadyRunningError } from '@/server/runtime';

const exists = async (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('start', () => {
  let dir: string;
  const instances: Instance[] = [];

  const startHere = async (
    overrides: Partial<Parameters<typeof start>[0]> = {},
  ) => {
    const instance = await start({
      mcpPort: 0,
      uiPort: 0,
      host: '127.0.0.1',
      configDir: dir,
      logLimit: 1000,
      dev: true,
      ...overrides,
    });
    instances.push(instance);
    return instance;
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'decoy-test-'));
  });

  afterEach(async () => {
    await Promise.all(
      instances.splice(0).map(async (instance) => instance.close()),
    );
    await rm(dir, { recursive: true, force: true });
  });

  it('serves the API and MCP on their ports', async () => {
    const instance = await startHere();

    const info = await fetch(
      `http://127.0.0.1:${instance.info.ui.port}/api/v1`,
      {
        headers: { host: `localhost:${instance.info.ui.port}` },
      },
    );
    expect(info.status).toBe(200);

    const mcp = await fetch(
      `http://127.0.0.1:${instance.info.mcp.port}/s/nope/mcp`,
      { method: 'POST', body: '{}' },
    );
    expect(mcp.status).toBe(404);
  });

  describe('default configuration', () => {
    it('starts a fresh config directory with an echo server', async () => {
      const instance = await startHere();

      expect(instance.servers.map((server) => server.name)).toEqual(['echo']);
      expect(
        JSON.parse(await readFile(join(dir, 'servers.json'), 'utf8')),
      ).toMatchObject({ servers: [{ name: 'echo' }] });
    });

    it('lets clients call the echo tool', async () => {
      const instance = await startHere();
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${instance.info.mcp.port}/s/echo/mcp`),
        ),
      );

      try {
        const result = await client.callTool({
          name: 'echo',
          arguments: { message: 'hello' },
        });

        expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
      } finally {
        await client.close();
      }
    });

    it('keeps the servers of an existing file, even none', async () => {
      await writeFile(
        join(dir, 'servers.json'),
        JSON.stringify({ version: 1, servers: [] }),
      );

      const instance = await startHere();

      expect(instance.servers).toEqual([]);
    });
  });

  describe('runtime file', () => {
    it('is written on start and removed on close', async () => {
      const runtimeFile = join(dir, 'runtime.json');
      const instance = await startHere();

      expect(JSON.parse(await readFile(runtimeFile, 'utf8'))).toEqual({
        pid: process.pid,
        version: VERSION,
        apiUrl: `http://127.0.0.1:${instance.info.ui.port}/api/v1`,
        mcpUrlTemplate: instance.info.mcp.urlTemplate,
        startedAt: expect.any(String),
      });

      await instance.close();
      expect(await exists(runtimeFile)).toBe(false);
    });

    it('refuses to start when a live instance owns the directory', async () => {
      const child = spawn(process.execPath, [
        '-e',
        'setTimeout(() => {}, 30000)',
      ]);
      try {
        await writeFile(
          join(dir, 'runtime.json'),
          JSON.stringify({
            pid: child.pid,
            version: '0.0.0',
            apiUrl: 'http://127.0.0.1:1/api/v1',
            mcpUrlTemplate: 'http://localhost:2/s/{server}/mcp',
            startedAt: new Date().toISOString(),
          }),
        );

        await expect(startHere()).rejects.toThrow(AlreadyRunningError);
      } finally {
        child.kill();
      }
    });

    it('overwrites a runtime file left by a dead process', async () => {
      const child = spawn(process.execPath, ['-e', '']);
      await new Promise((resolve) => child.on('exit', resolve));
      await writeFile(
        join(dir, 'runtime.json'),
        JSON.stringify({
          pid: child.pid,
          version: '0.0.0',
          apiUrl: 'http://127.0.0.1:1/api/v1',
          mcpUrlTemplate: 'http://localhost:2/s/{server}/mcp',
          startedAt: new Date().toISOString(),
        }),
      );

      const instance = await startHere();

      expect(
        JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')),
      ).toMatchObject({
        pid: process.pid,
        mcpUrlTemplate: instance.info.mcp.urlTemplate,
      });
    });
  });

  it('fails fast, naming the flag, when a port is taken', async () => {
    const first = await startHere();
    const otherDir = await mkdtemp(join(tmpdir(), 'decoy-test-'));
    try {
      const error = await start({
        mcpPort: first.info.mcp.port,
        uiPort: 0,
        host: '127.0.0.1',
        configDir: otherDir,
        logLimit: 1000,
        dev: true,
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PortInUseError);
      expect(error).toMatchObject({ flag: '--mcp-port' });
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
