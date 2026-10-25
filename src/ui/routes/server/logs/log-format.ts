import { default as prettyMilliseconds, type Options } from 'pretty-ms';

import {
  type HTTPEntry,
  type LogEntry,
  type LogFact,
  type MCPEntry,
  type MCPFact,
} from '@/shared/api';

/** Label of the type tag shown next to an entry's name. */
export type LogType =
  | 'http'
  | 'oauth'
  | 'request'
  | 'server request'
  | 'client notify'
  | 'server notify'
  | 'client result'
  | 'server result'
  | 'client error'
  | 'server error'
  | 'invalid';

/** How a status reads: green, red, plain, or grey for what is still open. */
export type StatusTone = 'ok' | 'error' | 'neutral' | 'pending';

/** What the Status column shows. */
export type EntryStatus = {
  /** Text; empty when there is nothing to say. */
  label: string;
  /** How to color it. */
  tone: StatusTone;
};

/**
 * Whether an MCP entry is a request with (or waiting for) a reply, as opposed
 * to one unpaired message.
 *
 * @param entry - An MCP entry.
 */
export const isPair = (entry: MCPEntry): boolean =>
  entry.message.kind === 'request';

/**
 * The fact an entry is anchored on: the exchange, or the message.
 *
 * @param entry - A log entry.
 */
export const anchorOf = (entry: LogEntry): LogFact =>
  entry.type === 'http' ? entry.exchange : entry.message;

/**
 * Tag shown for an entry's type.
 *
 * @param entry - A log entry.
 */
export function typeOf(entry: LogEntry): LogType {
  if (entry.type === 'http') {
    return entry.exchange.endpoint === 'mcp' ? 'http' : 'oauth';
  }
  const { from, kind } = entry.message;
  switch (kind) {
    case 'request':
      return from === 'client' ? 'request' : 'server request';
    case 'notification':
      return from === 'client' ? 'client notify' : 'server notify';
    case 'response':
      return from === 'client' ? 'client result' : 'server result';
    case 'error':
      return from === 'client' ? 'client error' : 'server error';
    case 'invalid':
      return 'invalid';
  }
}

/**
 * Name shown for an entry: `POST /s/demo/mcp` for an exchange, the method for
 * a message, `#<id>` for a reply that found no request.
 *
 * @param entry - A log entry.
 */
export function nameOf(entry: LogEntry): string {
  if (entry.type === 'http') {
    const { request } = entry.exchange;
    return `${request.method} ${pathOf(request.url)}`;
  }
  const { method, jsonrpcId } = entry.message;
  if (method !== null) {
    return method;
  }
  return jsonrpcId === null ? '(unknown)' : `#${jsonrpcId}`;
}

/**
 * Status shown for an entry.
 *
 * @param entry - A log entry.
 */
export function statusOf(entry: LogEntry): EntryStatus {
  return entry.type === 'http' ? httpStatusOf(entry) : mcpStatusOf(entry);
}

const httpStatusOf = ({ exchange, state }: HTTPEntry): EntryStatus => {
  if (exchange.response === null) {
    return { label: 'no response', tone: 'error' };
  }
  if (state === 'streaming') {
    return { label: 'streaming', tone: 'pending' };
  }
  const { status } = exchange.response;
  const tone: StatusTone =
    status >= 400 ? 'error' : status >= 300 ? 'neutral' : 'ok';
  return { label: String(status), tone };
};

const mcpStatusOf = (entry: MCPEntry): EntryStatus => {
  if (!isPair(entry)) {
    return entry.message.carriedBy === null
      ? { label: 'not sent', tone: 'error' }
      : { label: '', tone: 'neutral' };
  }
  const { reply } = entry;
  if (reply === null) {
    return { label: 'pending', tone: 'pending' };
  }
  if (reply.type === 'no-reply') {
    return { label: 'no response', tone: 'error' };
  }
  if (reply.kind === 'error') {
    const code = errorOf(reply)?.code;
    return {
      label: typeof code === 'number' ? `error ${code}` : 'error',
      tone: 'error',
    };
  }
  return resultOf(reply)?.isError === true
    ? { label: 'isError', tone: 'error' }
    : { label: 'ok', tone: 'ok' };
};

const DURATION_FORMAT: Options = {
  secondsDecimalDigits: 3,
  unitCount: 2,
};

/**
 * What the Took column shows: the duration, `streaming` while an event stream
 * is open, or nothing.
 *
 * @param entry - A log entry.
 */
export function tookOf(entry: LogEntry): string {
  if (entry.durationMs !== null) {
    return prettyMilliseconds(entry.durationMs, DURATION_FORMAT);
  }
  return entry.type === 'http' && entry.state === 'streaming'
    ? 'streaming'
    : '';
}

/**
 * Time the entry started: the request's arrival or the message's capture.
 *
 * @param entry - A log entry.
 */
export const atOf = (entry: LogEntry): string => anchorOf(entry).at;

/**
 * MCP session the entry belongs to, or `null`.
 *
 * @param entry - A log entry.
 */
export const sessionOf = (entry: LogEntry): string | null =>
  anchorOf(entry).sessionId;

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

const cache = new WeakMap<MCPFact, unknown>();

/**
 * The parsed JSON of a message, or `undefined` when it isn't JSON. Cached.
 *
 * @param fact - An `mcp` fact.
 */
export function parsedMessage(fact: MCPFact): unknown {
  if (!cache.has(fact)) {
    let value: unknown;
    try {
      value = JSON.parse(fact.raw);
    } catch {
      value = undefined;
    }
    cache.set(fact, value);
  }
  return cache.get(fact);
}

/**
 * The message's JSON, pretty-printed, or its raw text when it isn't JSON.
 *
 * @param fact - An `mcp` fact.
 */
export function prettyJSON(fact: MCPFact): string {
  const value = parsedMessage(fact);
  return value === undefined ? fact.raw : JSON.stringify(value, null, 2);
}

/**
 * A body as text: strings as they are, anything else pretty-printed JSON.
 *
 * @param body - A request or response body.
 */
export function prettyBody(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}

/**
 * A short note summarizing an entry: the client of an `initialize` and the
 * protocol it got, the tool of a call, the tool count of a list, the message
 * of an error, the decision of an OAuth consent, the events of a stream.
 *
 * @param entry - A log entry.
 */
export function noteOf(entry: LogEntry): string {
  return entry.type === 'http' ? httpNoteOf(entry) : mcpNoteOf(entry);
}

const mcpNoteOf = (entry: MCPEntry): string => {
  const { message, reply } = entry;
  const parsed = parsedMessage(message);
  if (!isRecord(parsed)) {
    return message.kind === 'invalid' ? 'not JSON-RPC' : '';
  }
  if (message.kind === 'error') {
    return errorText(errorOf(message));
  }
  if (!isPair(entry)) {
    return '';
  }
  if (reply?.type === 'no-reply') {
    return reply.reason === 'session-closed'
      ? 'session closed'
      : 'exchange ended';
  }
  if (reply?.kind === 'error') {
    return errorText(errorOf(reply));
  }
  const params = isRecord(parsed.params) ? parsed.params : {};
  const result = reply === null ? {} : (resultOf(reply) ?? {});

  switch (message.method) {
    case 'initialize': {
      const client = isRecord(params.clientInfo) ? params.clientInfo : {};
      const who = [client.name, client.version]
        .filter((part) => typeof part === 'string')
        .join(' ');
      const protocol =
        typeof result.protocolVersion === 'string'
          ? `protocol ${result.protocolVersion}`
          : '';
      return [who, protocol].filter((part) => part !== '').join(' · ');
    }
    case 'tools/list': {
      if (reply === null) {
        return '';
      }
      const count = Array.isArray(result.tools) ? result.tools.length : 0;
      return `${count} ${count === 1 ? 'tool' : 'tools'}`;
    }
    case 'tools/call':
      return typeof params.name === 'string' ? params.name : '';
    default:
      return '';
  }
};

const httpNoteOf = ({ exchange, end }: HTTPEntry): string => {
  const events =
    end === null
      ? ''
      : `${end.events} ${end.events === 1 ? 'event' : 'events'}`;
  const { response, request } = exchange;
  if (response === null || exchange.endpoint === 'mcp') {
    return events;
  }
  const path = pathOf(request.url);
  const body = response.body;

  if (path.startsWith('/consent/')) {
    const location =
      new Map(Object.entries(response.headers)).get('location') ?? '';
    if (location.includes('error=access_denied')) {
      return 'denied';
    }
    return location.includes('code=') ? 'approved' : '';
  }
  if (path === '/authorize' && response.status === 200) {
    return 'consent page';
  }
  if (
    path === '/register' &&
    isRecord(body) &&
    typeof body.client_name === 'string'
  ) {
    return `client "${body.client_name}"`;
  }
  if (isRecord(body) && typeof body.error === 'string') {
    return body.error;
  }
  return '';
};

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const errorOf = (fact: MCPFact): Record<string, unknown> | undefined => {
  const parsed = parsedMessage(fact);
  return isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
};

const resultOf = (fact: MCPFact): Record<string, unknown> | undefined => {
  const parsed = parsedMessage(fact);
  return isRecord(parsed) && isRecord(parsed.result)
    ? parsed.result
    : undefined;
};

const errorText = (error: Record<string, unknown> | undefined): string =>
  [
    typeof error?.code === 'number' ? error.code : '',
    typeof error?.message === 'string' ? error.message : '',
  ]
    .join(' ')
    .trim();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * URL of the Logs tab with `id` selected.
 *
 * @param server - Server name.
 * @param id - Anchor id of the entry to show; omit for the bare list.
 * @param tab - Detail tab to open, as the URL fragment; omit to keep the
 * current one.
 */
export const logsPath = (server: string, id?: number, tab?: string): string => {
  const base = `/servers/${encodeURIComponent(server)}/logs`;
  if (id === undefined) {
    return base;
  }
  return tab === undefined ? `${base}/${id}` : `${base}/${id}#${tab}`;
};
