import { type Server as HTTPServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import {
  createDefaultServers,
  createServersFileWriter,
  loadOrSeedServersFile,
  resolveConfigPaths,
} from '@/server/config';
import { type DecoyEvents, type EventBus } from '@/server/events';
import { createMCPApp } from '@/server/mcp-app';
import {
  assertNotRunning,
  removeRuntimeFile,
  writeRuntimeFile,
} from '@/server/runtime';
import { createServices } from '@/server/services';
import { createUIApp } from '@/server/ui-app';
import { type InstanceInfo, type ServerSummary } from '@/shared/api';

import packageJSON from '../../package.json' with { type: 'json' };

/** MCP Decoy's version, from `package.json`. */
export const VERSION = packageJSON.version;

/** Options of `start`. */
export type StartOptions = {
  /** Port of the MCP listener. `0` picks a free port. */
  mcpPort: number;
  /** Port of the UI listener. `0` picks a free port. */
  uiPort: number;
  /** Bind address of the MCP listener. The UI listener always binds 127.0.0.1. */
  host: string;
  /**
   * Config directory; defaults to `<repo>/.decoy` in dev mode, else
   * `$XDG_CONFIG_HOME/decoy` or `~/.config/decoy`.
   */
  configDir?: string;
  /** Maximum number of log entries kept in memory, across servers. */
  logLimit: number;
  /** Dev mode: no static files, and the Vite origin passes the CSRF check. */
  dev: boolean;
  /** Reports unexpected errors. Defaults to `console.error`. */
  onError?: (error: unknown) => void;
};

/** A running MCP Decoy instance. */
export type Instance = {
  /** What `GET /api/v1` returns. */
  info: InstanceInfo;
  /** URL of the UI listener. In development the UI is served by Vite instead. */
  uiUrl: string;
  /** Base URL of the REST API. */
  apiUrl: string;
  /** Servers loaded from the config file at startup. */
  servers: ServerSummary[];
  /** Subscribe to mutations, such as servers being created. */
  events: EventBus<DecoyEvents>;
  /** Closes every session and both listeners, and removes the runtime file. */
  close(): Promise<void>;
};

/** A listener could not bind its port. */
export class PortInUseError extends Error {
  override name = 'PortInUseError';

  /** The CLI flag that changes the port. */
  readonly flag: string;
  /** The port that was taken. */
  readonly port: number;

  /**
   * @param flag - The CLI flag that changes the port.
   * @param port - The port that was taken.
   */
  constructor(flag: string, port: number) {
    super(`Port ${port} is already in use. Pick another one with ${flag}.`);
    this.flag = flag;
    this.port = port;
  }
}

/**
 * Starts MCP Decoy: loads servers, wires services, and opens the MCP and UI
 * listeners.
 *
 * @param options - Ports, host, config directory, log limit, dev mode.
 * @throws {AlreadyRunningError} When another live instance uses the config directory.
 * @throws {InvalidConfigFileError} When `servers.json` is invalid.
 * @throws {PortInUseError} When a port is taken.
 */
export async function start({
  mcpPort,
  uiPort,
  host,
  configDir,
  logLimit,
  dev,
  onError = (error) => {
    console.error(error);
  },
}: StartOptions): Promise<Instance> {
  const paths = await resolveConfigPaths({ override: configDir, dev });
  await assertNotRunning(paths.runtimeFile);
  const persist = createServersFileWriter(paths.serversFile);
  const initial = await loadOrSeedServersFile(
    paths.serversFile,
    createDefaultServers(new Date()),
    persist,
  );

  // Ports are only known once listening (they may be 0).
  const ready: { info?: InstanceInfo } = {};
  const { servers, sessions, api, events } = createServices({
    initial,
    persist,
    logLimit,
    instance: () => {
      if (ready.info === undefined) {
        throw new Error('MCP Decoy is still starting');
      }
      return ready.info;
    },
    onError,
  });

  const mcpListener = await listen({
    fetch: createMCPApp(sessions).fetch,
    port: mcpPort,
    hostname: host,
    flag: '--mcp-port',
  });
  let uiListener: HTTPServer | undefined;
  try {
    uiListener = await listen({
      fetch: createUIApp({
        api,
        port: () => (uiListener === undefined ? uiPort : portOf(uiListener)),
        staticRoot: dev
          ? null
          : fileURLToPath(new URL('./ui/', import.meta.url)),
        dev,
      }).fetch,
      port: uiPort,
      hostname: '127.0.0.1',
      flag: '--ui-port',
    });
  } catch (error) {
    await closeListener(mcpListener);
    throw error;
  }
  const ui = uiListener;
  const actualMCPPort = portOf(mcpListener);
  const actualUIPort = portOf(ui);

  const mcpURLTemplate = `http://${displayHostOf(host)}:${actualMCPPort}/s/{server}/mcp`;
  const uiUrl = `http://localhost:${actualUIPort}`;
  const apiUrl = `${uiUrl}/api/v1`;
  const info: InstanceInfo = {
    version: VERSION,
    mcp: { host, port: actualMCPPort, urlTemplate: mcpURLTemplate },
    ui: { port: actualUIPort },
    configFile: paths.serversFile,
    links: { servers: '/api/v1/servers' },
  };
  ready.info = info;

  await writeRuntimeFile(paths.runtimeFile, {
    pid: process.pid,
    version: VERSION,
    apiUrl: `http://127.0.0.1:${actualUIPort}/api/v1`,
    mcpUrlTemplate: mcpURLTemplate,
    startedAt: new Date().toISOString(),
  });

  let closing: Promise<void> | undefined;
  return {
    info,
    uiUrl,
    apiUrl,
    servers: servers.list(),
    events,
    close() {
      closing ??= (async () => {
        await sessions.closeAll();
        await Promise.all([closeListener(mcpListener), closeListener(ui)]);
        await removeRuntimeFile(paths.runtimeFile);
      })();
      return closing;
    },
  };
}

type ListenOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
  port: number;
  hostname: string;
  flag: string;
};

const listen = ({ fetch, port, hostname, flag }: ListenOptions) =>
  new Promise<HTTPServer>((resolve, reject) => {
    const server = serve({ fetch, port, hostname });
    if (!isHTTPServer(server)) {
      reject(new Error('Expected an HTTP/1.1 server'));
      return;
    }
    server.once('error', (error) => {
      reject(
        isErrno(error, 'EADDRINUSE') ? new PortInUseError(flag, port) : error,
      );
    });
    server.once('listening', () => {
      resolve(server);
    });
  });

const closeListener = (server: HTTPServer) =>
  new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    // Long-lived SSE responses would otherwise keep the server open.
    server.closeAllConnections();
  });

const portOf = (server: HTTPServer): number => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Listener has no TCP address');
  }
  return address.port;
};

const displayHostOf = (host: string): string =>
  ['127.0.0.1', '0.0.0.0', '::', '::1', 'localhost'].includes(host)
    ? 'localhost'
    : host.includes(':')
      ? `[${host}]`
      : host;

const isHTTPServer = (server: unknown): server is HTTPServer =>
  typeof server === 'object' &&
  server !== null &&
  'closeAllConnections' in server;

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;
