import { type LogEntry } from '@/shared/api';

import { type LogEvent, type LogStore, matches } from './log-store';

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
  /** Entries matching `text`, across all pages. */
  total: number;
};

/** Parameters of `LogsService.subscribe`. */
export type LogSubscribeParams = {
  /** Only follow entries matching this case-insensitive substring over method and raw JSON. */
  text?: string;
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
  /** A page of entries, newest first, with the total of matching entries. */
  page(server: string, params: LogPageParams): LogPageResult;
  /** Every entry with an id greater than `afterId` matching `text`, oldest first. */
  after(server: string, afterId: number, text?: string): LogEntry[];
  /** Every entry, oldest first. */
  all(server: string): LogEntry[];
  /** Drops every entry of the server. */
  clear(server: string): void;
  /**
   * Follows new entries, evictions and clears. Entries and evictions are
   * forwarded only when they match `text`; clears always are. Returns a
   * function that unsubscribes.
   */
  subscribe(
    server: string,
    params: LogSubscribeParams,
    listener: (event: LogEvent) => void,
  ): () => void;
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
      return {
        items: items.slice(0, limit),
        more: items.length > limit,
        total: store.count({ server, text }),
      };
    },
    after(server, afterId, text) {
      assertServerExists(server);
      return store
        .query({ server, text, afterId, limit: Number.POSITIVE_INFINITY })
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
    subscribe(server, { text }, listener) {
      assertServerExists(server);
      return store.subscribe(server, (event) => {
        if (event.type === 'cleared' || matches(event.entry, text)) {
          listener(event);
        }
      });
    },
  };
}
