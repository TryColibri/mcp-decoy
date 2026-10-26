import {
  type HTTPEndFact,
  type HTTPFact,
  type LogEntry,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';
import { reconcile } from '@/shared/logs';

// Builders of facts and entries for the Logs tab's tests.

let nextId = 1;

/** Next fact id, unique across a test file. */
export const freshId = () => nextId++;

const base = {
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
};

/** An `mcp` fact: a client request unless `fields` say otherwise. */
export const mcpFact = (fields: Partial<MCPFact> = {}): MCPFact => ({
  ...base,
  id: freshId(),
  type: 'mcp',
  from: 'client',
  kind: 'request',
  method: 'tools/list',
  jsonrpcId: 1,
  raw: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  truncated: false,
  carriedBy: null,
  sse: null,
  replyTo: null,
  durationMs: null,
  ...fields,
});

/** A server reply to `request`. */
export const replyFact = (
  request: MCPFact,
  result: unknown,
  fields: Partial<MCPFact> = {},
): MCPFact =>
  mcpFact({
    from: 'server',
    kind: 'response',
    method: null,
    jsonrpcId: request.jsonrpcId,
    raw: JSON.stringify({ jsonrpc: '2.0', id: request.jsonrpcId, result }),
    replyTo: request.id,
    durationMs: 12,
    ...fields,
  });

/** A server error reply to `request`. */
export const errorFact = (
  request: MCPFact,
  code: number,
  message: string,
  fields: Partial<MCPFact> = {},
): MCPFact =>
  mcpFact({
    from: 'server',
    kind: 'error',
    method: null,
    jsonrpcId: request.jsonrpcId,
    raw: JSON.stringify({
      jsonrpc: '2.0',
      id: request.jsonrpcId,
      error: { code, message },
    }),
    replyTo: request.id,
    durationMs: 3,
    ...fields,
  });

/** The decision that `request` will get no reply. */
export const noReplyFact = (
  request: MCPFact,
  reason: NoReplyFact['reason'] = 'exchange-ended',
): NoReplyFact => ({
  ...base,
  id: freshId(),
  type: 'no-reply',
  replyTo: request.id,
  reason,
});

/** An `http` fact: a streaming `GET` of an MCP server unless `fields` say otherwise. */
export const httpFact = (fields: Partial<HTTPFact> = {}): HTTPFact => ({
  ...base,
  id: freshId(),
  type: 'http',
  endpoint: 'mcp',
  request: {
    method: 'GET',
    url: 'http://127.0.0.1:6280/s/weather/mcp',
    headers: { accept: 'text/event-stream' },
    truncated: false,
  },
  response: {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    stream: true,
    truncated: false,
  },
  durationMs: 2,
  ...fields,
});

/** The end of the event stream of `exchange`. */
export const httpEndFact = (
  exchange: HTTPFact,
  fields: Partial<HTTPEndFact> = {},
): HTTPEndFact => ({
  ...base,
  id: freshId(),
  type: 'http-end',
  exchange: exchange.id,
  state: 'complete',
  durationMs: 5000,
  events: 3,
  ...fields,
});

/** An MCP entry of a request and its reply, or of one message. */
export const mcpEntry = (
  message: MCPFact,
  reply?: MCPFact | NoReplyFact,
): LogEntry => reconcile(message, reply === undefined ? [] : [reply]);

/** An HTTP entry of an exchange and, once its stream closed, its end. */
export const httpEntry = (exchange: HTTPFact, end?: HTTPEndFact): LogEntry =>
  reconcile(exchange, end === undefined ? [] : [end]);
