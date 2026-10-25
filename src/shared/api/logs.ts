import { z } from 'zod';

/** Maximum size, in bytes, of a stored `request.body`, `response.body` or `raw`. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Fields every fact has. */
type LogFactBase = {
  /** Monotonic across the process; also the SSE event id. */
  id: number;
  /** Capture time, ISO 8601 with milliseconds. For `http` facts, the request's arrival. */
  at: string;
  /** Name of the server the fact belongs to. */
  server: string;
  /** MCP session, or `null` when the fact belongs to none. */
  sessionId: string | null;
};

/** The request side of an HTTP exchange. */
export type HTTPRequestRecord = {
  /** HTTP method: `GET`, `POST`, `DELETE`, … */
  method: string;
  /** Full URL of the request. */
  url: string;
  /** Headers, lower-cased names. */
  headers: Record<string, string>;
  /**
   * Body. A JSON body is its parsed value, a form body decodes to an object,
   * an HTML body becomes `"(HTML, N bytes)"`, anything else is the raw text.
   */
  body?: unknown;
  /** Whether the body was cut at `MAX_BODY_BYTES`. */
  truncated: boolean;
};

const httpRequestRecordSchema: z.ZodType<HTTPRequestRecord> = z.strictObject({
  method: z.string().describe('HTTP method: `GET`, `POST`, `DELETE`, …'),
  url: z.string().describe('Full URL of the request.'),
  headers: z
    .record(z.string(), z.string())
    .describe('Headers, lower-cased names.'),
  body: z
    .unknown()
    .optional()
    .describe(
      'Body. A JSON body is its parsed value, a form body decodes to an object, an HTML body becomes `"(HTML, N bytes)"`, anything else is the raw text.',
    ),
  truncated: z
    .boolean()
    .describe('Whether the body was cut at `MAX_BODY_BYTES`.'),
});

/** The response side of an HTTP exchange. */
export type HTTPResponseRecord = {
  /** Status code. */
  status: number;
  /** Headers as sent, CORS headers included. */
  headers: Record<string, string>;
  /** Whether the body is an event stream: it isn't stored, an `http-end` fact follows. */
  stream: boolean;
  /** Body of a non-stream response, shaped like `HTTPRequestRecord.body`. */
  body?: unknown;
  /** Whether the body was cut at `MAX_BODY_BYTES`. */
  truncated: boolean;
};

const httpResponseRecordSchema: z.ZodType<HTTPResponseRecord> = z.strictObject({
  status: z.number().int().describe('Status code.'),
  headers: z
    .record(z.string(), z.string())
    .describe('Headers as sent, CORS headers included.'),
  stream: z
    .boolean()
    .describe(
      "Whether the body is an event stream: it isn't stored, an `http-end` fact follows.",
    ),
  body: z
    .unknown()
    .optional()
    .describe(
      'Body of a non-stream response, shaped like `HTTPRequestRecord.body`.',
    ),
  truncated: z
    .boolean()
    .describe('Whether the body was cut at `MAX_BODY_BYTES`.'),
});

/** Anchor of an HTTP entry. Written when the response head goes out. */
export type HTTPFact = LogFactBase & {
  type: 'http';
  /** `mcp` for `/s/{server}/mcp`, `oauth` for every other route of the MCP listener. */
  endpoint: 'mcp' | 'oauth';
  /** The request MCP Decoy received. */
  request: HTTPRequestRecord;
  /** The response MCP Decoy sent; `null` when the client left before the headers. */
  response: HTTPResponseRecord | null;
  /** Milliseconds from arrival until the head was sent (a non-stream body is read first), or until the client left. */
  durationMs: number;
};

/** Attachment of an `http` fact. Written when its event stream closes. */
export type HTTPEndFact = LogFactBase & {
  type: 'http-end';
  /** `id` of the `http` fact. */
  exchange: number;
  /** Whether the stream ended on its own or the client left. */
  state: 'complete' | 'aborted';
  /** Milliseconds from arrival until the stream closed. */
  durationMs: number;
  /** Number of SSE events, including ones without data. */
  events: number;
};

/** What an `mcp` fact is. `invalid` is a body that isn't a JSON-RPC message. */
export type MCPKind =
  | 'request'
  | 'response'
  | 'error'
  | 'notification'
  | 'invalid';

/** One JSON-RPC message on the wire, or one the SDK dropped. */
export type MCPFact = LogFactBase & {
  type: 'mcp';
  /** Who sent the message. */
  from: 'client' | 'server';
  /** JSON-RPC message kind. */
  kind: MCPKind;
  /** JSON-RPC method as on the wire; `null` on replies. */
  method: string | null;
  /** JSON-RPC id, `null` for notifications. */
  jsonrpcId: string | number | null;
  /** Exact JSON text of the message. */
  raw: string;
  /** Whether `raw` was cut at `MAX_BODY_BYTES`. */
  truncated: boolean;
  /** `id` of the `http` fact that carried the message; `null` when it was never sent. */
  carriedBy: number | null;
  /** The SSE event that carried the message; `null` when it wasn't an event. */
  sse: { id: string | null; event: string | null } | null;
  /** On replies that found their request: its `id`. This makes the fact an attachment. */
  replyTo: number | null;
  /** On replies: milliseconds since the request. */
  durationMs: number | null;
};

/** Attachment of an MCP request that will never get a reply. */
export type NoReplyFact = LogFactBase & {
  type: 'no-reply';
  /** `id` of the request fact. */
  replyTo: number;
  /** Why no reply will come. */
  reason: 'exchange-ended' | 'session-closed';
};

/** Anything the log store holds. */
export type LogFact = HTTPFact | HTTPEndFact | MCPFact | NoReplyFact;

const factBaseShape = {
  id: z
    .number()
    .int()
    .describe('Monotonic across the process; also the SSE event id.'),
  at: z.iso
    .datetime()
    .describe(
      "Capture time, ISO 8601 with milliseconds. For `http` facts, the request's arrival.",
    ),
  server: z.string().describe('Name of the server the fact belongs to.'),
  sessionId: z
    .string()
    .nullable()
    .describe('MCP session, or `null` when the fact belongs to none.'),
};

const httpFactSchema = z.strictObject({
  ...factBaseShape,
  type: z.literal('http'),
  endpoint: z
    .enum(['mcp', 'oauth'])
    .describe(
      '`mcp` for `/s/{server}/mcp`, `oauth` for every other route of the MCP listener.',
    ),
  request: httpRequestRecordSchema.describe('The request MCP Decoy received.'),
  response: httpResponseRecordSchema
    .nullable()
    .describe(
      'The response MCP Decoy sent; `null` when the client left before the headers.',
    ),
  durationMs: z
    .number()
    .describe(
      'Milliseconds from arrival until the head was sent (a non-stream body is read first), or until the client left.',
    ),
});

const httpEndFactSchema = z.strictObject({
  ...factBaseShape,
  type: z.literal('http-end'),
  exchange: z.number().int().describe('`id` of the `http` fact.'),
  state: z
    .enum(['complete', 'aborted'])
    .describe('Whether the stream ended on its own or the client left.'),
  durationMs: z
    .number()
    .describe('Milliseconds from arrival until the stream closed.'),
  events: z
    .number()
    .int()
    .describe('Number of SSE events, including ones without data.'),
});

const mcpFactSchema = z.strictObject({
  ...factBaseShape,
  type: z.literal('mcp'),
  from: z.enum(['client', 'server']).describe('Who sent the message.'),
  kind: z
    .enum(['request', 'response', 'error', 'notification', 'invalid'])
    .describe('JSON-RPC message kind.'),
  method: z
    .string()
    .nullable()
    .describe('JSON-RPC method as on the wire; `null` on replies.'),
  jsonrpcId: z
    .union([z.string(), z.number()])
    .nullable()
    .describe('JSON-RPC id, `null` for notifications.'),
  raw: z.string().describe('Exact JSON text of the message.'),
  truncated: z.boolean().describe('Whether `raw` was cut at `MAX_BODY_BYTES`.'),
  carriedBy: z
    .number()
    .int()
    .nullable()
    .describe(
      '`id` of the `http` fact that carried the message; `null` when it was never sent.',
    ),
  sse: z
    .strictObject({
      id: z.string().nullable().describe('SSE `id` field of the event.'),
      event: z.string().nullable().describe('SSE `event` field of the event.'),
    })
    .nullable()
    .describe(
      "The SSE event that carried the message; `null` when it wasn't an event.",
    ),
  replyTo: z
    .number()
    .int()
    .nullable()
    .describe(
      'On replies that found their request: its `id`. This makes the fact an attachment.',
    ),
  durationMs: z
    .number()
    .nullable()
    .describe('On replies: milliseconds since the request.'),
});

const noReplyFactSchema = z.strictObject({
  ...factBaseShape,
  type: z.literal('no-reply'),
  replyTo: z.number().int().describe('`id` of the request fact.'),
  reason: z
    .enum(['exchange-ended', 'session-closed'])
    .describe('Why no reply will come.'),
});

export const logFactSchema: z.ZodType<LogFact> = z.discriminatedUnion('type', [
  httpFactSchema,
  httpEndFactSchema,
  mcpFactSchema,
  noReplyFactSchema,
]);

/** Where a log entry is in its life. */
export type LogState = 'pending' | 'streaming' | 'complete' | 'aborted';

/** An HTTP exchange: its anchor and, once an event stream closes, its end. */
export type HTTPEntry = {
  type: 'http';
  /** Same as `exchange.id`. */
  id: number;
  /** The `http` fact. */
  exchange: HTTPFact;
  /** The `http-end` fact, once the event stream has closed. */
  end: HTTPEndFact | null;
  /** `streaming` while the event stream is open. */
  state: Exclude<LogState, 'pending'>;
  /** Duration of the whole exchange; `null` while a stream is open. */
  durationMs: number | null;
};

/** An MCP request and its reply, or one unpaired message. */
export type MCPEntry = {
  type: 'mcp';
  /** Same as `message.id`. */
  id: number;
  /** The message: the request of a pair, or the unpaired message. */
  message: MCPFact;
  /** The reply, or the decision that none will come; `null` while pending and on unpaired messages. */
  reply: MCPFact | NoReplyFact | null;
  /** `pending` until a request is answered or given up on; unpaired messages are `complete`. */
  state: Exclude<LogState, 'streaming'>;
  /** Milliseconds from request to reply; `null` without one. */
  durationMs: number | null;
};

const httpEntrySchema = z.strictObject({
  type: z.literal('http'),
  id: z.number().int().describe('Same as `exchange.id`.'),
  exchange: httpFactSchema.describe('The `http` fact.'),
  end: httpEndFactSchema
    .nullable()
    .describe('The `http-end` fact, once the event stream has closed.'),
  state: z
    .enum(['streaming', 'complete', 'aborted'])
    .describe('`streaming` while the event stream is open.'),
  durationMs: z
    .number()
    .nullable()
    .describe('Duration of the whole exchange; `null` while a stream is open.'),
});

const mcpEntrySchema = z.strictObject({
  type: z.literal('mcp'),
  id: z.number().int().describe('Same as `message.id`.'),
  message: mcpFactSchema.describe(
    'The message: the request of a pair, or the unpaired message.',
  ),
  reply: z
    .discriminatedUnion('type', [mcpFactSchema, noReplyFactSchema])
    .nullable()
    .describe(
      'The reply, or the decision that none will come; `null` while pending and on unpaired messages.',
    ),
  state: z
    .enum(['pending', 'complete', 'aborted'])
    .describe(
      '`pending` until a request is answered or given up on; unpaired messages are `complete`.',
    ),
  durationMs: z
    .number()
    .nullable()
    .describe('Milliseconds from request to reply; `null` without one.'),
});

/** One row of the log: an anchor fact and its attachment, reconciled. */
export type LogEntry = HTTPEntry | MCPEntry;

export const logEntrySchema: z.ZodType<LogEntry> = z.discriminatedUnion(
  'type',
  [httpEntrySchema, mcpEntrySchema],
);

/** Response body of `GET /api/v1/servers/{server}/logs`. */
export type LogPage = {
  /** Entries, newest first. */
  items: LogEntry[];
  /** Pass as `cursor` to get older entries; `null` on the last page. */
  nextCursor: string | null;
  /** Entries matching the query on the server, across all pages. */
  total: number;
  /** Highest fact id assigned when the page was read, across all servers. Start the stream here. */
  after: number;
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
    .describe('Entries matching the query on the server, across all pages.'),
  after: z
    .number()
    .int()
    .min(0)
    .describe(
      'Highest fact id assigned when the page was read, across all servers. Start the stream here.',
    ),
});

/** Default page size of `GET /api/v1/servers/{server}/logs`. */
export const LOG_PAGE_DEFAULT_LIMIT = 100;

/** Maximum page size of `GET /api/v1/servers/{server}/logs`. */
export const LOG_PAGE_MAX_LIMIT = 1000;

/** Query string of `GET /api/v1/servers/{server}/logs`. */
export type LogPageQuery = {
  /** Case-insensitive substring over method, URL, headers, bodies and raw JSON. */
  q?: string;
  /** Only entries with a fact carried by this `http` fact id. */
  carriedBy?: number;
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
    .describe(
      'Case-insensitive substring over method, URL, headers, bodies and raw JSON.',
    ),
  carriedBy: z.coerce
    .number<string>()
    .int()
    .min(0)
    .optional()
    .describe('Only entries with a fact carried by this `http` fact id.'),
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
  /** Case-insensitive substring over method, URL, headers, bodies and raw JSON. */
  q?: string;
  /** Replay facts with an id greater than this one first. `Last-Event-ID` takes precedence. */
  after?: number;
};

export const logStreamQuerySchema: z.ZodType<
  LogStreamQuery,
  Record<string, string>
> = z.strictObject({
  q: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring over method, URL, headers, bodies and raw JSON.',
    ),
  after: z.coerce
    .number<string>()
    .int()
    .min(0)
    .optional()
    .describe(
      'Replay facts with an id greater than this one first. `Last-Event-ID` takes precedence.',
    ),
});

/** Data of the `evicted` SSE event. */
export type LogEvicted = {
  /** Id of the anchor the server dropped to make room. */
  id: number;
};

export const logEvictedSchema: z.ZodType<LogEvicted> = z.strictObject({
  id: z
    .number()
    .int()
    .describe('Id of the anchor the server dropped to make room.'),
});

/** SSE event names sent by `GET /api/v1/servers/{server}/logs/stream`. */
export const LOG_STREAM_EVENTS = {
  /**
   * `data` is a `LogFact`; the SSE `id` is the fact id. An anchor sent late,
   * because it matched `q` only once its attachment arrived, has no SSE `id`.
   */
  fact: 'fact',
  /** An anchor matching `q` was dropped to make room; `data` is a `LogEvicted`. */
  evicted: 'evicted',
  /** The server's log was cleared; `data` is `{}`. */
  cleared: 'cleared',
} as const;
