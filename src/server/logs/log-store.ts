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

/** What a `LogStore` subscriber receives. */
export type LogEvent =
  | {
      /** A message was captured. */
      type: 'entry';
      /** The captured entry. */
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
  /** Drops every entry of `server`. */
  clear(server: string): void;
  /** Calls `listener` for new entries and clears of `server`. Returns a function that unsubscribes. */
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
      if (size < limit) {
        buffer[(start + size) % limit] = entry;
        size++;
      } else {
        buffer[start] = entry;
        start = (start + 1) % limit;
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
        if (needle !== undefined && needle !== '' && !matches(entry, needle)) {
          continue;
        }
        results.push(entry);
      }
      return results;
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

const matches = (entry: LogEntry, needle: string): boolean =>
  (entry.method?.toLowerCase().includes(needle) ?? false) ||
  entry.raw.toLowerCase().includes(needle);
