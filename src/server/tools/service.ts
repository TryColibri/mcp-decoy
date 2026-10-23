import { ConflictError, NotFoundError } from '@/server/errors';
import { type MCPDecoyEvents, type EventBus } from '@/server/events';
import { type ServerRepository } from '@/server/servers';
import { DEFAULT_RESPONSE_TEMPLATE } from '@/server/templates';
import {
  type CreateToolRequest,
  type ServerConfig,
  type Tool,
  type ToolConfig,
  type UpdateToolRequest,
} from '@/shared/api';

/** Input schema of new tools. */
export const DEFAULT_INPUT_SCHEMA = { type: 'object', properties: {} };

/** Dependencies of the tools service. */
export type ToolsServiceDeps = {
  /** Source of truth for servers and their tools. */
  repository: ServerRepository;
  /** Where mutations are announced. */
  events: EventBus<MCPDecoyEvents>;
  /** Current time. */
  now?: () => Date;
};

/** Defining a server's tools. Every change applies live. */
export type ToolsService = {
  /**
   * Every tool of a server, drafts included.
   * @throws {NotFoundError} When the server doesn't exist.
   */
  list(server: string): Tool[];
  /**
   * One tool.
   * @throws {NotFoundError} When the server or tool doesn't exist.
   */
  get(server: string, name: string): Tool;
  /**
   * The published tools of a server, the ones clients see. Empty when the
   * server doesn't exist.
   */
  listPublished(server: string): ToolConfig[];
  /**
   * Creates a tool. Omitted fields take defaults; it is a draft unless
   * `published` is `true`.
   * @throws {NotFoundError} When the server doesn't exist.
   * @throws {ConflictError} When the name is taken.
   */
  create(server: string, input: CreateToolRequest): Promise<Tool>;
  /**
   * Updates any subset of a tool's fields, including its name and
   * `published`.
   * @throws {NotFoundError} When the server or tool doesn't exist.
   * @throws {ConflictError} When renaming onto an existing tool.
   */
  update(server: string, name: string, patch: UpdateToolRequest): Promise<Tool>;
  /**
   * Deletes a tool.
   * @throws {NotFoundError} When the server or tool doesn't exist.
   */
  delete(server: string, name: string): Promise<void>;
};

/**
 * Creates the tools service.
 *
 * @param deps - Repository and event bus.
 */
export function createToolsService({
  repository,
  events,
  now = () => new Date(),
}: ToolsServiceDeps): ToolsService {
  const findServer = (
    servers: readonly ServerConfig[],
    server: string,
  ): ServerConfig => {
    const found = servers.find((candidate) => candidate.name === server);
    if (found === undefined) {
      throw new NotFoundError(`No server named "${server}"`);
    }
    return found;
  };

  const findTool = (config: ServerConfig, name: string): ToolConfig => {
    const found = config.tools.find((tool) => tool.name === name);
    if (found === undefined) {
      throw new NotFoundError(
        `No tool named "${name}" on server "${config.name}"`,
      );
    }
    return found;
  };

  const replaceTools = (
    servers: readonly ServerConfig[],
    server: string,
    tools: ToolConfig[],
  ): ServerConfig[] =>
    servers.map((candidate) =>
      candidate.name === server ? { ...candidate, tools } : candidate,
    );

  const announce = (server: string, ...affected: ToolConfig[]) => {
    if (affected.some((tool) => tool.published)) {
      events.emit('toolsChanged', { server });
    }
  };

  return {
    list: (server) => findServer(repository.list(), server).tools,
    get: (server, name) =>
      findTool(findServer(repository.list(), server), name),
    listPublished: (server) =>
      repository.find(server)?.tools.filter((tool) => tool.published) ?? [],

    async create(server, input) {
      const created = await repository.update((servers) => {
        const config = findServer(servers, server);
        if (config.tools.some((tool) => tool.name === input.name)) {
          throw new ConflictError(
            `A tool named "${input.name}" already exists on server "${server}"`,
          );
        }
        const tool: ToolConfig = {
          name: input.name,
          ...(input.title === undefined || input.title === ''
            ? {}
            : { title: input.title }),
          description: input.description ?? '',
          inputSchema: input.inputSchema ?? DEFAULT_INPUT_SCHEMA,
          annotations: input.annotations ?? {},
          responseTemplate:
            input.responseTemplate === undefined
              ? DEFAULT_RESPONSE_TEMPLATE
              : input.responseTemplate,
          published: input.published ?? false,
          updatedAt: now().toISOString(),
        };
        return {
          servers: replaceTools(servers, server, [...config.tools, tool]),
          result: tool,
        };
      });
      announce(server, created);
      return created;
    },

    async update(server, name, patch) {
      const [before, after] = await repository.update((servers) => {
        const config = findServer(servers, server);
        const existing = findTool(config, name);
        const newName = patch.name ?? existing.name;
        if (
          newName !== existing.name &&
          config.tools.some((tool) => tool.name === newName)
        ) {
          throw new ConflictError(
            `A tool named "${newName}" already exists on server "${server}"`,
          );
        }
        const { title: _title, ...rest } = existing;
        const title = patch.title === undefined ? existing.title : patch.title;
        const updated: ToolConfig = {
          ...rest,
          ...(title === undefined || title === null || title === ''
            ? {}
            : { title }),
          name: newName,
          description: patch.description ?? existing.description,
          inputSchema: patch.inputSchema ?? existing.inputSchema,
          annotations: patch.annotations ?? existing.annotations,
          responseTemplate:
            patch.responseTemplate === undefined
              ? existing.responseTemplate
              : patch.responseTemplate,
          published: patch.published ?? existing.published,
          updatedAt: now().toISOString(),
        };
        return {
          servers: replaceTools(
            servers,
            server,
            config.tools.map((tool) => (tool.name === name ? updated : tool)),
          ),
          result: [existing, updated] as const,
        };
      });
      announce(server, before, after);
      return after;
    },

    async delete(server, name) {
      const removed = await repository.update((servers) => {
        const config = findServer(servers, server);
        const existing = findTool(config, name);
        return {
          servers: replaceTools(
            servers,
            server,
            config.tools.filter((tool) => tool.name !== name),
          ),
          result: existing,
        };
      });
      announce(server, removed);
    },
  };
}
