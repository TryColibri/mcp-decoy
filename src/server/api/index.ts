import { Hono } from 'hono';

import { type LogsService } from '@/server/logs';
import { type SessionManager } from '@/server/mcp';
import { type ServersService } from '@/server/servers';
import { type ToolsService } from '@/server/tools';
import { type InstanceInfo, instanceInfoSchema } from '@/shared/api';

import { createLogsRoutes } from './logs';
import { createErrorHandler, notFoundHandler } from './problems';
import { createServersRoutes } from './servers';
import { createSessionsRoutes } from './sessions';
import { createToolsRoutes } from './tools';

export { problemResponse } from './problems';

/** Services the API calls. */
export type ApiDeps = {
  /** Instance metadata for `GET /api/v1`. */
  instance: () => InstanceInfo;
  /** The servers service. */
  servers: ServersService;
  /** The tools service. */
  tools: ToolsService;
  /** The MCP session manager. */
  sessions: SessionManager;
  /** The logs service. */
  logs: LogsService;
  /** Called once with unexpected errors before answering 500. */
  onUnexpectedError: (error: unknown) => void;
};

/**
 * Creates the `/api/v1` app. Routes are chained so Hono's typed client can
 * infer them from `ApiV1`.
 *
 * @param deps - Services the handlers call.
 */
export function createApiV1({
  instance,
  servers,
  tools,
  sessions,
  logs,
  onUnexpectedError,
}: ApiDeps) {
  const app = new Hono()
    .get('/', (c) => c.json(instanceInfoSchema.parse(instance()), 200))
    .route('/servers', createServersRoutes(servers))
    .route('/servers', createToolsRoutes(tools))
    .route('/servers', createSessionsRoutes(sessions))
    .route('/servers', createLogsRoutes(logs));
  app.onError(createErrorHandler(onUnexpectedError));
  app.notFound(notFoundHandler);
  return app;
}

/** Type of the `/api/v1` app, for `hc<ApiV1>`. */
export type ApiV1 = ReturnType<typeof createApiV1>;
