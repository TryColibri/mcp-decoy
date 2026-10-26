import { NotFoundError } from '@/server/errors';
import { type LogEntry, type LogFact } from '@/shared/api';
import { anchorIdOf, reconcile } from '@/shared/logs';

import { type LogEvent, type LogStore, matches } from './log-store';

/** Parameters of `LogsService.page`. */
export type LogPageParams = {
  /** Case-insensitive substring over method, URL, headers, bodies and raw JSON. */
  text?: string;
  /** Only entries with a fact carried by this `http` fact id. */
  carriedBy?: number;
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
  /** Entries matching the query, across all pages. */
  total: number;
  /** Highest fact id assigned when the page was read, across all servers. */
  after: number;
};

/** Parameters of `LogsService.stream`. */
export type LogStreamParams = {
  /** Only follow entries matching this case-insensitive substring. */
  text?: string;
  /** Replay facts with an id greater than this one first. */
  afterId: number;
};

/** What `LogsService.stream` delivers. */
export type LogStreamEvent =
  | {
      /** A fact to show. */
      type: 'fact';
      /** The fact. */
      fact: LogFact;
      /**
       * An anchor sent after the fact that made it match. It has no SSE
       * `id`, so a reconnect resumes before its attachment.
       */
      late: boolean;
    }
  | {
      /** An anchor matching the search was dropped to make room. */
      type: 'evicted';
      /** Id of the anchor. */
      id: number;
    }
  | {
      /** The server's log was cleared. */
      type: 'cleared';
    };

/** A fact `streamItemsFor` says to send. */
export type LogStreamItem = {
  /** The fact. */
  fact: LogFact;
  /** Whether it is an anchor sent after the fact that made it match. */
  late: boolean;
};

/** Dependencies of the logs service. */
export type LogsServiceDeps = {
  /** Where facts are stored. */
  store: LogStore;
  /** Throws `NotFoundError` when the server doesn't exist. */
  assertServerExists: (server: string) => void;
};

/** Reading and clearing a server's log. */
export type LogsService = {
  /** A page of entries, newest first, with the total of matching entries. */
  page(server: string, params: LogPageParams): LogPageResult;
  /** Every entry, oldest first. */
  all(server: string): LogEntry[];
  /**
   * One entry, by the id of its anchor.
   * @throws {NotFoundError} When the server or the entry doesn't exist, or the id is an attachment's.
   */
  get(server: string, id: number): LogEntry;
  /** Drops every fact of the server. */
  clear(server: string): void;
  /**
   * Replays the facts after `afterId`, then follows new ones, evictions and
   * clears. Subscribes and reads the backlog in one tick, so nothing is
   * missed or sent twice. Returns a function that unsubscribes.
   */
  stream(
    server: string,
    params: LogStreamParams,
    listener: (event: LogStreamEvent) => void,
  ): () => void;
};

/**
 * What a stream sends for a fact. An anchor goes out if it matches `text`. An
 * attachment goes out if its anchor matched on its own (the stream already
 * has it) or if it makes the entry match, in which case the anchor goes out
 * first, marked late. Without `text`, everything whose anchor exists goes out.
 *
 * @param fact - The fact appended or replayed.
 * @param anchor - For an attachment, its anchor, or `undefined` when gone.
 * @param text - The stream's search.
 */
export function streamItemsFor(
  fact: LogFact,
  anchor: LogFact | undefined,
  text?: string,
): LogStreamItem[] {
  if (anchorIdOf(fact) === null) {
    return matches(fact, text) ? [{ fact, late: false }] : [];
  }
  if (anchor === undefined) {
    return [];
  }
  if (matches(anchor, text)) {
    return [{ fact, late: false }];
  }
  if (matches(fact, text)) {
    return [
      { fact: anchor, late: true },
      { fact, late: false },
    ];
  }
  return [];
}

/**
 * Creates the logs service.
 *
 * @param deps - Store and server lookup.
 */
export function createLogsService({
  store,
  assertServerExists,
}: LogsServiceDeps): LogsService {
  const entryOf = (anchor: LogFact): LogEntry => {
    const attachment = store.attachmentOf(anchor.id);
    return reconcile(anchor, attachment === undefined ? [] : [attachment]);
  };

  return {
    page(server, { text, carriedBy, beforeId, limit }) {
      assertServerExists(server);
      const anchors = store.anchors({
        server,
        text,
        carriedBy,
        beforeId,
        limit: limit + 1,
      });
      return {
        items: anchors.slice(0, limit).map(entryOf),
        more: anchors.length > limit,
        total: store.countAnchors({ server, text, carriedBy }),
        after: store.lastId(),
      };
    },

    all(server) {
      assertServerExists(server);
      return store
        .anchors({ server, limit: Number.POSITIVE_INFINITY })
        .reverse()
        .map(entryOf);
    },

    get(server, id) {
      assertServerExists(server);
      const fact = store.get(id);
      if (
        fact === undefined ||
        fact.server !== server ||
        anchorIdOf(fact) !== null
      ) {
        throw new NotFoundError(`No log entry ${id} on server "${server}"`);
      }
      return entryOf(fact);
    },

    clear(server) {
      assertServerExists(server);
      store.clear(server);
    },

    stream(server, { text, afterId }, listener) {
      assertServerExists(server);

      const forwardFact = (fact: LogFact) => {
        const anchorId = anchorIdOf(fact);
        const anchor = anchorId === null ? undefined : store.get(anchorId);
        for (const item of streamItemsFor(fact, anchor, text)) {
          listener({ type: 'fact', ...item });
        }
      };

      const forward = (event: LogEvent) => {
        if (event.type === 'fact') {
          forwardFact(event.fact);
        } else if (event.type === 'evicted') {
          // An evicted attachment needs no event: its anchor went first.
          const entryMatches =
            matches(event.fact, text) ||
            (event.attachment !== undefined && matches(event.attachment, text));
          if (anchorIdOf(event.fact) === null && entryMatches) {
            listener({ type: 'evicted', id: event.fact.id });
          }
        } else {
          listener({ type: 'cleared' });
        }
      };

      const unsubscribe = store.subscribe(server, forward);
      for (const fact of store.factsAfter(server, afterId)) {
        forwardFact(fact);
      }
      return unsubscribe;
    },
  };
}
