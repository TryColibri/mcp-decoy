import { type LogEntry } from '@/shared/api';

/** Filters for `LogStore.query`. */
export type LogQuery = {
  /** Only entries of this server. */
  server: string;
  /** Case-insensitive substring over `method` and `raw`. */
  text?: string;
  /** Only entries with a greater id. */
  afterId?: number;
  /** Only entries with a smaller id. */
  beforeId?: number;
  /** Maximum number of entries returned. */
  limit: number;
};

/** Filters for `LogStore.count`. */
export type LogCountQuery = {
  /** Only entries of this server. */
  server: string;
  /** Case-insensitive substring over `method` and `raw`. */
  text?: string;
};

/** What a `LogStore` subscriber receives. */
export type LogEvent =
  | {
      /** A message was captured. */
      type: 'entry';
      /** The captured entry. */
      entry: LogEntry;
    }
  | {
      /** The oldest entry was dropped to make room for a new one. */
      type: 'evicted';
      /** The dropped entry. */
      entry: LogEntry;
    }
  | {
      /** The server's log was cleared. */
      type: 'cleared';
    };

/** Storage for captured JSON-RPC messages. */
export type LogStore = {
  /** Stores a message, assigning the next id. Returns the stored entry. */
  append(entry: Omit<LogEntry, 'id'>): LogEntry;
  /** Matching entries, newest first. */
  query(query: LogQuery): LogEntry[];
  /** Number of entries matching `query`. */
  count(query: LogCountQuery): number;
  /** Drops every entry of `server`. */
  clear(server: string): void;
  /** Reassigns every entry of `from` to `to`, keeping ids and order. */
  rename(from: string, to: string): void;
  /** Calls `listener` for new, evicted and cleared entries of `server`. Returns a function that unsubscribes. */
  subscribe(server: string, listener: (event: LogEvent) => void): () => void;
};

/**
 * Creates an in-memory ring buffer `LogStore`. The cap is global across
 * servers: once full, the oldest entry is evicted.
 *
 * @param limit - Maximum number of entries kept, across all servers.
 */
export function createRingBufferLogStore(limit: number): LogStore {
  let buffer: Array<LogEntry | undefined> = [];
  // Index of the oldest entry and number of entries held.
  let start = 0;
  let size = 0;
  let nextId = 1;
  const listeners = new Map<string, Set<(event: LogEvent) => void>>();

  const notify = (server: string, event: LogEvent) => {
    for (const listener of listeners.get(server) ?? []) {
      listener(event);
    }
  };

  const at = (index: number) => buffer[(start + index) % limit];

  return {
    append(fields) {
      const entry: LogEntry = { id: nextId++, ...fields };
      let evicted: LogEntry | undefined;
      if (size < limit) {
        buffer[(start + size) % limit] = entry;
        size++;
      } else {
        evicted = buffer[start];
        buffer[start] = entry;
        start = (start + 1) % limit;
      }
      if (evicted !== undefined) {
        notify(evicted.server, { type: 'evicted', entry: evicted });
      }
      notify(entry.server, { type: 'entry', entry });
      return entry;
    },

    query({ server, text, afterId, beforeId, limit: max }) {
      const needle = text?.toLowerCase();
      const results: LogEntry[] = [];
      for (let index = size - 1; index >= 0 && results.length < max; index--) {
        const entry = at(index);
        if (entry === undefined || entry.server !== server) {
          continue;
        }
        if (afterId !== undefined && entry.id <= afterId) {
          break;
        }
        if (beforeId !== undefined && entry.id >= beforeId) {
          continue;
        }
        if (needle !== undefined && !matchesNeedle(entry, needle)) {
          continue;
        }
        results.push(entry);
      }
      return results;
    },

    count({ server, text }) {
      const needle = text?.toLowerCase();
      let total = 0;
      for (let index = 0; index < size; index++) {
        const entry = at(index);
        if (
          entry !== undefined &&
          entry.server === server &&
          (needle === undefined || matchesNeedle(entry, needle))
        ) {
          total++;
        }
      }
      return total;
    },

    clear(server) {
      const kept: LogEntry[] = [];
      for (let index = 0; index < size; index++) {
        const entry = at(index);
        if (entry !== undefined && entry.server !== server) {
          kept.push(entry);
        }
      }
      buffer = kept;
      start = 0;
      size = kept.length;
      notify(server, { type: 'cleared' });
    },

    rename(from, to) {
      for (let index = 0; index < size; index++) {
        const entry = at(index);
        if (entry?.server === from) {
          buffer[(start + index) % limit] = { ...entry, server: to };
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

// `needle` is lowercase; an empty one matches everything.
const matchesNeedle = (entry: LogEntry, needle: string): boolean =>
  needle === '' ||
  (entry.method?.toLowerCase().includes(needle) ?? false) ||
  entry.raw.toLowerCase().includes(needle);

/**
 * Whether an entry matches a search: case-insensitive substring over `method`
 * and `raw`. Empty or missing text matches everything.
 *
 * @param entry - A log entry.
 * @param text - The search text.
 */
export function matches(entry: LogEntry, text?: string): boolean {
  return matchesNeedle(entry, text?.toLowerCase() ?? '');
}
