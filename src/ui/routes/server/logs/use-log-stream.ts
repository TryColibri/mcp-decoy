import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import useSWRInfinite from 'swr/infinite';

import {
  LOG_STREAM_EVENTS,
  type LogEntry,
  logEntrySchema,
  logEvictedSchema,
  type LogPage,
} from '@/shared/api';
import { type ApiError, client, keys, unwrap } from '@/ui/api';

/** How many entries each page loads. */
export const PAGE_SIZE = 200;

/**
 * Most live entries kept in the browser. Past it, the hook starts over from a
 * fresh first page. Older pages can't outgrow the server's buffer.
 */
export const MAX_ENTRIES = 10_000;

/** State of the live connection. */
export type StreamConnection =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'closed';

/** What `useLogStream` returns. */
export type LogStream = {
  /** Entries shown, newest first. New entries are held back while paused. */
  entries: LogEntry[];
  /** Entries matching the query on the server, loaded or not. */
  total: number;
  /** Whether older entries are still to be loaded. */
  hasOlder: boolean;
  /** Whether an older page is loading. */
  loadingOlder: boolean;
  /** Whether the first page is still loading. */
  loading: boolean;
  /** Why the first page failed to load. */
  error: ApiError | undefined;
  /** State of the live connection. */
  connection: StreamConnection;
  /** Whether new entries are being held back. */
  paused: boolean;
  /** Entries received while paused. */
  pending: number;
  /** Loads the next page of older entries. */
  loadOlder: () => void;
  /** Forgets every loaded entry and loads afresh, as after the server's log was cleared. */
  reset: () => void;
  /** Holds new entries back. */
  pause: () => void;
  /** Shows held-back entries and resumes streaming. */
  resume: () => void;
};

/**
 * Prepends entries to a list, skipping any that aren't newer than its first
 * entry (a reconnect may replay some).
 *
 * @param items - Current entries, newest first.
 * @param incoming - New entries, oldest first.
 */
export function prependEntries(
  items: LogEntry[],
  incoming: LogEntry[],
): LogEntry[] {
  let lastId = items[0]?.id ?? 0;
  const fresh: LogEntry[] = [];
  for (const entry of incoming) {
    if (entry.id > lastId) {
      fresh.push(entry);
      lastId = entry.id;
    }
  }
  return fresh.length === 0 ? items : [...fresh.reverse(), ...items];
}

/** A page as loaded, tagged with the load it belongs to. */
type LoadedPage = LogPage & {
  /** The load (query and restart) the page was fetched for. */
  load: string;
};

type PageKey = readonly [
  name: string,
  query: string,
  load: string,
  cursor: string | undefined,
];

type StreamEvent =
  | { type: 'entry'; entry: LogEntry }
  | { type: 'evicted'; id: number };

/** Entries that arrived over the stream, for one load. */
type LiveState = {
  load: string;
  /** Newest first. */
  entries: LogEntry[];
  /** Ids the server dropped to make room. */
  evicted: ReadonlySet<number>;
};

type LiveAction = { type: 'apply'; load: string; events: StreamEvent[] };

const emptyLive = (load: string): LiveState => ({
  load,
  entries: [],
  evicted: new Set(),
});

const noLive = emptyLive('');

const noPages: LoadedPage[] = [];

const reduceLive = (state: LiveState, action: LiveAction): LiveState => {
  const base = state.load === action.load ? state : emptyLive(action.load);
  const incoming: LogEntry[] = [];
  const evicted = new Set(base.evicted);
  for (const event of action.events) {
    if (event.type === 'entry') {
      incoming.push(event.entry);
    } else {
      evicted.add(event.id);
    }
  }
  return {
    load: action.load,
    entries: prependEntries(base.entries, incoming),
    evicted: evicted.size === base.evicted.size ? base.evicted : evicted,
  };
};

/** Where the current load is at: the query it is for and how often it restarted. */
type Epoch = {
  query: string;
  restarts: number;
};

/**
 * Loads a server's log newest first, a page at a time, and follows the live
 * stream. Both honor `query`, so paging, streaming and `total` all describe the
 * same filtered log.
 *
 * Pages come from SWR (`GET …/logs?q=&cursor=&limit=200`). The stream starts
 * after the highest id of the first page, so nothing is missed or duplicated;
 * its entries are held apart and shown above the pages. `EventSource`
 * reconnects by itself with `Last-Event-ID`.
 *
 * @param server - Server name.
 * @param query - Case-insensitive substring over method and raw JSON; empty for none.
 */
export function useLogStream(server: string, query: string): LogStream {
  const id = useId();
  const [epoch, setEpoch] = useState<Epoch>({ query, restarts: 0 });
  if (epoch.query !== query) {
    setEpoch({ query, restarts: epoch.restarts + 1 });
  }
  // Unique to this mount and restart, so SWR never serves a stale first page.
  const load = `${id}:${epoch.restarts}`;

  const getKey = useCallback(
    (_index: number, previous: LoadedPage | null): PageKey | null =>
      previous?.nextCursor === null
        ? null
        : [keys.logs(server), query, load, previous?.nextCursor],
    [server, query, load],
  );
  const fetchPage = useCallback(
    async ([, q, pageLoad, cursor]: PageKey): Promise<LoadedPage> => {
      const page = await unwrap(
        client.servers[':server'].logs.$get({
          param: { server },
          query: {
            limit: String(PAGE_SIZE),
            ...(q === '' ? {} : { q }),
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      );
      return { ...page, load: pageLoad };
    },
    [server],
  );
  const {
    data: loadedPages,
    error,
    isLoading,
    size,
    setSize,
  } = useSWRInfinite<LoadedPage, ApiError>(getKey, fetchPage, {
    // The stream keeps the list current; refetching could drop entries that
    // arrived meanwhile.
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    // Keep showing the old list while a new filter loads.
    keepPreviousData: true,
  });

  // The pages on screen can lag behind `load` while a new one loads. After a
  // clear they show nothing meanwhile, instead of what was cleared.
  const [clearedLoad, setClearedLoad] = useState<string>();
  const shownLoad = loadedPages?.[0]?.load;
  const blank = shownLoad !== undefined && shownLoad === clearedLoad;
  const pages = blank ? noPages : loadedPages;
  const firstPage = pages?.[0];
  const ready = shownLoad === load;
  const after = firstPage?.items[0]?.id ?? 0;

  const [liveState, dispatch] = useReducer(reduceLive, emptyLive(load));
  const live = liveState.load === shownLoad && !blank ? liveState : noLive;

  // The browser holds only so many live entries: start over from a fresh page.
  if (ready && live.entries.length > MAX_ENTRIES) {
    setEpoch({ query, restarts: epoch.restarts + 1 });
  }

  // Both belong to one load: a newer load starts over without an effect.
  const [connectionState, setConnectionState] = useState<{
    load: string;
    status: StreamConnection;
  }>({ load, status: 'connecting' });
  const [pendingState, setPendingState] = useState({ load, count: 0 });
  const connection =
    connectionState.load === load ? connectionState.status : 'connecting';
  const pending = pendingState.load === load ? pendingState.count : 0;
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const bufferRef = useRef<StreamEvent[]>([]);

  const reset = useCallback(() => {
    bufferRef.current = [];
    setPendingState({ load, count: 0 });
    setClearedLoad(load);
    setEpoch((current) => ({ ...current, restarts: current.restarts + 1 }));
  }, [load]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const params = new URLSearchParams({ after: String(after) });
    if (query !== '') {
      params.set('q', query);
    }
    const source = new EventSource(
      `/api/v1/servers/${encodeURIComponent(server)}/logs/stream?${params}`,
    );
    bufferRef.current = [];

    const receive = (event: StreamEvent) => {
      if (pausedRef.current) {
        bufferRef.current.push(event);
        if (event.type === 'entry') {
          setPendingState((current) => ({
            load,
            count: (current.load === load ? current.count : 0) + 1,
          }));
        }
      } else {
        dispatch({ type: 'apply', load, events: [event] });
      }
    };

    source.addEventListener('open', () => {
      setConnectionState({ load, status: 'live' });
    });
    source.addEventListener('error', () => {
      setConnectionState({
        load,
        status:
          source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
      });
    });
    source.addEventListener(LOG_STREAM_EVENTS.entry, (event) => {
      const parsed = logEntrySchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) {
        receive({ type: 'entry', entry: parsed.data });
      }
    });
    source.addEventListener(LOG_STREAM_EVENTS.evicted, (event) => {
      const parsed = logEvictedSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) {
        receive({ type: 'evicted', id: parsed.data.id });
      }
    });
    source.addEventListener(LOG_STREAM_EVENTS.cleared, () => {
      reset();
    });

    return () => {
      source.close();
    };
  }, [after, load, query, ready, reset, server]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const buffered = bufferRef.current;
    bufferRef.current = [];
    setPendingState({ load, count: 0 });
    if (buffered.length > 0) {
      dispatch({ type: 'apply', load, events: buffered });
    }
  }, [load]);

  const hasOlder = typeof pages?.at(-1)?.nextCursor === 'string';
  const loadingOlder = !blank && pages !== undefined && size > pages.length;

  const loadOlder = useCallback(() => {
    if (hasOlder && !loadingOlder) {
      void setSize((current) => current + 1);
    }
  }, [hasOlder, loadingOlder, setSize]);

  const entries = useMemo(() => {
    const seen = new Set<number>();
    const merged: LogEntry[] = [];
    const candidates = [
      ...live.entries,
      ...(pages ?? []).flatMap((page) => page.items),
    ];
    for (const entry of candidates) {
      if (!seen.has(entry.id) && !live.evicted.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }
    return merged;
  }, [live, pages]);

  const total = Math.max(
    0,
    (firstPage?.total ?? 0) + live.entries.length - live.evicted.size,
  );

  return {
    entries,
    total,
    hasOlder,
    loadingOlder,
    loading: loadedPages === undefined && isLoading,
    error: loadedPages === undefined ? error : undefined,
    connection,
    paused,
    pending,
    loadOlder,
    reset,
    pause,
    resume,
  };
}
