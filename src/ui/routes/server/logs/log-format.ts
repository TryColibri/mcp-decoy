import { httpExchangeSchema, type LogEntry } from '@/shared/api';

/** Label of the kind tag shown next to the method. */
export type LogTag =
  | 'request'
  | 'result'
  | 'notify'
  | 'error'
  | 'invalid'
  | 'http';

/**
 * Tag shown for an entry's kind.
 *
 * @param entry - A log entry.
 */
export function tagOf(entry: LogEntry): LogTag {
  switch (entry.kind) {
    case 'request':
      return 'request';
    case 'response':
      return 'result';
    case 'notification':
      return 'notify';
    case 'error':
      return 'error';
    case 'invalid':
      return 'invalid';
    case 'http':
      return 'http';
  }
}

/**
 * Local wall-clock time with milliseconds, e.g. `12:04:31.204`.
 *
 * @param at - ISO timestamp.
 */
export function formatTime(at: string): string {
  const date = new Date(at);
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/**
 * Short form of a session ID for dense tables.
 *
 * @param sessionId - A session ID, or `null`.
 */
export function shortSession(sessionId: string | null): string {
  return sessionId === null ? '—' : sessionId.slice(0, 4);
}

const cache = new WeakMap<LogEntry, unknown>();

/**
 * The parsed JSON of an entry, or `undefined` when it isn't JSON. Cached.
 *
 * @param entry - A log entry.
 */
export function parsedMessage(entry: LogEntry): unknown {
  if (!cache.has(entry)) {
    let value: unknown;
    try {
      value = JSON.parse(entry.raw);
    } catch {
      value = undefined;
    }
    cache.set(entry, value);
  }
  return cache.get(entry);
}

/**
 * The entry's JSON, pretty-printed, or its raw text when it isn't JSON.
 *
 * @param entry - A log entry.
 */
export function prettyJSON(entry: LogEntry): string {
  const value = parsedMessage(entry);
  return value === undefined ? entry.raw : JSON.stringify(value, null, 2);
}

/**
 * A short note summarizing an entry: the tool name of a call, the tool count
 * of a list result, the code of an error, the client of an `initialize`.
 *
 * @param entry - A log entry.
 */
export function noteOf(entry: LogEntry): string {
  if (entry.kind === 'http') {
    return httpNoteOf(entry);
  }
  const message = parsedMessage(entry);
  if (!isRecord(message)) {
    return entry.kind === 'invalid' ? 'not JSON-RPC' : '';
  }
  const params = isRecord(message.params) ? message.params : {};
  const result = isRecord(message.result) ? message.result : {};

  if (entry.kind === 'error' && isRecord(message.error)) {
    const { code, message: text } = message.error;
    return [
      typeof code === 'number' ? code : '',
      typeof text === 'string' ? text : '',
    ]
      .join(' ')
      .trim();
  }
  if (entry.method === 'initialize' && entry.kind === 'request') {
    const client = isRecord(params.clientInfo) ? params.clientInfo : {};
    return [client.name, client.version]
      .filter((part) => typeof part === 'string')
      .join(' ');
  }
  if (entry.method === 'initialize' && entry.kind === 'response') {
    return typeof result.protocolVersion === 'string'
      ? `protocol ${result.protocolVersion}`
      : '';
  }
  if (entry.method === 'tools/list' && entry.kind === 'response') {
    const count = Array.isArray(result.tools) ? result.tools.length : 0;
    return `${count} ${count === 1 ? 'tool' : 'tools'}`;
  }
  if (entry.method === 'tools/call' && entry.kind === 'request') {
    return typeof params.name === 'string' ? params.name : '';
  }
  if (entry.method === 'tools/call' && entry.kind === 'response') {
    return result.isError === true ? 'isError' : '';
  }
  return '';
}

/**
 * Summarizes an `http`-kind entry, e.g. `401 invalid_token`, `200 consent
 * page`, `302 approved` or `201 client "Claude"`.
 *
 * @param entry - An `http`-kind entry.
 */
function httpNoteOf(entry: LogEntry): string {
  const parsed = httpExchangeSchema.safeParse(parsedMessage(entry));
  if (!parsed.success) {
    return '';
  }
  const { request, response } = parsed.data;
  const status = response.status ?? 0;
  const path = (request.method ?? '').split(' ').at(1) ?? '';
  const body = response.body;

  if (path.startsWith('/consent/')) {
    const location =
      typeof response.headers.location === 'string'
        ? response.headers.location
        : '';
    const decision = location.includes('error=access_denied')
      ? 'denied'
      : location.includes('code=')
        ? 'approved'
        : '';
    return decision === '' ? String(status) : `${status} ${decision}`;
  }
  if (path === '/authorize' && status === 200) {
    return `${status} consent page`;
  }
  if (
    path === '/register' &&
    isRecord(body) &&
    typeof body.client_name === 'string'
  ) {
    return `${status} client "${body.client_name}"`;
  }
  if (isRecord(body) && typeof body.error === 'string') {
    return `${status} ${body.error}`;
  }
  return String(status);
}

/**
 * The request or response paired with an entry, if loaded: same session,
 * same JSON-RPC id, opposite direction.
 *
 * @param entry - A request, response or error.
 * @param entries - Loaded entries.
 */
export function pairOf(
  entry: LogEntry,
  entries: LogEntry[],
): LogEntry | undefined {
  if (entry.jsonrpcId === null) {
    return undefined;
  }
  const wantRequest = entry.kind === 'response' || entry.kind === 'error';
  if (!wantRequest && entry.kind !== 'request') {
    return undefined;
  }
  return entries.find(
    (candidate) =>
      candidate.sessionId === entry.sessionId &&
      candidate.jsonrpcId === entry.jsonrpcId &&
      candidate.direction !== entry.direction &&
      (wantRequest
        ? candidate.kind === 'request'
        : candidate.kind === 'response' || candidate.kind === 'error'),
  );
}

/** What a session negotiated in its `initialize` exchange. */
export type Negotiation = {
  /** Session the negotiation belongs to. */
  sessionId: string;
  /** Protocol version the client asked for. */
  requestedVersion: string | null;
  /** Protocol version the server agreed to. */
  agreedVersion: string | null;
  /** Client name and version, e.g. `my-app 0.3.1`. */
  client: string | null;
  /** Capabilities the client declared. */
  clientCapabilities: Record<string, unknown> | null;
  /** Capabilities the server declared. */
  serverCapabilities: Record<string, unknown> | null;
};

/**
 * Derives a session's negotiation from its `initialize` pair in the loaded
 * entries.
 *
 * @param sessionId - The session.
 * @param entries - Loaded entries.
 * @returns `null` when the `initialize` request isn't loaded.
 */
export function negotiationOf(
  sessionId: string,
  entries: LogEntry[],
): Negotiation | null {
  const request = entries.find(
    (entry) =>
      entry.sessionId === sessionId &&
      entry.method === 'initialize' &&
      entry.kind === 'request',
  );
  if (request === undefined) {
    return null;
  }
  const response = pairOf(request, entries);
  const requestMessage = parsedMessage(request);
  const params =
    isRecord(requestMessage) && isRecord(requestMessage.params)
      ? requestMessage.params
      : {};
  const responseMessage =
    response === undefined ? undefined : parsedMessage(response);
  const result =
    isRecord(responseMessage) && isRecord(responseMessage.result)
      ? responseMessage.result
      : {};
  const client = isRecord(params.clientInfo) ? params.clientInfo : null;

  return {
    sessionId,
    requestedVersion: stringOrNull(params.protocolVersion),
    agreedVersion: stringOrNull(result.protocolVersion),
    client:
      client === null
        ? null
        : [client.name, client.version]
            .filter((part) => typeof part === 'string')
            .join(' '),
    clientCapabilities: isRecord(params.capabilities)
      ? params.capabilities
      : null,
    serverCapabilities: isRecord(result.capabilities)
      ? result.capabilities
      : null,
  };
}

/**
 * Lists capabilities with their notable sub-flags, e.g.
 * `roots (listChanged), sampling`.
 *
 * @param capabilities - A capabilities object.
 */
export function describeCapabilities(
  capabilities: Record<string, unknown> | null,
): string {
  if (capabilities === null) {
    return 'unknown';
  }
  const names = Object.entries(capabilities).map(([name, value]) => {
    const flags = isRecord(value)
      ? Object.entries(value)
          .filter(([, flag]) => flag === true)
          .map(([flag]) => flag)
      : [];
    return flags.length === 0 ? name : `${name} (${flags.join(', ')})`;
  });
  return names.length === 0 ? 'none' : names.join(', ');
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
