import { type MiddlewareHandler } from 'hono';

import { type Capture } from '@/server/mcp';
import { type OAuthStore } from '@/server/oauth';
import {
  type HTTPExchange,
  type HTTPMessage,
  type ServerConfig,
} from '@/shared/api';

/** Dependencies of the HTTP exchange logging middleware. */
export type HTTPLogDeps = {
  /** Where exchanges are recorded. */
  capture: Capture;
  /** Every server, for resolving which server(s) an exchange belongs to. */
  listServers: () => readonly ServerConfig[];
  /** The OAuth store, used to attribute a `/consent/:id` POST before it's resolved. */
  store: OAuthStore;
};

/**
 * Records one `http` log entry per OAuth HTTP exchange handled by the OAuth
 * routes app. The server (or servers) an exchange is attributed to is
 * derived from the URL, or from a `resource` or `client_id` found in the
 * query string or body; a request that names neither, such as a DCR
 * request, is recorded under every OAuth-enabled server.
 *
 * @param deps - Capture, server lookup and the OAuth store.
 */
export function createHTTPLog({
  capture,
  listServers,
  store,
}: HTTPLogDeps): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = performance.now();
    const request = c.req.raw;
    const requestText =
      request.method === 'GET' ||
      request.method === 'DELETE' ||
      request.body === null
        ? ''
        : await request.clone().text();
    const servers = await resolveServers({
      request,
      requestText,
      listServers,
      store,
    });
    const sessionId = request.headers.get('mcp-session-id');

    await next();

    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const response = c.res;
    const responseText = await response.clone().text();
    const url = new URL(request.url);
    const exchange: HTTPExchange = {
      request: {
        method: `${request.method} ${url.pathname}`,
        url: request.url,
        headers: headersOf(request.headers),
        ...(requestText === ''
          ? {}
          : { body: bodyOf(request.headers.get('content-type'), requestText) }),
      },
      response: {
        status: response.status,
        headers: headersOf(response.headers),
        ...(responseText === ''
          ? {}
          : {
              body: bodyOf(response.headers.get('content-type'), responseText),
            }),
      },
    };
    for (const server of servers) {
      capture.http({ server, sessionId }, exchange, durationMs);
    }
  };
}

const headersOf = (headers: Headers): Record<string, string> =>
  Object.fromEntries(headers.entries());

const bodyOf = (
  contentType: string | null,
  text: string,
): HTTPMessage['body'] => {
  const type = contentType ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (type.includes('text/html')) {
    return `(HTML, ${new TextEncoder().encode(text).length} bytes)`;
  }
  return text;
};

type ResolveServersParams = {
  request: Request;
  requestText: string;
  listServers: () => readonly ServerConfig[];
  store: OAuthStore;
};

const WELL_KNOWN_RESOURCE_PATH =
  /^\/\.well-known\/oauth-protected-resource\/s\/([^/]+)\/mcp$/;
const CONSENT_PATH = /^\/consent\/([^/]+)$/;
const RESOURCE_PATH = /^\/s\/([^/]+)\/mcp$/;

const resolveServers = async ({
  request,
  requestText,
  listServers,
  store,
}: ResolveServersParams): Promise<string[]> => {
  const url = new URL(request.url);

  const wellKnown = WELL_KNOWN_RESOURCE_PATH.exec(url.pathname);
  if (wellKnown !== null) {
    return [wellKnown[1]];
  }

  const consent = CONSENT_PATH.exec(url.pathname);
  if (consent !== null) {
    const pending = store.consent(consent[1]);
    return pending === undefined ? [] : [pending.server];
  }

  const oauthServers = listServers().filter(
    (server) => server.auth !== undefined,
  );
  const contentType = request.headers.get('content-type') ?? '';
  const bodyParams = contentType.includes('application/x-www-form-urlencoded')
    ? new URLSearchParams(requestText)
    : null;
  const bodyJSON = contentType.includes('application/json')
    ? safeParseRecord(requestText)
    : null;

  const resource =
    url.searchParams.get('resource') ??
    bodyParams?.get('resource') ??
    stringField(bodyJSON, 'resource');
  if (resource !== null) {
    const name = resourceServerName(resource);
    if (name !== null && oauthServers.some((server) => server.name === name)) {
      return [name];
    }
  }

  const clientId =
    url.searchParams.get('client_id') ??
    bodyParams?.get('client_id') ??
    stringField(bodyJSON, 'client_id');
  if (clientId !== null) {
    const owner = oauthServers.find(
      (server) =>
        server.auth?.mode === 'oauth' && server.auth.clientId === clientId,
    );
    if (owner !== undefined) {
      return [owner.name];
    }
  }

  return oauthServers.map((server) => server.name);
};

const resourceServerName = (resource: string): string | null => {
  try {
    return RESOURCE_PATH.exec(new URL(resource).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
};

const safeParseRecord = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const stringField = (
  record: Record<string, unknown> | null,
  field: string,
): string | null => {
  const value = record?.[field];
  return typeof value === 'string' ? value : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
