import { ConflictError, NotFoundError } from '@/server/errors';
import { type MCPDecoyEvents, type EventBus } from '@/server/events';
import {
  type CreateServerRequest,
  type ServerConfig,
  type ServerSummary,
  type UpdateServerRequest,
} from '@/shared/api';

import { type ServerRepository } from './repository';

/** Default `serverInfo.version` of new servers. */
export const DEFAULT_SERVER_VERSION = '0.1.0';

/** Dependencies of the servers service. */
export type ServersServiceDeps = {
  /** Source of truth for servers. */
  repository: ServerRepository;
  /** Where mutations are announced. */
  events: EventBus<MCPDecoyEvents>;
  /** Number of live MCP sessions of a server. */
  sessionCount: (server: string) => number;
  /** Streamable HTTP endpoint of a server. */
  mcpUrl: (server: string) => string;
  /** Current time. */
  now?: () => Date;
};

/** Creating, listing, updating and deleting mock servers. */
export type ServersService = {
  /** Every server, in creation order. */
  list(): ServerSummary[];
  /**
   * One server.
   * @throws {NotFoundError} When it doesn't exist.
   */
  get(name: string): ServerSummary;
  /**
   * The persisted definition of a server, or `undefined`.
   */
  findConfig(name: string): ServerConfig | undefined;
  /** Names of every server, in creation order. */
  names(): string[];
  /**
   * Throws when the server doesn't exist.
   * @throws {NotFoundError}
   */
  assertExists(name: string): void;
  /**
   * Creates a server with no tools and announces it.
   * @throws {ConflictError} When the name is taken.
   */
  create(input: CreateServerRequest): Promise<ServerSummary>;
  /**
   * Updates any subset of a server's name, `serverInfo` and instructions.
   * Renaming moves the server and announces it, which closes its sessions.
   * Live sessions keep the identity they were opened with.
   * @throws {NotFoundError} When it doesn't exist.
   * @throws {ConflictError} When renaming onto an existing server.
   */
  update(name: string, patch: UpdateServerRequest): Promise<ServerSummary>;
  /**
   * Deletes a server and announces it, which closes its sessions.
   * @throws {NotFoundError} When it doesn't exist.
   */
  delete(name: string): Promise<void>;
};

/**
 * Creates the servers service.
 *
 * @param deps - Repository, event bus and session lookups.
 */
export function createServersService({
  repository,
  events,
  sessionCount,
  mcpUrl,
  now = () => new Date(),
}: ServersServiceDeps): ServersService {
  const summarize = (server: ServerConfig): ServerSummary => ({
    name: server.name,
    serverInfo: server.serverInfo,
    ...(server.instructions === undefined
      ? {}
      : { instructions: server.instructions }),
    createdAt: server.createdAt,
    mcpUrl: mcpUrl(server.name),
    toolCount: server.tools.length,
    publishedToolCount: server.tools.filter((tool) => tool.published).length,
    sessionCount: sessionCount(server.name),
  });

  const requireServer = (name: string): ServerConfig => {
    const server = repository.find(name);
    if (server === undefined) {
      throw new NotFoundError(`No server named "${name}"`);
    }
    return server;
  };

  return {
    list: () => repository.list().map(summarize),
    get: (name) => summarize(requireServer(name)),
    findConfig: (name) => repository.find(name),
    names: () => repository.list().map((server) => server.name),
    assertExists(name) {
      requireServer(name);
    },

    async create({ name, serverInfo, instructions }) {
      const created = await repository.update((servers) => {
        if (servers.some((server) => server.name === name)) {
          throw new ConflictError(`A server named "${name}" already exists`);
        }
        const server: ServerConfig = {
          name,
          serverInfo: {
            name: serverInfo?.name ?? `mcp-decoy/${name}`,
            version: serverInfo?.version ?? DEFAULT_SERVER_VERSION,
          },
          ...(instructions === undefined || instructions === ''
            ? {}
            : { instructions }),
          tools: [],
          createdAt: now().toISOString(),
        };
        return { servers: [...servers, server], result: server };
      });
      events.emit('serverCreated', { server: created.name });
      return summarize(created);
    },

    async update(name, { name: newName = name, serverInfo, instructions }) {
      const updated = await repository.update((servers) => {
        const current = servers.find((server) => server.name === name);
        if (current === undefined) {
          throw new NotFoundError(`No server named "${name}"`);
        }
        if (
          newName !== name &&
          servers.some((server) => server.name === newName)
        ) {
          throw new ConflictError(`A server named "${newName}" already exists`);
        }
        const { instructions: previous, ...rest } = current;
        const kept = instructions ?? previous;
        const server: ServerConfig = {
          ...rest,
          name: newName,
          serverInfo: {
            name: serverInfo?.name ?? current.serverInfo.name,
            version: serverInfo?.version ?? current.serverInfo.version,
          },
          ...(kept === undefined || kept === '' ? {} : { instructions: kept }),
        };
        return {
          servers: servers.map((candidate) =>
            candidate === current ? server : candidate,
          ),
          result: server,
        };
      });
      if (updated.name !== name) {
        events.emit('serverRenamed', { from: name, to: updated.name });
      }
      return summarize(updated);
    },

    async delete(name) {
      await repository.update((servers) => {
        if (!servers.some((server) => server.name === name)) {
          throw new NotFoundError(`No server named "${name}"`);
        }
        return {
          servers: servers.filter((server) => server.name !== name),
          result: undefined,
        };
      });
      events.emit('serverDeleted', { server: name });
    },
  };
}
