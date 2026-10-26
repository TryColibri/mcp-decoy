import { type OAuthStore } from '@/server/oauth';
import { type ServerConfig } from '@/shared/api';

/** Parameters of `attributeExchange`. */
export type AttributeExchangeParams = {
  /** The request. */
  request: Request;
  /** The request body as text, `''` when it has none. */
  requestText: string;
  /** Every server. */
  listServers: () => readonly ServerConfig[];
  /** The OAuth store, to attribute a `/consent/:id` POST before it is resolved. */
  store: OAuthStore;
};

const WELL_KNOWN_RESOURCE_PATH =
  /^\/\.well-known\/oauth-protected-resource\/s\/([^/]+)\/mcp$/;
const CONSENT_PATH = /^\/consent\/([^/]+)$/;
const RESOURCE_PATH = /^\/s\/([^/]+)\/mcp$/;

/**
 * The server (or servers) an OAuth exchange belongs to. It is derived from the
 * URL, or from a `resource` or `client_id` found in the query string or body;
 * an exchange that names neither, such as a DCR request, belongs to every
 * OAuth-enabled server.
 *
 * @param params - The request, its body text, server lookup and OAuth store.
 */
export const attributeExchange = async ({
  request,
  requestText,
  listServers,
  store,
}: AttributeExchangeParams): Promise<string[]> => {
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
