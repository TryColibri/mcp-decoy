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
  type LogFact,
  logEvictedSchema,
  logFactSchema,
  type LogPage,
} from '@/shared/api';
import { anchorIdOf, factsOf, reconcile } from '@/shared/logs';
import { type ApiError, client, keys, unwrap } from '@/ui/api';

/** How many entries each page loads. */
export const PAGE_SIZE = 200;

/**
 * Most live anchors kept in the browser. Past it, the hook starts over from a
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
  /** Entries received while paused that are newer than the newest shown. */
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

/** What the stream has built on top of the loaded pages, for one load. */
export type LiveState = {
  /** The load (query and restart) the state belongs to. */
  load: string;
  /** Entries the stream created or updated, by anchor id. They win over page copies. */
  entries: ReadonlyMap<number, LogEntry>;
  /** Anchors that raised `total`, so a reconnect replay doesn't count one twice. */
  counted: ReadonlySet<number>;
  /** Anchors the server dropped to make room. */
  evicted: ReadonlySet<number>;
  /** Facts that had nowhere to go yet: their anchor isn't loaded. Oldest first. */
  dropped: readonly LogFact[];
};

/** What `fold` needs to know about the loaded pages. */
export type FoldView = {
  /** Entries of the loaded pages, by anchor id. */
  pageEntries: ReadonlyMap<number, LogEntry>;
  /** Id of the oldest entry shown, or `null` when none is. */
  oldestLoadedId: number | null;
  /** Whether older entries are still to be loaded. */
  hasOlder: boolean;
};

/**
 * An empty `LiveState`.
 *
 * @param load - The load it belongs to.
 */
export const emptyLive = (load: string): LiveState => ({
  load,
  entries: new Map(),
  counted: new Set(),
  evicted: new Set(),
  dropped: [],
});

const loadedEntry = (
  state: LiveState,
  view: FoldView,
  anchorId: number,
): LogEntry | undefined =>
  state.evicted.has(anchorId)
    ? undefined
    : (state.entries.get(anchorId) ?? view.pageEntries.get(anchorId));

const drop = (state: LiveState, fact: LogFact): LiveState => ({
  ...state,
  dropped: [...state.dropped, fact].slice(-MAX_ENTRIES),
});

/**
 * Folds one fact of the stream into the live state. Pure and idempotent: a
 * fact folded twice changes nothing the second time.
 *
 * - An anchor always counts toward `total` once. It is inserted unless it is
 *   loaded already, or older than every loaded entry while older pages exist
 *   (a later page returns it, so it is kept in `dropped`).
 * - An attachment patches the entry of its anchor when that is loaded;
 *   otherwise it is kept in `dropped`.
 *
 * @param state - Live state so far.
 * @param fact - A fact from the stream.
 * @param view - What the pages have loaded.
 */
export function fold(
  state: LiveState,
  fact: LogFact,
  view: FoldView,
): LiveState {
  const anchorId = anchorIdOf(fact);

  if (anchorId !== null) {
    const entry = loadedEntry(state, view, anchorId);
    if (entry === undefined) {
      return drop(state, fact);
    }
    if (factsOf(entry).some(({ id }) => id === fact.id)) {
      return state;
    }
    const [anchor] = factsOf(entry);
    return {
      ...state,
      entries: new Map(state.entries).set(
        anchorId,
        reconcile(anchor, [...factsOf(entry), fact]),
      ),
    };
  }

  const counted = state.counted.has(fact.id)
    ? state.counted
    : new Set(state.counted).add(fact.id);
  const counting = counted === state.counted ? state : { ...state, counted };
  if (loadedEntry(counting, view, fact.id) !== undefined) {
    return counting;
  }
  if (
    view.hasOlder &&
    view.oldestLoadedId !== null &&
    fact.id < view.oldestLoadedId
  ) {
    return drop(counting, fact);
  }
  return {
    ...counting,
    entries: new Map(counting.entries).set(fact.id, reconcile(fact, [])),
  };
}

/**
 * Folds the dropped facts above `after` again. A page read before a fact
 * landed doesn't include it, so without this its entry would stay stuck
 * at `pending` or `streaming`, or a late anchor would be lost.
 *
 * @param state - Live state so far.
 * @param after - Only facts with a greater id are folded again.
 * @param view - What the pages have loaded, including the page that arrived.
 */
export function refold(
  state: LiveState,
  after: number,
  view: FoldView,
): LiveState {
  const again = state.dropped.filter((fact) => fact.id > after);
  if (again.length === 0) {
    return state;
  }
  let next: LiveState = {
    ...state,
    dropped: state.dropped.filter((fact) => fact.id <= after),
  };
  for (const fact of again) {
    next = fold(next, fact, view);
  }
  return next;
}

type LiveAction =
  | { type: 'facts'; load: string; facts: LogFact[]; view: FoldView }
  | { type: 'evicted'; load: string; ids: number[] }
  | { type: 'refold'; load: string; after: number; view: FoldView };

const reduceLive = (state: LiveState, action: LiveAction): LiveState => {
  const base = state.load === action.load ? state : emptyLive(action.load);
  switch (action.type) {
    case 'facts':
      return action.facts.reduce(
        (current, fact) => fold(current, fact, action.view),
        base,
      );
    case 'evicted':
      return { ...base, evicted: new Set([...base.evicted, ...action.ids]) };
    case 'refold':
      return refold(base, action.after, action.view);
  }
};

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

const noLive = emptyLive('');

const noPages: LoadedPage[] = [];

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
 * Pages come from SWR (`GET …/logs?q=&cursor=&limit=200`) as reconciled
 * entries. The stream starts at the first page's `after`, so nothing is
 * missed or duplicated; its facts are folded into entries kept apart from the
 * pages and shown over them (`fold`). `EventSource` reconnects by itself with
 * `Last-Event-ID`.
 *
 * @param server - Server name.
 * @param query - Case-insensitive search text; empty for none.
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
    // The stream keeps the list current; refetching could drop facts that
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
  const after = firstPage?.after ?? 0;

  const [liveState, dispatch] = useReducer(reduceLive, emptyLive(load));
  const live = liveState.load === shownLoad && !blank ? liveState : noLive;

  // The browser holds only so many live anchors: start over from a fresh page.
  if (ready && live.counted.size > MAX_ENTRIES) {
    setEpoch({ query, restarts: epoch.restarts + 1 });
  }

  const hasOlder = typeof pages?.at(-1)?.nextCursor === 'string';

  const pageEntries = useMemo(
    () =>
      new Map(
        (pages ?? []).flatMap((page) =>
          page.items.map((entry): [number, LogEntry] => [entry.id, entry]),
        ),
      ),
    [pages],
  );

  const entries = useMemo(() => {
    const merged = new Map(pageEntries);
    for (const [anchorId, entry] of live.entries) {
      merged.set(anchorId, entry);
    }
    for (const anchorId of live.evicted) {
      merged.delete(anchorId);
    }
    return [...merged.values()].toSorted((a, b) => b.id - a.id);
  }, [live, pageEntries]);

  // What event handlers fold against, kept current without resubscribing.
  const viewRef = useRef<FoldView>({
    pageEntries,
    oldestLoadedId: null,
    hasOlder,
  });
  const newestShownRef = useRef(0);
  useEffect(() => {
    viewRef.current = {
      pageEntries,
      oldestLoadedId: entries.at(-1)?.id ?? null,
      hasOlder,
    };
    newestShownRef.current = entries[0]?.id ?? 0;
  }, [entries, hasOlder, pageEntries]);

  // A page read before some facts landed lacks them: fold again what was
  // dropped since that page's `after`.
  const foldedPagesRef = useRef(new WeakSet<LoadedPage>());
  useEffect(() => {
    if (!ready || blank) {
      return;
    }
    let oldestAfter: number | undefined;
    for (const page of pages ?? []) {
      if (!foldedPagesRef.current.has(page)) {
        foldedPagesRef.current.add(page);
        oldestAfter = Math.min(oldestAfter ?? page.after, page.after);
      }
    }
    if (oldestAfter !== undefined) {
      dispatch({
        type: 'refold',
        load,
        after: oldestAfter,
        view: { ...viewRef.current, pageEntries },
      });
    }
  }, [blank, load, pageEntries, pages, ready]);

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
  // Anchors received while paused. Attachments are applied right away, so a
  // selected row never stays at "Waiting…".
  const bufferRef = useRef<LogFact[]>([]);

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

    const receive = (fact: LogFact) => {
      if (pausedRef.current && anchorIdOf(fact) === null) {
        bufferRef.current.push(fact);
        // A late anchor is older than what is shown: not "new above".
        if (fact.id > newestShownRef.current) {
          setPendingState((current) => ({
            load,
            count: (current.load === load ? current.count : 0) + 1,
          }));
        }
        return;
      }
      dispatch({ type: 'facts', load, facts: [fact], view: viewRef.current });
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
    source.addEventListener(LOG_STREAM_EVENTS.fact, (event) => {
      const parsed = logFactSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) {
        receive(parsed.data);
      }
    });
    source.addEventListener(LOG_STREAM_EVENTS.evicted, (event) => {
      const parsed = logEvictedSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success) {
        dispatch({ type: 'evicted', load, ids: [parsed.data.id] });
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
      dispatch({ type: 'facts', load, facts: buffered, view: viewRef.current });
      // Attachments that arrived for those anchors were set aside.
      dispatch({ type: 'refold', load, after: 0, view: viewRef.current });
    }
  }, [load]);

  const loadingOlder = !blank && pages !== undefined && size > pages.length;

  const loadOlder = useCallback(() => {
    if (hasOlder && !loadingOlder) {
      void setSize((current) => current + 1);
    }
  }, [hasOlder, loadingOlder, setSize]);

  const total = Math.max(
    0,
    (firstPage?.total ?? 0) + live.counted.size - live.evicted.size,
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
