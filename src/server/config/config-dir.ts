import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import envPaths from 'env-paths';

/** Files decoy keeps in its config directory. */
export type ConfigPaths = {
  /** Absolute path of the config directory. */
  dir: string;
  /** Absolute path of `servers.json`. */
  serversFile: string;
  /** Absolute path of `runtime.json`. */
  runtimeFile: string;
};

/**
 * Resolves the config directory and creates it if needed.
 *
 * @param override - `--config-dir`; defaults to the platform config directory
 * (`~/.config/decoy` on Linux).
 */
export async function resolveConfigPaths(
  override?: string,
): Promise<ConfigPaths> {
  const dir =
    override === undefined
      ? envPaths('decoy', { suffix: '' }).config
      : resolve(override);
  await mkdir(dir, { recursive: true });
  return {
    dir,
    serversFile: join(dir, 'servers.json'),
    runtimeFile: join(dir, 'runtime.json'),
  };
}
