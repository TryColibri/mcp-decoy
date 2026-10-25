import { type LogStore } from '@/server/logs';
import {
  type HTTPFact,
  type LogFact,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';

import { bodyOf, truncate } from './bodies';
import { createSSEParser, type SSEEvent } from './sse-parser';

/** Where a message was seen. */
export type CaptureOrigin = {
  /** Server that handled the message. */
  server: string;
  /** MCP session, or `null` when the message belongs to none. */
  sessionId: string | null;
};

/** Parameters of `Capture.begin`. */
export type BeginParams = {
  /** Servers the exchange is recorded under: one for `/s/{server}/mcp`, any number for OAuth routes. */
  servers: string[];
  /** `mcp` exchanges record JSON-RPC messages too; `oauth` ones only the HTTP exchange. */
  endpoint: 'mcp' | 'oauth';
  /** The request. Its `signal` tells when the client leaves. */
  request: Request;
  /** The request body, read once by the caller; `null` when the request has none. */
  body: string | null;
};

/** One HTTP exchange being recorded. */
export type Exchange = {
  /**
   * Writes the facts of the exchange and returns the response to send.
   * An event stream body is piped through a recorder that writes one fact per
   * event, so the response must be sent as returned.
   *
   * @param response - The response the handler produced.
   */
  respond(response: Response): Promise<Response>;
  /** `false` once the exchange is over: its event stream has closed, or it had none. `true` before `respond`. */
  readonly open: boolean;
};

/**
 * Records HTTP exchanges and the JSON-RPC messages they carry as facts, taken
 * from the wire: request bodies, and response bodies as they stream through.
 */
export type Capture = {
  /** Starts recording an exchange. Nothing is written until `respond`, or until the client leaves. */
  begin(params: BeginParams): Exchange;
  /** Records a server message the SDK dropped because no standalone stream was open. */
  undelivered(origin: CaptureOrigin, message: unknown): void;
  /**
   * Writes `no-reply` for the session's pending requests, then forgets them.
   * A client request whose exchange is still streaming is left to that
   * exchange: a reply already queued still drains through it.
   */
  forgetSession(server: string, sessionId: string): void;
};

/** Upper bound on remembered unanswered requests, across all sessions. */
const MAX_PENDING = 10_000;

type Pending = {
  /** `id` of the request fact. */
  factId: number;
  /** Who sent the request. */
  from: 'client' | 'server';
  /** `id` of the `http` fact that carried it. */
  carriedBy: number;
  /** `performance.now()` when it arrived. */
  startedAt: number;
  /** The session closed while the carrying exchange was still streaming. */
  sessionClosed: boolean;
};

/** What an exchange keeps of the `http` fact it wrote. */
type Carrier = Pick<LogFact, 'id' | 'server' | 'sessionId'>;

/** What a recorded exchange remembers of its own request body. */
type ExchangeState = {
  /** Client requests of the exchange's own body, in order. */
  requests: OwnRequest[];
};

/** A client request of an exchange's own body. */
type OwnRequest = {
  key: string;
  factId: number;
};

type ClientMessage = {
  /** The parsed JSON, or `undefined` when the body isn't JSON. */
  message: unknown;
  /** Its JSON text. */
  raw: string;
};

type Clock = {
  now: () => Date;
  monotonic: () => number;
};

/**
 * Creates a capture that writes to `store`.
 *
 * @param store - Where facts go.
 * @param clock - Wall clock and monotonic clock; injectable for tests.
 */
export function createCapture(
  store: LogStore,
  clock: Clock = {
    now: () => new Date(),
    monotonic: () => performance.now(),
  },
): Capture {
  const pending = new Map<string, Pending>();
  // `http` fact ids of exchanges whose event stream is open.
  const streaming = new Set<number>();

  const pendingKey = (
    origin: CaptureOrigin,
    from: 'client' | 'server',
    id: string | number,
  ) => JSON.stringify([origin.server, origin.sessionId, from, typeof id, id]);

  const elapsed = (since: number) =>
    Math.round((clock.monotonic() - since) * 10) / 10;

  const remember = (key: string, entry: Pending) => {
    if (pending.size >= MAX_PENDING) {
      const oldest = pending.keys().next();
      if (oldest.done !== true) {
        pending.delete(oldest.value);
      }
    }
    pending.set(key, entry);
  };

  // The request `key` stands for, if it's still pending and still stored.
  const take = (key: string) => {
    const entry = pending.get(key);
    if (entry === undefined) {
      return undefined;
    }
    pending.delete(key);
    return store.get(entry.factId) === undefined ? undefined : entry;
  };

  const writeNoReply = (
    factId: number,
    reason: NoReplyFact['reason'],
  ): void => {
    const request = store.get(factId);
    if (request === undefined) {
      return;
    }
    store.append({
      type: 'no-reply',
      at: clock.now().toISOString(),
      server: request.server,
      sessionId: request.sessionId,
      replyTo: factId,
      reason,
    });
  };

  type MessageSource = {
    from: 'client' | 'server';
    at: string;
    carriedBy: number | null;
    sse: MCPFact['sse'];
    /** The exchange the message arrived in, so an error with a null id can find its request. */
    exchange?: ExchangeState;
  };

  const record = (
    origin: CaptureOrigin,
    { from, at, carriedBy, sse, exchange }: MessageSource,
    { message, raw }: ClientMessage,
  ): void => {
    const { kind, method, jsonrpcId } = classify(message);
    let replyTo: number | null = null;
    let durationMs: number | null = null;

    if (kind === 'response' || kind === 'error') {
      const requestFrom = from === 'client' ? 'server' : 'client';
      let key: string | undefined;
      if (jsonrpcId !== null) {
        key = pendingKey(origin, requestFrom, jsonrpcId);
      } else if (from === 'server') {
        key = onlyUnanswered(exchange);
      }
      const request = key === undefined ? undefined : take(key);
      if (request !== undefined) {
        replyTo = request.factId;
        durationMs = elapsed(request.startedAt);
      }
    }

    const cut = truncate(raw);
    const fact = store.append({
      type: 'mcp',
      at,
      server: origin.server,
      sessionId: origin.sessionId,
      from,
      kind,
      method,
      jsonrpcId,
      raw: cut.text,
      truncated: cut.truncated,
      carriedBy,
      sse,
      replyTo,
      durationMs,
    });

    if (
      kind === 'request' &&
      jsonrpcId !== null &&
      method !== null &&
      carriedBy !== null
    ) {
      const key = pendingKey(origin, from, jsonrpcId);
      remember(key, {
        factId: fact.id,
        from,
        carriedBy,
        startedAt: clock.monotonic(),
        sessionClosed: false,
      });
      if (from === 'client') {
        exchange?.requests.push({ key, factId: fact.id });
      }
    }
  };

  // A JSON-RPC error with `id: null` answers the exchange's only unanswered request.
  const onlyUnanswered = (exchange: ExchangeState | undefined) => {
    const unanswered = (exchange?.requests ?? []).filter(
      ({ key, factId }) => pending.get(key)?.factId === factId,
    );
    return unanswered.length === 1 ? unanswered[0].key : undefined;
  };

  const decideOwnRequests = (
    exchange: ExchangeState,
    reason: NoReplyFact['reason'],
  ) => {
    for (const { key, factId } of exchange.requests) {
      const entry = pending.get(key);
      if (entry?.factId !== factId) {
        continue;
      }
      pending.delete(key);
      writeNoReply(factId, entry.sessionClosed ? 'session-closed' : reason);
    }
  };

  return {
    begin({ servers, endpoint, request, body }) {
      const arrivedAt = clock.now();
      const startedAt = clock.monotonic();
      const state: ExchangeState = { requests: [] };
      const clientMessages: ClientMessage[] =
        endpoint === 'mcp' && body !== null ? parseBody(body) : [];
      let open = true;
      // The `http` facts have been written.
      let written = false;
      let ended = false;
      let events = 0;
      let httpFacts: Carrier[] = [];

      const requestRecord = (): HTTPFact['request'] => {
        const cut = truncate(body ?? '');
        return {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          ...(cut.text === ''
            ? {}
            : {
                body: bodyOf(request.headers.get('content-type'), cut.text),
              }),
          truncated: cut.truncated,
        };
      };

      // Appends the `http` fact of each server, then the client's messages.
      const writeHead = (
        response: HTTPFact['response'],
        sessionId: string | null,
      ) => {
        written = true;
        httpFacts = servers.map((server) =>
          store.append({
            type: 'http',
            at: arrivedAt.toISOString(),
            server,
            sessionId,
            endpoint,
            request: requestRecord(),
            response,
            durationMs: elapsed(startedAt),
          }),
        );
        const carrier = httpFacts.at(0);
        if (endpoint !== 'mcp' || carrier === undefined) {
          return;
        }
        const origin = { server: carrier.server, sessionId };
        for (const message of clientMessages) {
          record(
            origin,
            {
              from: 'client',
              at: arrivedAt.toISOString(),
              carriedBy: carrier.id,
              sse: null,
              exchange: state,
            },
            message,
          );
        }
      };

      // For checks after an `await`, where `ended` may have changed.
      const hasEnded = () => ended;

      const end = (endState: 'complete' | 'aborted') => {
        if (ended) {
          return;
        }
        ended = true;
        open = false;
        request.signal.removeEventListener('abort', onAbort);
        for (const { id } of httpFacts) {
          streaming.delete(id);
          // Read again: the server may have been renamed, or the fact evicted.
          const fact = store.get(id);
          if (fact === undefined) {
            continue;
          }
          store.append({
            type: 'http-end',
            at: clock.now().toISOString(),
            server: fact.server,
            sessionId: fact.sessionId,
            exchange: id,
            state: endState,
            durationMs: elapsed(startedAt),
            events,
          });
        }
        decideOwnRequests(state, 'exchange-ended');
      };

      // The client left. Before the response head, the exchange is recorded
      // without a response and every request in its body gets no reply.
      const onAbort = () => {
        if (ended) {
          return;
        }
        if (written) {
          end('aborted');
          return;
        }
        ended = true;
        open = false;
        writeHead(null, request.headers.get('mcp-session-id'));
        decideOwnRequests(state, 'exchange-ended');
      };
      request.signal.addEventListener('abort', onAbort, { once: true });

      const writeEvent = (
        origin: CaptureOrigin,
        carriedBy: number,
        event: SSEEvent,
      ) => {
        events++;
        if (event.data === null || event.data === '') {
          return;
        }
        let message: unknown;
        try {
          message = JSON.parse(event.data);
        } catch {
          message = undefined;
        }
        record(
          origin,
          {
            from: 'server',
            at: clock.now().toISOString(),
            carriedBy,
            sse: { id: event.id, event: event.event },
          },
          { message, raw: event.data },
        );
      };

      const recorder = (
        origin: CaptureOrigin,
        carriedBy: number,
      ): TransformStream<Uint8Array, Uint8Array> => {
        const decoder = new TextDecoder();
        const parser = createSSEParser();
        return new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk);
            if (ended) {
              return;
            }
            for (const event of parser.feed(
              decoder.decode(chunk, { stream: true }),
            )) {
              writeEvent(origin, carriedBy, event);
            }
          },
          flush() {
            end('complete');
          },
          cancel() {
            end('aborted');
          },
        });
      };

      return {
        get open() {
          return open;
        },

        async respond(response) {
          if (request.signal.aborted) {
            onAbort();
          }
          if (ended) {
            void response.body?.cancel().catch(() => {});
            return response;
          }
          const contentType = response.headers.get('content-type');
          const stream = (contentType ?? '').includes('text/event-stream');
          let text = '';
          if (!stream) {
            text = await response.clone().text();
            // The client left while the body was read.
            if (hasEnded()) {
              return response;
            }
          }
          const cut = truncate(text);
          const sessionId =
            response.headers.get('mcp-session-id') ??
            request.headers.get('mcp-session-id');
          writeHead(
            {
              status: response.status,
              headers: Object.fromEntries(response.headers.entries()),
              stream,
              ...(cut.text === ''
                ? {}
                : { body: bodyOf(contentType, cut.text) }),
              truncated: cut.truncated,
            },
            sessionId,
          );

          const carrier = httpFacts.at(0);
          if (!stream || response.body === null || carrier === undefined) {
            if (endpoint === 'mcp' && carrier !== undefined) {
              const origin = { server: carrier.server, sessionId };
              for (const message of jsonRPCMessages(text)) {
                record(
                  origin,
                  {
                    from: 'server',
                    at: clock.now().toISOString(),
                    carriedBy: carrier.id,
                    sse: null,
                    exchange: state,
                  },
                  message,
                );
              }
            }
            ended = true;
            open = false;
            request.signal.removeEventListener('abort', onAbort);
            decideOwnRequests(state, 'exchange-ended');
            return response;
          }

          for (const fact of httpFacts) {
            streaming.add(fact.id);
          }
          return new Response(
            response.body.pipeThrough(
              recorder({ server: carrier.server, sessionId }, carrier.id),
            ),
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            },
          );
        },
      };
    },

    undelivered(origin, message) {
      record(
        origin,
        {
          from: 'server',
          at: clock.now().toISOString(),
          carriedBy: null,
          sse: null,
        },
        { message, raw: JSON.stringify(message) },
      );
    },

    forgetSession(server, sessionId) {
      const prefix = JSON.stringify([server, sessionId]).slice(0, -1);
      for (const [key, entry] of pending) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        if (entry.from === 'client' && streaming.has(entry.carriedBy)) {
          // The exchange that carried it decides when it ends.
          entry.sessionClosed = true;
          continue;
        }
        pending.delete(key);
        writeNoReply(entry.factId, 'session-closed');
      }
    },
  };
}

type Classification = {
  kind: MCPFact['kind'];
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

/** The messages of a request body: a batch gives one each, a body that isn't JSON gives one invalid. */
const parseBody = (body: string): ClientMessage[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [{ message: undefined, raw: body }];
  }
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.map((message: unknown) => ({
      message,
      raw: JSON.stringify(message),
    }));
  }
  return [{ message: parsed, raw: body }];
};

/** JSON-RPC messages in a non-stream response body. Anything else, such as an OAuth challenge, is none. */
const jsonRPCMessages = (text: string): ClientMessage[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const batch = Array.isArray(parsed);
  const messages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return messages
    .filter(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'jsonrpc' in message &&
        message.jsonrpc === '2.0',
    )
    .map((message) => ({
      message,
      raw: batch ? JSON.stringify(message) : text,
    }));
};
