import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Config directory used in dev mode: `.decoy/` at the repository root, which is
 * gitignored. Dev mode runs from source, so this file's location is inside the
 * repository.
 */
const DEV_CONFIG_DIR = fileURLToPath(
  new URL('../../../.decoy', import.meta.url),
);

/**
 * Returns the default config directory: `$XDG_CONFIG_HOME/decoy`, or
 * `~/.config/decoy` when it is unset or not absolute. decoy uses the same
 * dotfile-style location on every platform instead of the system preferences
 * directory.
 */
function defaultConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const base =
    xdgConfigHome !== undefined && isAbsolute(xdgConfigHome)
      ? xdgConfigHome
      : join(homedir(), '.config');
  return join(base, 'decoy');
}

/** Options for {@link resolveConfigPaths}. */
export type ResolveConfigPathsOptions = {
  /** `--config-dir`; takes precedence over every default. */
  override?: string;
  /** Dev mode: default to the repository-local `.decoy/` directory. */
  dev?: boolean;
};

/**
 * Resolves the config directory and creates it if needed.
 *
 * The directory is `override` if given, else `<repo>/.decoy` in dev mode, else
 * `$XDG_CONFIG_HOME/decoy`, or `~/.config/decoy` when `XDG_CONFIG_HOME` is
 * unset.
 *
 * @param options - See {@link ResolveConfigPathsOptions}.
 */
export async function resolveConfigPaths({
  override,
  dev = false,
}: ResolveConfigPathsOptions = {}): Promise<ConfigPaths> {
  const defaultDir = dev ? DEV_CONFIG_DIR : defaultConfigDir();
  const dir = override === undefined ? defaultDir : resolve(override);
  await mkdir(dir, { recursive: true });
  return {
    dir,
    serversFile: join(dir, 'servers.json'),
    runtimeFile: join(dir, 'runtime.json'),
  };
}
