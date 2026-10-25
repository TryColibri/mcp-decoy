import useSWR, { type SWRConfiguration } from 'swr';

import {
  type FieldError,
  type InstanceInfo,
  type LogEntry,
  type OAuthToken,
  type Problem,
  problemSchema,
  type ServerSummary,
  type Session,
  type Tool,
} from '@/shared/api';
import { createMCPDecoyClient } from '@/shared/client';

/** The typed API client. Same origin: Vite proxies `/api` in development. */
export const client = createMCPDecoyClient('');

/** A failed API call, carrying the parsed problem details. */
export class ApiError extends Error {
  override name = 'ApiError';

  /** The problem details returned by the API. */
  readonly problem: Problem;

  /** @param problem - The problem details returned by the API. */
  constructor(problem: Problem) {
    super(problem.detail);
    this.problem = problem;
  }

  /** HTTP status code. */
  get status(): number {
    return this.problem.status;
  }

  /** Field-level errors, keyed by dotted path. */
  get fieldErrors(): Partial<Record<string, string>> {
    return Object.fromEntries(
      (this.problem.errors ?? []).map((error: FieldError) => [
        error.path,
        error.message,
      ]),
    );
  }
}

type JSONResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<T>;
};

const toApiError = async (response: JSONResponse<unknown>) => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = problemSchema.safeParse(body);
  return new ApiError(
    parsed.success
      ? parsed.data
      : {
          type: 'about:blank',
          title: response.statusText,
          status: response.status,
          detail: `Request failed with status ${response.status}`,
        },
  );
};

/**
 * Awaits a typed client call and returns its JSON body.
 *
 * @param request - A call on `client`.
 * @throws {ApiError} When the response is not 2xx.
 */
export async function unwrap<T>(request: Promise<JSONResponse<T>>): Promise<T> {
  const response = await request;
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.json();
}

/**
 * Awaits a typed client call that answers 204.
 *
 * @param request - A call on `client`.
 * @throws {ApiError} When the response is not 2xx.
 */
export async function unwrapEmpty(
  request: Promise<JSONResponse<unknown>>,
): Promise<void> {
  const response = await request;
  if (!response.ok) {
    throw await toApiError(response);
  }
}

/** SWR keys, so mutations can revalidate what they change. */
export const keys = {
  instance: 'instance',
  servers: 'servers',
  server: (server: string) => `servers/${server}`,
  tools: (server: string) => `servers/${server}/tools`,
  sessions: (server: string) => `servers/${server}/sessions`,
  logs: (server: string) => `servers/${server}/logs`,
  logEntry: (server: string, id: number) => `servers/${server}/logs/${id}`,
  oauthTokens: (server: string) => `servers/${server}/oauth/tokens`,
} as const;

/** Live session counts refresh this often. */
const POLL_MS = 2000;

/** `GET /api/v1`. */
export function useInstance() {
  return useSWR<InstanceInfo, ApiError>(keys.instance, async () =>
    unwrap(client.index.$get()),
  );
}

/** `GET /api/v1/servers`, polled for live session counts. */
export function useServers() {
  return useSWR<ServerSummary[], ApiError>(
    keys.servers,
    async () => (await unwrap(client.servers.$get())).items,
    { refreshInterval: POLL_MS },
  );
}

/** `GET /api/v1/servers/{server}`, polled for live session counts. */
export function useServer(server: string) {
  return useSWR<ServerSummary, ApiError>(
    keys.server(server),
    async () => unwrap(client.servers[':server'].$get({ param: { server } })),
    { refreshInterval: POLL_MS, shouldRetryOnError: false },
  );
}

/** `GET /api/v1/servers/{server}/tools`. */
export function useTools(server: string) {
  return useSWR<Tool[], ApiError>(
    keys.tools(server),
    async () =>
      (
        await unwrap(
          client.servers[':server'].tools.$get({ param: { server } }),
        )
      ).items,
  );
}

/** `GET /api/v1/servers/{server}/sessions`. */
export function useSessions(server: string, config?: SWRConfiguration) {
  return useSWR<Session[], ApiError>(
    keys.sessions(server),
    async () =>
      (
        await unwrap(
          client.servers[':server'].sessions.$get({ param: { server } }),
        )
      ).items,
    { refreshInterval: POLL_MS, ...config },
  );
}

/**
 * `GET /api/v1/servers/{server}/oauth/tokens`, polled. Pass `enabled: false`
 * for a server that isn't on OAuth, which would answer 409.
 */
export function useOAuthTokens(server: string, enabled: boolean) {
  return useSWR<OAuthToken[], ApiError>(
    enabled ? keys.oauthTokens(server) : null,
    async () =>
      (
        await unwrap(
          client.servers[':server'].oauth.tokens.$get({ param: { server } }),
        )
      ).items,
    { refreshInterval: POLL_MS },
  );
}

/** Whether an entry can still change, so it is worth polling. */
const unsettled = (entry: LogEntry | undefined): boolean =>
  entry?.state === 'pending' || entry?.state === 'streaming';

/**
 * `GET /api/v1/servers/{server}/logs/{id}`: an entry by the id of its anchor.
 * Pass `null` as `id` to fetch nothing. Polled while the entry is `pending` or
 * `streaming`.
 */
export function useLogEntry(server: string, id: number | null) {
  return useSWR<LogEntry, ApiError>(
    id === null ? null : keys.logEntry(server, id),
    async () =>
      unwrap(
        client.servers[':server'].logs[':id{[0-9]+}'].$get({
          param: { server, id: String(id) },
        }),
      ),
    {
      refreshInterval: (latest) => (unsettled(latest) ? POLL_MS : 0),
      shouldRetryOnError: false,
    },
  );
}

/**
 * `GET /api/v1/servers/{server}/logs?carriedBy={httpId}`: the entries with a
 * fact the HTTP exchange carried, newest first. Pass `null` as `httpId` to
 * fetch nothing. Polled while `streaming` is true, since the exchange is
 * still carrying.
 */
export function useCarriedEntries(
  server: string,
  httpId: number | null,
  streaming: boolean,
) {
  return useSWR<LogEntry[], ApiError>(
    httpId === null ? null : `${keys.logs(server)}?carriedBy=${httpId}`,
    async () =>
      (
        await unwrap(
          client.servers[':server'].logs.$get({
            param: { server },
            query: { carriedBy: String(httpId), limit: '1000' },
          }),
        )
      ).items,
    {
      refreshInterval: streaming ? POLL_MS : 0,
      shouldRetryOnError: false,
    },
  );
}
