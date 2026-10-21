import { readFile, rm } from 'node:fs/promises';

import { z } from 'zod';

import { writeFileAtomic } from '@/server/config';

/**
 * Contents of `runtime.json`, written while an instance is running so other
 * tools (future CLI subcommands, the TUI) can find its API.
 */
export type RuntimeInfo = {
  /** Process ID of the running instance. */
  pid: number;
  /** decoy version. */
  version: string;
  /** Base URL of the REST API, e.g. `http://127.0.0.1:6281/api/v1`. */
  apiUrl: string;
  /** MCP endpoint pattern; replace `{server}` with a server name. */
  mcpUrlTemplate: string;
  /** When the instance started, ISO 8601. */
  startedAt: string;
};

const runtimeInfoSchema: z.ZodType<RuntimeInfo> = z.strictObject({
  pid: z.number().int().describe('Process ID of the running instance.'),
  version: z.string().describe('decoy version.'),
  apiUrl: z
    .string()
    .describe('Base URL of the REST API, e.g. `http://127.0.0.1:6281/api/v1`.'),
  mcpUrlTemplate: z
    .string()
    .describe('MCP endpoint pattern; replace `{server}` with a server name.'),
  startedAt: z.iso.datetime().describe('When the instance started, ISO 8601.'),
});

/** Another live decoy instance owns the config directory. */
export class AlreadyRunningError extends Error {
  override name = 'AlreadyRunningError';

  /** The running instance, as advertised in its runtime file. */
  readonly running: RuntimeInfo;

  /** @param running - The running instance, as advertised in its runtime file. */
  constructor(running: RuntimeInfo) {
    super(`decoy is already running at ${running.apiUrl} (pid ${running.pid})`);
    this.running = running;
  }
}

/**
 * Fails if `path` advertises a live instance. A runtime file left behind by a
 * dead process, or one that can't be parsed, is ignored (it gets overwritten).
 *
 * @param path - Absolute path of `runtime.json`.
 * @throws {AlreadyRunningError} When the advertised pid is alive.
 */
export async function assertNotRunning(path: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  const result = runtimeInfoSchema.safeParse(json);
  if (
    result.success &&
    result.data.pid !== process.pid &&
    isAlive(result.data.pid)
  ) {
    throw new AlreadyRunningError(result.data);
  }
}

/**
 * Writes `runtime.json` atomically.
 *
 * @param path - Absolute path of `runtime.json`.
 * @param info - What to advertise.
 */
export async function writeRuntimeFile(
  path: string,
  info: RuntimeInfo,
): Promise<void> {
  await writeFileAtomic(
    path,
    `${JSON.stringify(runtimeInfoSchema.parse(info), null, 2)}\n`,
  );
}

/**
 * Removes `runtime.json`, if present.
 *
 * @param path - Absolute path of `runtime.json`.
 */
export async function removeRuntimeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};
