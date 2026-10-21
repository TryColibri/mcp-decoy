import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { type ServerConfig, serverConfigSchema } from '@/shared/api';

import { writeFileAtomic } from './atomic-write';

/** Contents of `servers.json`. */
export type ServersFile = {
  /** File format version. */
  version: 1;
  /** Every persisted server. */
  servers: ServerConfig[];
};

const serversFileSchema: z.ZodType<ServersFile> = z
  .strictObject({
    version: z.literal(1).describe('File format version.'),
    servers: z.array(serverConfigSchema).describe('Every persisted server.'),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.servers.forEach((server, index) => {
      if (seen.has(server.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate server name "${server.name}"`,
          path: ['servers', index, 'name'],
        });
      }
      seen.add(server.name);
    });
  });

/** `servers.json` exists but can't be used. Carries readable issues. */
export class InvalidConfigFileError extends Error {
  override name = 'InvalidConfigFileError';

  /** Absolute path of the offending file. */
  readonly path: string;
  /** One line per problem, e.g. `servers.0.name: Invalid string`. */
  readonly issues: string[];

  /**
   * @param path - Absolute path of the offending file.
   * @param issues - One line per problem.
   */
  constructor(path: string, issues: string[]) {
    super(`Invalid config file ${path}:\n${issues.join('\n')}`);
    this.path = path;
    this.issues = issues;
  }
}

/**
 * Loads the servers persisted in `path`. A missing file means no servers.
 *
 * @param path - Absolute path of `servers.json`.
 * @throws {InvalidConfigFileError} When the file is not valid JSON or doesn't match the schema.
 */
export async function loadServersFile(path: string): Promise<ServerConfig[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new InvalidConfigFileError(path, [
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const result = serversFileSchema.safeParse(json);
  if (!result.success) {
    throw new InvalidConfigFileError(
      path,
      result.error.issues.map(
        (issue) =>
          `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`,
      ),
    );
  }
  return result.data.servers;
}

/** Persists servers to `servers.json`. */
export type ServersFileWriter = (servers: ServerConfig[]) => Promise<void>;

/**
 * Creates a writer that persists servers to `path` atomically. Writes are
 * serialized through one queue, so concurrent calls can't interleave; each
 * call resolves once its own snapshot is on disk.
 *
 * @param path - Absolute path of `servers.json`.
 */
export function createServersFileWriter(path: string): ServersFileWriter {
  let queue: Promise<void> = Promise.resolve();

  return (servers) => {
    const contents = `${JSON.stringify(
      serversFileSchema.parse({ version: 1, servers }),
      null,
      2,
    )}\n`;
    const write = queue.then(async () => writeFileAtomic(path, contents));
    queue = write.catch(() => {});
    return write;
  };
}

type ErrnoError = Error & { code: string };

const isErrnoError = (error: unknown): error is ErrnoError =>
  error instanceof Error && 'code' in error && typeof error.code === 'string';

const isMissingFileError = (error: unknown): boolean =>
  isErrnoError(error) && error.code === 'ENOENT';
