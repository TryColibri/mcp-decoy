import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { LOG_STREAM_EVENTS, type LogEntry, logEntrySchema } from '@/shared/api';
import { type ApiError, client, keys, unwrap } from '@/ui/api';

/** How many entries the page loads before streaming. */
export const INITIAL_LIMIT = 500;

/** Most entries kept in the browser; older ones are dropped. */
export const MAX_ENTRIES = 10_000;

/** Loaded entries, oldest first. */
export type LoadedLogs = {
  /** Entries, oldest first. */
  items: LogEntry[];
  /** Whether older entries exist on the server. */
  hasOlder: boolean;
};

/** State of the live connection. */
export type StreamConnection =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'closed';

/** What `useLogStream` returns. */
export type LogStream = {
  /** Entries shown, oldest first. Frozen while paused. */
  entries: LogEntry[];
  /** Whether older entries exist on the server. */
  hasOlder: boolean;
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
  /** Holds new entries back. */
  pause: () => void;
  /** Shows held-back entries and resumes streaming. */
  resume: () => void;
};

/**
 * Appends entries to a list, skipping any that aren't newer than its last
 * entry (a reconnect may replay some), and capping its length.
 *
 * @param items - Current entries, oldest first.
 * @param incoming - New entries, oldest first.
 */
export function appendEntries(
  items: LogEntry[],
  incoming: LogEntry[],
): LogEntry[] {
  const lastId = items.at(-1)?.id ?? 0;
  const fresh = incoming.filter((entry) => entry.id > lastId);
  if (fresh.length === 0) {
    return items;
  }
  const merged = [...items, ...fresh];
  return merged.length > MAX_ENTRIES ? merged.slice(-MAX_ENTRIES) : merged;
}

/**
 * Loads a server's latest log entries, then follows the live stream.
 *
 * The first page comes from SWR (`GET …/logs?limit=500`); the stream starts
 * after its highest id and appends into the same SWR cache entry, so nothing
 * is missed or duplicated. `EventSource` reconnects by itself with
 * `Last-Event-ID`.
 *
 * @param server - Server name.
 */
export function useLogStream(server: string): LogStream {
  const key = keys.logs(server);
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR<LoadedLogs, ApiError>(
    key,
    async () => {
      const page = await unwrap(
        client.servers[':server'].logs.$get({
          param: { server },
          query: { limit: String(INITIAL_LIMIT) },
        }),
      );
      return {
        items: [...page.items].reverse(),
        hasOlder: page.nextCursor !== null,
      };
    },
    {
      // The stream keeps the cache current; refetching could drop entries
      // that arrived meanwhile.
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    },
  );

  const [connection, setConnection] = useState<StreamConnection>('connecting');
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState(0);
  const pausedRef = useRef(false);
  const bufferRef = useRef<LogEntry[]>([]);

  const append = useCallback(
    async (incoming: LogEntry[]) =>
      mutate<LoadedLogs>(
        key,
        (current) =>
          current === undefined
            ? current
            : { ...current, items: appendEntries(current.items, incoming) },
        { revalidate: false },
      ),
    [key, mutate],
  );

  const loaded = data !== undefined;
  // Declared before the stream effect so it runs first: the stream starts
  // after the highest id of the first page.
  const lastIdRef = useRef(0);
  useEffect(() => {
    lastIdRef.current = data?.items.at(-1)?.id ?? lastIdRef.current;
  }, [data]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    const source = new EventSource(
      `/api/v1/servers/${encodeURIComponent(server)}/logs/stream?after=${lastIdRef.current}`,
    );

    source.addEventListener('open', () => {
      setConnection('live');
    });
    source.addEventListener('error', () => {
      setConnection(
        source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
      );
    });
    source.addEventListener(LOG_STREAM_EVENTS.entry, (event) => {
      const parsed = logEntrySchema.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) {
        return;
      }
      if (pausedRef.current) {
        bufferRef.current.push(parsed.data);
        setPending(bufferRef.current.length);
      } else {
        void append([parsed.data]);
      }
    });
    source.addEventListener(LOG_STREAM_EVENTS.cleared, () => {
      bufferRef.current = [];
      setPending(0);
      void mutate<LoadedLogs>(
        key,
        { items: [], hasOlder: false },
        { revalidate: false },
      );
    });

    return () => {
      source.close();
    };
  }, [append, key, loaded, mutate, server]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    const buffered = bufferRef.current;
    bufferRef.current = [];
    setPending(0);
    if (buffered.length > 0) {
      void append(buffered);
    }
  }, [append]);

  return {
    entries: data?.items ?? [],
    hasOlder: data?.hasOlder ?? false,
    loading: isLoading,
    error,
    connection,
    paused,
    pending,
    pause,
    resume,
  };
}
