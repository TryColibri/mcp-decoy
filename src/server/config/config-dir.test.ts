import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveConfigPaths } from './config-dir';

vi.mock('node:fs/promises');
vi.mock('node:os');

const mockMkdir = vi.mocked(mkdir);
const mockHomedir = vi.mocked(homedir);

describe('resolveConfigPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockHomedir.mockReturnValue('/home/dev');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to ~/.config/decoy', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', '');

    const paths = await resolveConfigPaths();

    expect(paths).toEqual({
      dir: '/home/dev/.config/decoy',
      serversFile: '/home/dev/.config/decoy/servers.json',
      runtimeFile: '/home/dev/.config/decoy/runtime.json',
    });
    expect(mockMkdir).toHaveBeenCalledExactlyOnceWith(
      '/home/dev/.config/decoy',
      { recursive: true },
    );
  });

  it('uses $XDG_CONFIG_HOME when it is absolute', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg');

    const paths = await resolveConfigPaths();

    expect(paths.dir).toBe('/xdg/decoy');
  });

  it('ignores a relative $XDG_CONFIG_HOME', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', 'relative/path');

    const paths = await resolveConfigPaths();

    expect(paths.dir).toBe('/home/dev/.config/decoy');
  });

  it('prefers the override over the environment', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg');

    const paths = await resolveConfigPaths({ override: '/custom/dir' });

    expect(paths.dir).toBe('/custom/dir');
  });

  it('uses the repository-local .decoy directory in dev mode', async () => {
    vi.stubEnv('XDG_CONFIG_HOME', '/xdg');

    const paths = await resolveConfigPaths({ dev: true });

    expect(paths.dir).toBe(resolve(import.meta.dirname, '../../../.decoy'));
  });

  it('prefers the override over dev mode', async () => {
    const paths = await resolveConfigPaths({
      override: '/custom/dir',
      dev: true,
    });

    expect(paths.dir).toBe('/custom/dir');
  });
});
