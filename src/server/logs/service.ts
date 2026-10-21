import { type LogEntry } from '@/shared/api';

import { type LogEvent, type LogStore } from './log-store';

/** Parameters of `LogsService.page`. */
export type LogPageParams = {
  /** Case-insensitive substring over method and raw JSON. */
  text?: string;
  /** Only entries older than this id. */
  beforeId?: number;
  /** Page size. */
  limit: number;
};

/** One page of log entries. */
export type LogPageResult = {
  /** Entries, newest first. */
  items: LogEntry[];
  /** Whether older matching entries exist. */
  more: boolean;
};

/** Dependencies of the logs service. */
export type LogsServiceDeps = {
  /** Where entries are stored. */
  store: LogStore;
  /** Throws `NotFoundError` when the server doesn't exist. */
  assertServerExists: (server: string) => void;
};

/** Reading and clearing a server's captured messages. */
export type LogsService = {
  /** A page of entries, newest first. */
  page(server: string, params: LogPageParams): LogPageResult;
  /** Every entry with an id greater than `afterId`, oldest first. */
  after(server: string, afterId: number): LogEntry[];
  /** Every entry, oldest first. */
  all(server: string): LogEntry[];
  /** Drops every entry of the server. */
  clear(server: string): void;
  /** Follows new entries and clears. Returns a function that unsubscribes. */
  subscribe(server: string, listener: (event: LogEvent) => void): () => void;
};

/**
 * Creates the logs service.
 *
 * @param deps - Store and server lookup.
 */
export function createLogsService({
  store,
  assertServerExists,
}: LogsServiceDeps): LogsService {
  return {
    page(server, { text, beforeId, limit }) {
      assertServerExists(server);
      const items = store.query({ server, text, beforeId, limit: limit + 1 });
      return { items: items.slice(0, limit), more: items.length > limit };
    },
    after(server, afterId) {
      assertServerExists(server);
      return store
        .query({ server, afterId, limit: Number.POSITIVE_INFINITY })
        .reverse();
    },
    all(server) {
      assertServerExists(server);
      return store.query({ server, limit: Number.POSITIVE_INFINITY }).reverse();
    },
    clear(server) {
      assertServerExists(server);
      store.clear(server);
    },
    subscribe(server, listener) {
      assertServerExists(server);
      return store.subscribe(server, listener);
    },
  };
}
