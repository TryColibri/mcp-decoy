import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ServerConfig } from '@/shared/api';

import {
  createServersFileWriter,
  InvalidConfigFileError,
  loadServersFile,
} from './servers-file';

const SERVER: ServerConfig = {
  name: 'weather',
  serverInfo: { name: 'decoy/weather', version: '0.1.0' },
  instructions: 'Fake data.',
  tools: [
    {
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      responseTemplate: { content: [{ type: 'text', text: 'ok' }] },
      published: true,
      updatedAt: '2026-10-21T12:00:00.000Z',
    },
  ],
  createdAt: '2026-10-21T12:00:00.000Z',
};

describe('servers file', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'decoy-test-'));
    path = join(dir, 'servers.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('loadServersFile', () => {
    it('returns no servers when the file is missing', async () => {
      await expect(loadServersFile(path)).resolves.toEqual([]);
    });

    it('fails with readable issues when the file is invalid', async () => {
      await writeFile(
        path,
        JSON.stringify({ version: 1, servers: [{ name: 'Bad Name' }] }),
      );

      const error = await loadServersFile(path).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(InvalidConfigFileError);
      expect(error).toMatchObject({
        path,
        issues: expect.arrayContaining([
          expect.stringMatching(/^servers\.0\.name: /),
        ]),
      });
    });

    it('fails when the file is not JSON', async () => {
      await writeFile(path, '{nope');

      await expect(loadServersFile(path)).rejects.toThrow(
        InvalidConfigFileError,
      );
    });

    it('rejects duplicate server names', async () => {
      await writeFile(
        path,
        JSON.stringify({ version: 1, servers: [SERVER, SERVER] }),
      );

      await expect(loadServersFile(path)).rejects.toThrow(/Duplicate/);
    });
  });

  describe('createServersFileWriter', () => {
    it('writes a file that loads back identically', async () => {
      const write = createServersFileWriter(path);

      await write([SERVER]);

      await expect(loadServersFile(path)).resolves.toEqual([SERVER]);
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        version: 1,
      });
    });

    it('serializes concurrent writes so the last one wins', async () => {
      const write = createServersFileWriter(path);

      await Promise.all([
        write([]),
        write([SERVER]),
        write([{ ...SERVER, name: 'last' }]),
      ]);

      const servers = await loadServersFile(path);
      expect(servers.map((server) => server.name)).toEqual(['last']);
    });
  });
});
