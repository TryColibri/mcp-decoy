import { z } from 'zod';

/** Which way a message travelled. `in` is client → server. */
export type LogDirection = 'in' | 'out';

/**
 * JSON-RPC message kind. `invalid` is a body that isn't a JSON-RPC message.
 * `http` is an OAuth HTTP exchange, not a JSON-RPC message.
 */
export type LogKind =
  | 'request'
  | 'response'
  | 'error'
  | 'notification'
  | 'invalid'
  | 'http';

/** One JSON-RPC message captured on a server, in either direction. */
export type LogEntry = {
  /** Monotonic across the process; also the SSE event id. */
  id: number;
  /** Capture time, ISO 8601 with milliseconds. */
  at: string;
  /** Name of the server that handled the message. */
  server: string;
  /** MCP session, or `null` when the message belongs to none. */
  sessionId: string | null;
  /** `in` is client → server, `out` is server → client. */
  direction: LogDirection;
  /** JSON-RPC message kind. */
  kind: LogKind;
  /** JSON-RPC method; for responses, copied from the matching request. */
  method: string | null;
  /** JSON-RPC id, `null` for notifications. */
  jsonrpcId: string | number | null;
  /** On responses: milliseconds since the matching request. */
  durationMs: number | null;
  /** Exact JSON text of the message. */
  raw: string;
};

export const logEntrySchema: z.ZodType<LogEntry> = z.strictObject({
  id: z
    .number()
    .int()
    .describe('Monotonic across the process; also the SSE event id.'),
  at: z.iso.datetime().describe('Capture time, ISO 8601 with milliseconds.'),
  server: z.string().describe('Name of the server that handled the message.'),
  sessionId: z
    .string()
    .nullable()
    .describe('MCP session, or `null` when the message belongs to none.'),
  direction: z
    .enum(['in', 'out'])
    .describe('`in` is client → server, `out` is server → client.'),
  kind: z
    .enum(['request', 'response', 'error', 'notification', 'invalid', 'http'])
    .describe('JSON-RPC message kind.'),
  method: z
    .string()
    .nullable()
    .describe(
      'JSON-RPC method; for responses, copied from the matching request.',
    ),
  jsonrpcId: z
    .union([z.string(), z.number()])
    .nullable()
    .describe('JSON-RPC id, `null` for notifications.'),
  durationMs: z
    .number()
    .nullable()
    .describe('On responses: milliseconds since the matching request.'),
  raw: z.string().describe('Exact JSON text of the message.'),
});

/** Response body of `GET /api/v1/servers/{server}/logs`. */
export type LogPage = {
  /** Entries, newest first. */
  items: LogEntry[];
  /** Pass as `cursor` to get older entries; `null` on the last page. */
  nextCursor: string | null;
  /** Entries matching `q` on the server, across all pages. */
  total: number;
};

export const logPageSchema: z.ZodType<LogPage> = z.strictObject({
  items: z.array(logEntrySchema).describe('Entries, newest first.'),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      'Pass as `cursor` to get older entries; `null` on the last page.',
    ),
  total: z
    .number()
    .int()
    .min(0)
    .describe('Entries matching `q` on the server, across all pages.'),
});

/** Default page size of `GET /api/v1/servers/{server}/logs`. */
export const LOG_PAGE_DEFAULT_LIMIT = 100;

/** Maximum page size of `GET /api/v1/servers/{server}/logs`. */
export const LOG_PAGE_MAX_LIMIT = 1000;

/** Query string of `GET /api/v1/servers/{server}/logs`. */
export type LogPageQuery = {
  /** Case-insensitive substring over method and raw JSON. */
  q?: string;
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Page size, 1–1000. Default: 100. */
  limit?: number;
};

export const logPageQuerySchema: z.ZodType<
  LogPageQuery,
  Record<string, string>
> = z.strictObject({
  q: z
    .string()
    .optional()
    .describe('Case-insensitive substring over method and raw JSON.'),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from a previous page's `nextCursor`."),
  limit: z.coerce
    .number<string>()
    .int()
    .min(1)
    .max(LOG_PAGE_MAX_LIMIT)
    .optional()
    .describe('Page size, 1–1000. Default: 100.'),
});

/** Query string of `GET /api/v1/servers/{server}/logs/stream`. */
export type LogStreamQuery = {
  /** Case-insensitive substring over method and raw JSON. */
  q?: string;
  /** Replay entries with an id greater than this one first. `Last-Event-ID` takes precedence. */
  after?: number;
};

export const logStreamQuerySchema: z.ZodType<
  LogStreamQuery,
  Record<string, string>
> = z.strictObject({
  q: z
    .string()
    .optional()
    .describe('Case-insensitive substring over method and raw JSON.'),
  after: z.coerce
    .number<string>()
    .int()
    .min(0)
    .optional()
    .describe(
      'Replay entries with an id greater than this one first. `Last-Event-ID` takes precedence.',
    ),
});

/** Data of the `evicted` SSE event. */
export type LogEvicted = {
  /** Id of the entry the server dropped to make room. */
  id: number;
};

export const logEvictedSchema: z.ZodType<LogEvicted> = z.strictObject({
  id: z
    .number()
    .int()
    .describe('Id of the entry the server dropped to make room.'),
});

/** One side of an `HTTPExchange`. */
export type HTTPMessage = {
  /** Status code; absent on the request side. */
  status?: number;
  /** Method and path, e.g. `POST /token`; absent on the response side. */
  method?: string;
  /** URL; absent on the response side. */
  url?: string;
  /** Headers, lower-cased names. */
  headers: Record<string, string>;
  /**
   * Body. Form bodies decode to an object; HTML bodies become
   * `"(HTML, N bytes)"`; a JSON body is its parsed value; anything else is
   * the raw text.
   */
  body?: unknown;
};

const httpMessageSchema: z.ZodType<HTTPMessage> = z.strictObject({
  status: z.number().int().optional().describe('Status code.'),
  method: z
    .string()
    .optional()
    .describe('Method and path, e.g. `POST /token`.'),
  url: z.string().optional().describe('URL.'),
  headers: z
    .record(z.string(), z.string())
    .describe('Headers, lower-cased names.'),
  body: z
    .unknown()
    .optional()
    .describe(
      'Body. Form bodies decode to an object; HTML bodies become `"(HTML, N bytes)"`.',
    ),
});

/** The `raw` payload of an `http`-kind `LogEntry`: one OAuth HTTP exchange. */
export type HTTPExchange = {
  /** The request MCP Decoy received. */
  request: HTTPMessage;
  /** The response MCP Decoy sent. */
  response: HTTPMessage;
};

export const httpExchangeSchema: z.ZodType<HTTPExchange> = z.strictObject({
  request: httpMessageSchema.describe('The request MCP Decoy received.'),
  response: httpMessageSchema.describe('The response MCP Decoy sent.'),
});

/** SSE event names sent by `GET /api/v1/servers/{server}/logs/stream`. */
export const LOG_STREAM_EVENTS = {
  /** `data` is a `LogEntry`; the SSE `id` is the entry id. */
  entry: 'entry',
  /** An entry matching `q` was dropped to make room; `data` is a `LogEvicted`. */
  evicted: 'evicted',
  /** The server's log was cleared; `data` is `{}`. */
  cleared: 'cleared',
} as const;
