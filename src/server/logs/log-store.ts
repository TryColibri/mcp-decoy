import { type LogFact } from '@/shared/api';
import { anchorIdOf } from '@/shared/logs';

/** A fact before the store assigns its `id`. */
export type NewLogFact = LogFact extends infer Fact
  ? Fact extends LogFact
    ? Omit<Fact, 'id'>
    : never
  : never;

/** Filters for `LogStore.anchors` and `LogStore.countAnchors`. */
export type LogAnchorFilter = {
  /** Only anchors of this server. */
  server: string;
  /** Case-insensitive search; an entry matches when any of its facts does. */
  text?: string;
  /** Only entries with a fact carried by this `http` fact id. */
  carriedBy?: number;
};

/** Filters for `LogStore.anchors`. */
export type LogAnchorQuery = LogAnchorFilter & {
  /** Only anchors with a smaller id. */
  beforeId?: number;
  /** Maximum number of anchors returned. */
  limit: number;
};

/** What a `LogStore` subscriber receives. */
export type LogEvent =
  | {
      /** A fact was appended. */
      type: 'fact';
      /** The appended fact. */
      fact: LogFact;
    }
  | {
      /** The oldest fact was dropped to make room for a new one. */
      type: 'evicted';
      /** The dropped fact. */
      fact: LogFact;
      /** The attachment the dropped fact had, read before it was unlinked. */
      attachment: LogFact | undefined;
    }
  | {
      /** The server's log was cleared. */
      type: 'cleared';
    };

/**
 * Storage for log facts. Facts are immutable and append-only. An anchor (an
 * `http` fact, or an `mcp` fact without `replyTo`) is one list row; it has at
 * most one attachment, which is always newer, so eviction drops the anchor
 * first.
 */
export type LogStore = {
  /** Stores a fact, assigning the next id. Returns the stored fact. */
  append(fact: NewLogFact): LogFact;
  /** The highest id assigned so far, across all servers; `0` before the first fact. */
  lastId(): number;
  /** A fact by id, or `undefined` when it isn't stored. */
  get(id: number): LogFact | undefined;
  /** The attachment of an anchor, or `undefined` when it has none. */
  attachmentOf(anchorId: number): LogFact | undefined;
  /** Anchors matching `query`, newest first. */
  anchors(query: LogAnchorQuery): LogFact[];
  /** Number of anchors matching `filter`. */
  countAnchors(filter: LogAnchorFilter): number;
  /** Every fact of `server` with an id greater than `afterId`, of any type, oldest first. */
  factsAfter(server: string, afterId: number): LogFact[];
  /** Drops every fact of `server`. */
  clear(server: string): void;
  /** Reassigns every fact of `from` to `to`, keeping ids and order. */
  rename(from: string, to: string): void;
  /** Calls `listener` for new, evicted and cleared facts of `server`. Returns a function that unsubscribes. */
  subscribe(server: string, listener: (event: LogEvent) => void): () => void;
};

type LogRecord = {
  fact: LogFact;
  // Lower-cased text a search looks through, built once.
  search: string;
};

/**
 * Creates an in-memory ring buffer `LogStore`. The cap is global across
 * servers: once full, the oldest fact is evicted.
 *
 * @param limit - Maximum number of facts kept, across all servers.
 */
export function createRingBufferLogStore(limit: number): LogStore {
  let buffer: Array<LogRecord | undefined> = [];
  // Index of the oldest fact and number of facts held.
  let start = 0;
  let size = 0;
  let nextId = 1;
  const byId = new Map<number, LogRecord>();
  // Anchor id → id of its attachment.
  let attachments = new Map<number, number>();
  const listeners = new Map<string, Set<(event: LogEvent) => void>>();

  const notify = (server: string, event: LogEvent) => {
    for (const listener of listeners.get(server) ?? []) {
      listener(event);
    }
  };

  const recordAt = (index: number) => buffer[(start + index) % limit];

  const attachmentRecord = (anchorId: number): LogRecord | undefined => {
    const attachmentId = attachments.get(anchorId);
    return attachmentId === undefined ? undefined : byId.get(attachmentId);
  };

  const matchesFilter = (
    record: LogRecord,
    { server, carriedBy }: LogAnchorFilter,
    needle: string,
  ): boolean => {
    if (record.fact.server !== server || anchorIdOf(record.fact) !== null) {
      return false;
    }
    const attachment = attachmentRecord(record.fact.id);
    if (needle !== '') {
      const found =
        record.search.includes(needle) ||
        (attachment?.search.includes(needle) ?? false);
      if (!found) {
        return false;
      }
    }
    return (
      carriedBy === undefined ||
      carriedByOf(record.fact) === carriedBy ||
      (attachment !== undefined && carriedByOf(attachment.fact) === carriedBy)
    );
  };

  // Drops the oldest fact from the indexes and returns it with its attachment.
  const unlink = (record: LogRecord) => {
    const { fact } = record;
    const attachment = attachmentRecord(fact.id)?.fact;
    byId.delete(fact.id);
    attachments.delete(fact.id);
    const anchorId = anchorIdOf(fact);
    if (anchorId !== null && attachments.get(anchorId) === fact.id) {
      attachments.delete(anchorId);
    }
    return attachment;
  };

  return {
    append(fields) {
      const fact: LogFact = { ...fields, id: nextId++ };
      const record: LogRecord = { fact, search: searchTextOf(fact) };
      let evicted: LogRecord | undefined;
      if (size < limit) {
        buffer[(start + size) % limit] = record;
        size++;
      } else {
        evicted = buffer[start];
        buffer[start] = record;
        start = (start + 1) % limit;
      }
      const evictedAttachment =
        evicted === undefined ? undefined : unlink(evicted);
      byId.set(fact.id, record);
      const anchorId = anchorIdOf(fact);
      if (anchorId !== null && !attachments.has(anchorId)) {
        attachments.set(anchorId, fact.id);
      }
      if (evicted !== undefined) {
        notify(evicted.fact.server, {
          type: 'evicted',
          fact: evicted.fact,
          attachment: evictedAttachment,
        });
      }
      notify(fact.server, { type: 'fact', fact });
      return fact;
    },

    lastId: () => nextId - 1,

    get: (id) => byId.get(id)?.fact,

    attachmentOf: (anchorId) => attachmentRecord(anchorId)?.fact,

    anchors({ limit: max, beforeId, ...filter }) {
      const needle = filter.text?.toLowerCase() ?? '';
      const results: LogFact[] = [];
      for (let index = size - 1; index >= 0 && results.length < max; index--) {
        const record = recordAt(index);
        if (record === undefined) {
          continue;
        }
        if (beforeId !== undefined && record.fact.id >= beforeId) {
          continue;
        }
        if (matchesFilter(record, filter, needle)) {
          results.push(record.fact);
        }
      }
      return results;
    },

    countAnchors(filter) {
      const needle = filter.text?.toLowerCase() ?? '';
      let total = 0;
      for (let index = 0; index < size; index++) {
        const record = recordAt(index);
        if (record !== undefined && matchesFilter(record, filter, needle)) {
          total++;
        }
      }
      return total;
    },

    factsAfter(server, afterId) {
      const facts: LogFact[] = [];
      for (let index = size - 1; index >= 0; index--) {
        const record = recordAt(index);
        if (record === undefined) {
          continue;
        }
        if (record.fact.id <= afterId) {
          break;
        }
        if (record.fact.server === server) {
          facts.push(record.fact);
        }
      }
      return facts.reverse();
    },

    clear(server) {
      const kept: LogRecord[] = [];
      for (let index = 0; index < size; index++) {
        const record = recordAt(index);
        if (record === undefined) {
          continue;
        }
        if (record.fact.server === server) {
          byId.delete(record.fact.id);
        } else {
          kept.push(record);
        }
      }
      attachments = new Map(
        [...attachments].filter(
          ([anchorId, attachmentId]) =>
            byId.has(anchorId) && byId.has(attachmentId),
        ),
      );
      buffer = kept;
      start = 0;
      size = kept.length;
      notify(server, { type: 'cleared' });
    },

    rename(from, to) {
      for (let index = 0; index < size; index++) {
        const record = recordAt(index);
        if (record?.fact.server === from) {
          record.fact = { ...record.fact, server: to };
          record.search = searchTextOf(record.fact);
        }
      }
    },

    subscribe(server, listener) {
      const set = listeners.get(server) ?? new Set();
      listeners.set(server, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(server);
        }
      };
    },
  };
}

const carriedByOf = (fact: LogFact): number | null =>
  fact.type === 'mcp' ? fact.carriedBy : null;

// Strings whose JSON text differs from the string itself, so a search for
// what a body says (quotes and all) matches, not only for how JSON escapes it.
const unescapedStrings = (value: unknown, found: string[] = []): string[] => {
  if (typeof value === 'string') {
    if (JSON.stringify(value).slice(1, -1) !== value) {
      found.push(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      unescapedStrings(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      unescapedStrings(item, found);
    }
  }
  return found;
};

const bodyText = (body: unknown): string => {
  if (body === undefined) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  return [JSON.stringify(body), ...unescapedStrings(body)].join('\n');
};

const headersText = (headers: Record<string, string>): string =>
  Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');

// What a search looks through, lower-cased: `mcp` facts by method and raw
// JSON; `http` facts by method, URL, headers and bodies; attachments by
// nothing, since their anchor already holds what they say.
const searchTextOf = (fact: LogFact): string => {
  switch (fact.type) {
    case 'mcp':
      return `${fact.method ?? ''}\n${fact.raw}`.toLowerCase();
    case 'http':
      return [
        fact.request.method,
        fact.request.url,
        headersText(fact.request.headers),
        bodyText(fact.request.body),
        fact.response === null ? '' : headersText(fact.response.headers),
        fact.response === null ? '' : bodyText(fact.response.body),
      ]
        .join('\n')
        .toLowerCase();
    case 'http-end':
    case 'no-reply':
      return '';
  }
};

/**
 * Whether a fact matches a search: case-insensitive substring over what the
 * log shows of it. Empty or missing text matches everything. Attachments
 * match nothing on their own except through an empty search.
 *
 * @param fact - A log fact.
 * @param text - The search text.
 */
export function matches(fact: LogFact, text?: string): boolean {
  const needle = text?.toLowerCase() ?? '';
  return needle === '' || searchTextOf(fact).includes(needle);
}
