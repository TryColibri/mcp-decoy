import { type LogStore } from '@/server/logs';
import {
  type HTTPExchange,
  type LogDirection,
  type LogEntry,
  type LogKind,
} from '@/shared/api';

/** Where a message was seen. */
export type CaptureOrigin = {
  /** Server that handled the message. */
  server: string;
  /** MCP session, or `null` when the message belongs to none. */
  sessionId: string | null;
};

/** Records JSON-RPC messages in the log store, pairing responses with their requests. */
export type Capture = {
  /**
   * Records the body of an incoming HTTP request. A batch is recorded as one
   * entry per message; a body that isn't JSON is one `invalid` entry.
   */
  incoming(origin: CaptureOrigin, body: string): LogEntry[];
  /** Records a message the server sends. */
  outgoing(origin: CaptureOrigin, message: unknown): LogEntry;
  /** Records the JSON body of an HTTP error response that bypassed the transport's `send`. */
  outgoingBody(origin: CaptureOrigin, body: string): LogEntry[];
  /** Records one OAuth HTTP exchange. */
  http(
    origin: CaptureOrigin,
    exchange: HTTPExchange,
    durationMs: number,
  ): LogEntry;
  /** Forgets unanswered requests of a session. */
  forgetSession(server: string, sessionId: string): void;
};

/** Upper bound on remembered unanswered requests, across all sessions. */
const MAX_PENDING = 10_000;

type Pending = {
  /** Method of the request. */
  method: string;
  /** `performance.now()` when it was seen. */
  startedAt: number;
};

/**
 * Creates a capture that writes to `store`.
 *
 * @param store - Where entries go.
 * @param clock - Wall clock and monotonic clock; injectable for tests.
 */
export function createCapture(
  store: LogStore,
  clock: { now: () => Date; monotonic: () => number } = {
    now: () => new Date(),
    monotonic: () => performance.now(),
  },
): Capture {
  const pending = new Map<string, Pending>();

  const pendingKey = (
    origin: CaptureOrigin,
    requestDirection: LogDirection,
    id: string | number,
  ) =>
    JSON.stringify([
      origin.server,
      origin.sessionId,
      requestDirection,
      typeof id,
      id,
    ]);

  const record = (
    origin: CaptureOrigin,
    direction: LogDirection,
    message: unknown,
    raw: string,
  ): LogEntry => {
    const { kind, method, jsonrpcId } = classify(message);
    let resolvedMethod = method;
    let durationMs: number | null = null;

    if (kind === 'request' && jsonrpcId !== null && method !== null) {
      if (pending.size >= MAX_PENDING) {
        const oldest = pending.keys().next();
        if (oldest.done !== true) {
          pending.delete(oldest.value);
        }
      }
      pending.set(pendingKey(origin, direction, jsonrpcId), {
        method,
        startedAt: clock.monotonic(),
      });
    } else if (
      (kind === 'response' || kind === 'error') &&
      jsonrpcId !== null
    ) {
      const key = pendingKey(origin, opposite(direction), jsonrpcId);
      const request = pending.get(key);
      if (request !== undefined) {
        pending.delete(key);
        resolvedMethod = request.method;
        durationMs =
          Math.round((clock.monotonic() - request.startedAt) * 10) / 10;
      }
    }

    return store.append({
      at: clock.now().toISOString(),
      server: origin.server,
      sessionId: origin.sessionId,
      direction,
      kind,
      method: resolvedMethod,
      jsonrpcId,
      durationMs,
      raw,
    });
  };

  const recordBody = (
    origin: CaptureOrigin,
    direction: LogDirection,
    body: string,
  ): LogEntry[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [record(origin, direction, undefined, body)];
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((message: unknown) =>
        record(origin, direction, message, JSON.stringify(message)),
      );
    }
    return [record(origin, direction, parsed, body)];
  };

  return {
    incoming: (origin, body) => recordBody(origin, 'in', body),
    outgoing: (origin, message) =>
      record(origin, 'out', message, JSON.stringify(message)),
    outgoingBody: (origin, body) => recordBody(origin, 'out', body),
    http: (origin, exchange, durationMs) =>
      store.append({
        at: clock.now().toISOString(),
        server: origin.server,
        sessionId: origin.sessionId,
        direction: 'in',
        kind: 'http',
        method: exchange.request.method ?? null,
        jsonrpcId: null,
        durationMs,
        raw: JSON.stringify(exchange),
      }),
    forgetSession(server, sessionId) {
      const prefix = JSON.stringify([server, sessionId]).slice(0, -1);
      for (const key of pending.keys()) {
        if (key.startsWith(prefix)) {
          pending.delete(key);
        }
      }
    },
  };
}

type Classification = {
  kind: LogKind;
  method: string | null;
  jsonrpcId: string | number | null;
};

const classify = (message: unknown): Classification => {
  if (
    typeof message !== 'object' ||
    message === null ||
    Array.isArray(message)
  ) {
    return { kind: 'invalid', method: null, jsonrpcId: null };
  }
  const id =
    'id' in message &&
    (typeof message.id === 'string' || typeof message.id === 'number')
      ? message.id
      : null;
  if ('method' in message && typeof message.method === 'string') {
    return {
      kind: 'id' in message ? 'request' : 'notification',
      method: message.method,
      jsonrpcId: id,
    };
  }
  if ('result' in message) {
    return { kind: 'response', method: null, jsonrpcId: id };
  }
  if ('error' in message) {
    return { kind: 'error', method: null, jsonrpcId: id };
  }
  return { kind: 'invalid', method: null, jsonrpcId: id };
};

const opposite = (direction: LogDirection): LogDirection =>
  direction === 'in' ? 'out' : 'in';
