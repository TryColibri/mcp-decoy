import { type ApiV1, createApiV1 } from '@/server/api';
import {
  createEventBus,
  type DecoyEvents,
  type EventBus,
} from '@/server/events';
import {
  createLogsService,
  createRingBufferLogStore,
  type LogsService,
  type LogStore,
} from '@/server/logs';
import {
  createCapture,
  createSessionManager,
  type SessionManager,
} from '@/server/mcp';
import {
  createServerRepository,
  createServersService,
  type ServersService,
} from '@/server/servers';
import { createToolsService, type ToolsService } from '@/server/tools';
import { type InstanceInfo, type ServerConfig } from '@/shared/api';

/** Inputs of `createServices`. */
export type ServicesOptions = {
  /** Servers loaded at startup. */
  initial: ServerConfig[];
  /** Persists the complete server list after every change. */
  persist: (servers: ServerConfig[]) => Promise<void>;
  /** Maximum number of log entries kept in memory, across servers. */
  logLimit: number;
  /** Instance metadata for `GET /api/v1`, read per request. */
  instance: () => InstanceInfo;
  /** Reports unexpected errors. */
  onError: (error: unknown) => void;
};

/** Every service of a decoy instance, wired together. */
export type Services = {
  /** The event bus services announce mutations on. */
  events: EventBus<DecoyEvents>;
  /** The servers service. */
  servers: ServersService;
  /** The tools service. */
  tools: ToolsService;
  /** MCP sessions and the Streamable HTTP entry point. */
  sessions: SessionManager;
  /** The raw log store. */
  store: LogStore;
  /** The logs service. */
  logs: LogsService;
  /** The `/api/v1` app. */
  api: ApiV1;
};

/**
 * Wires every service of a decoy instance. Has no I/O of its own: persistence
 * is injected, so tests can build the whole stack without disk or sockets.
 *
 * @param options - Initial servers, persistence, log limit, instance info.
 */
export function createServices({
  initial,
  persist,
  logLimit,
  instance,
  onError,
}: ServicesOptions): Services {
  const events = createEventBus<DecoyEvents>(onError);
  const repository = createServerRepository({ initial, persist });
  const store = createRingBufferLogStore(logLimit);

  const tools = createToolsService({ repository, events });
  const sessions = createSessionManager({
    findServer: (name) => repository.find(name),
    serverNames: () => repository.list().map((server) => server.name),
    listPublishedTools: (server) => tools.listPublished(server),
    capture: createCapture(store),
    events,
    onError,
  });
  const servers = createServersService({
    repository,
    events,
    sessionCount: (server) => sessions.count(server),
    mcpUrl: (server) => instance().mcp.urlTemplate.replace('{server}', server),
  });
  events.on('serverRenamed', ({ from, to }) => {
    store.rename(from, to);
  });
  const logs = createLogsService({
    store,
    assertServerExists: (server) => {
      servers.assertExists(server);
    },
  });
  const api = createApiV1({
    instance,
    servers,
    tools,
    sessions,
    logs,
    onUnexpectedError: onError,
  });

  return { events, servers, tools, sessions, store, logs, api };
}
