import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import { mcpEntry, mcpFact, noReplyFact, replyFact } from './log-fixtures';
import {
  emptyLive,
  fold,
  type FoldView,
  type LiveState,
  MAX_ENTRIES,
  PAGE_SIZE,
  refold,
  useLogStream,
} from './use-log-stream';

const anchor = (id: number) =>
  mcpFact({
    id,
    kind: 'request',
    jsonrpcId: id,
    raw: `{"jsonrpc":"2.0","id":${id},"method":"tools/list"}`,
  });

const entry = (id: number): LogEntry => mcpEntry(anchor(id));

const fact = (id: number) => anchor(id);

/** A controllable stand-in for the browser's EventSource. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, data = '') {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

const urlOf = (input: RequestInfo | URL | undefined): string =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : (input ?? '');

/** The server's log, as pages of three: [6, 5, 4] then [3, 2, 1]; or empty once cleared. */
const pageOf = (url: URL, cleared: boolean) => {
  if (cleared) {
    return { items: [], nextCursor: null, total: 0, after: 6 };
  }
  const filtered = url.searchParams.get('q') !== null;
  if (filtered) {
    return {
      items: [entry(5), entry(2)],
      nextCursor: null,
      total: 2,
      after: 6,
    };
  }
  return url.searchParams.get('cursor') === 'older'
    ? {
        items: [entry(3), entry(2), entry(1)],
        nextCursor: null,
        total: 6,
        after: 6,
      }
    : {
        items: [entry(6), entry(5), entry(4)],
        nextCursor: 'older',
        total: 6,
        after: 6,
      };
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const lastSource = () => {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) {
    throw new Error('No EventSource opened');
  }
  return source;
};

const ids = (entries: LogEntry[]) => entries.map((e) => e.id);

const view = (loaded: LogEntry[], hasOlder = false): FoldView => ({
  pageEntries: new Map(loaded.map((item) => [item.id, item])),
  oldestLoadedId: loaded.at(-1)?.id ?? null,
  hasOlder,
});

const foldAll = (
  state: LiveState,
  facts: Array<ReturnType<typeof fact>>,
  v: FoldView,
) => facts.reduce((current, item) => fold(current, item, v), state);

describe('fold', () => {
  it('inserts and counts a new anchor', () => {
    const state = fold(emptyLive('l'), fact(7), view([entry(6)]));

    expect([...state.entries.keys()]).toEqual([7]);
    expect([...state.counted]).toEqual([7]);
  });

  it('is idempotent', () => {
    const v = view([entry(6)]);
    const request = fact(7);
    const reply = replyFact(request, {});

    const once = foldAll(emptyLive('l'), [request, reply], v);
    const twice = foldAll(once, [request, reply], v);

    expect(twice).toBe(once);
    expect(twice.entries.get(7)).toMatchObject({ state: 'complete' });
  });

  it('counts an anchor an older page already holds, without inserting it', () => {
    const state = fold(emptyLive('l'), fact(5), view([entry(6), entry(5)]));

    expect(state.entries.size).toBe(0);
    expect([...state.counted]).toEqual([5]);
  });

  it('inserts a late anchor older than the loaded entries once every page is loaded', () => {
    const state = fold(emptyLive('l'), fact(2), view([entry(6), entry(4)]));

    expect([...state.entries.keys()]).toEqual([2]);
    expect(state.dropped).toEqual([]);
  });

  it('drops an anchor below the oldest loaded entry while older pages exist', () => {
    const late = fact(2);

    const state = fold(emptyLive('l'), late, view([entry(6), entry(4)], true));

    expect(state.entries.size).toBe(0);
    expect(state.dropped).toEqual([late]);
    expect([...state.counted]).toEqual([2]);
  });

  it('patches the entry of a loaded anchor with its attachment', () => {
    const request = fact(7);
    const reply = replyFact(request, {});

    const state = fold(emptyLive('l'), reply, view([mcpEntry(request)]));

    expect(state.entries.get(7)).toMatchObject({
      state: 'complete',
      reply: { id: reply.id },
    });
    expect(state.counted.size).toBe(0);
  });

  it('keeps an attachment whose anchor is not loaded', () => {
    const request = fact(7);
    const end = noReplyFact(request);

    const state = fold(emptyLive('l'), end, view([entry(6)]));

    expect(state.dropped).toEqual([end]);
    expect(state.entries.size).toBe(0);
  });

  it('ignores an attachment of an evicted anchor', () => {
    const request = fact(7);
    const base = { ...emptyLive('l'), evicted: new Set([7]) };

    const state = fold(base, noReplyFact(request), view([mcpEntry(request)]));

    expect(state.entries.size).toBe(0);
  });
});

describe('refold', () => {
  it('applies dropped facts newer than a page once their anchor is loaded', () => {
    const request = fact(7);
    const reply = replyFact(request, {});
    const dropped = fold(emptyLive('l'), reply, view([entry(6)]));

    const state = refold(dropped, 6, view([mcpEntry(request), entry(6)]));

    expect(state.dropped).toEqual([]);
    expect(state.entries.get(7)).toMatchObject({ state: 'complete' });
  });

  it('leaves facts the page already covers', () => {
    const request = fact(7);
    const dropped = fold(
      emptyLive('l'),
      noReplyFact(request),
      view([entry(6)]),
    );

    expect(refold(dropped, 99, view([entry(6)]))).toBe(dropped);
  });

  it('keeps facts that still have nowhere to go', () => {
    const request = fact(7);
    const dropped = fold(
      emptyLive('l'),
      noReplyFact(request),
      view([entry(6)]),
    );

    expect(refold(dropped, 0, view([entry(6)])).dropped).toHaveLength(1);
  });
});

describe('useLogStream', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let cleared: boolean;

  const render = (query = '') =>
    renderHook(({ q }) => useLogStream('weather', q), {
      wrapper,
      initialProps: { q: query },
    });

  const requested = (call: number) =>
    new URL(urlOf(mockFetch.mock.calls[call]?.[0]), 'http://localhost');

  beforeEach(() => {
    FakeEventSource.instances = [];
    cleared = false;
    vi.stubGlobal('EventSource', FakeEventSource);
    mockFetch = vi.fn<typeof fetch>(async (input) =>
      Response.json(pageOf(new URL(urlOf(input), 'http://localhost'), cleared)),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the newest page, then streams after its newest id', async () => {
    const { result } = render();

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([6, 5, 4]);
    });
    expect(result.current.total).toBe(6);
    expect(result.current.hasOlder).toBe(true);
    expect(requested(0).searchParams.get('limit')).toBe(String(PAGE_SIZE));
    expect(requested(0).searchParams.has('q')).toBe(false);
    await waitFor(() => {
      expect(lastSource().url).toBe(
        '/api/v1/servers/weather/logs/stream?after=6',
      );
    });

    act(() => {
      lastSource().emit('open');
      lastSource().emit('fact', JSON.stringify(fact(7)));
      lastSource().emit('fact', JSON.stringify(fact(7)));
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([7, 6, 5, 4]);
    });
    expect(result.current.total).toBe(7);
    expect(result.current.connection).toBe('live');
  });

  it('sends the query to the page and the stream', async () => {
    const { result } = render('tools/call');

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([5, 2]);
    });
    expect(requested(0).searchParams.get('q')).toBe('tools/call');
    expect(result.current.total).toBe(2);
    await waitFor(() => {
      expect(lastSource().url).toBe(
        '/api/v1/servers/weather/logs/stream?after=6&q=tools%2Fcall',
      );
    });
  });

  it('loads older pages with the returned cursor until the start', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(result.current.hasOlder).toBe(true);
    });

    act(() => {
      result.current.loadOlder();
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([6, 5, 4, 3, 2, 1]);
    });
    expect(requested(1).searchParams.get('cursor')).toBe('older');
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.total).toBe(6);
  });

  it('counts evicted entries out of the total and drops them', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(7)));
      lastSource().emit('evicted', JSON.stringify({ id: 4 }));
      lastSource().emit('evicted', JSON.stringify({ id: 1 }));
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([7, 6, 5]);
    });
    // 6 on the server, plus 1 live, minus 2 evicted.
    expect(result.current.total).toBe(5);
  });

  it('buffers entries while paused and flushes them on resume', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      result.current.pause();
    });
    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(7)));
      lastSource().emit('fact', JSON.stringify(fact(8)));
    });

    expect(result.current.pending).toBe(2);
    expect(ids(result.current.entries)).toEqual([6, 5, 4]);
    expect(result.current.total).toBe(6);

    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([8, 7, 6, 5, 4]);
    });
    expect(result.current.pending).toBe(0);
    expect(result.current.total).toBe(8);
  });

  it('does not count a replayed anchor twice', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(7)));
      lastSource().emit('fact', JSON.stringify(fact(7)));
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([7, 6, 5, 4]);
    });
    expect(result.current.total).toBe(7);
  });

  it('patches a page entry with an attachment, even while paused', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      result.current.pause();
    });

    act(() => {
      lastSource().emit(
        'fact',
        JSON.stringify(noReplyFact(fact(6), 'session-closed')),
      );
    });

    await waitFor(() => {
      expect(result.current.entries[0]).toMatchObject({
        id: 6,
        state: 'aborted',
      });
    });
    expect(result.current.pending).toBe(0);
  });

  it('inserts a late anchor in sorted order and counts it', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    // A late anchor arrives after a newer one: it still lands in id order.
    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(8)));
      lastSource().emit('fact', JSON.stringify(fact(7)));
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([8, 7, 6, 5, 4]);
    });
    expect(result.current.total).toBe(8);
  });

  it('does not count a late anchor as new above while paused', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      result.current.pause();
    });

    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(2)));
      lastSource().emit('fact', JSON.stringify(fact(7)));
    });

    expect(result.current.pending).toBe(1);
    expect(ids(result.current.entries)).toEqual([6, 5, 4]);
  });

  it('applies an attachment that arrived while paused for a buffered anchor on resume', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      result.current.pause();
    });
    const request = fact(7);
    act(() => {
      lastSource().emit('fact', JSON.stringify(request));
      lastSource().emit('fact', JSON.stringify(replyFact(request, {})));
    });

    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.entries[0]).toMatchObject({
        id: 7,
        state: 'complete',
      });
    });
  });

  it('keeps a streamed anchor counted when a later older page holds it', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(result.current.hasOlder).toBe(true);
    });
    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(2)));
    });

    act(() => {
      result.current.loadOlder();
    });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([6, 5, 4, 3, 2, 1]);
    });
    // The first page counted 6; anchor 2 was counted from the stream too.
    expect(result.current.total).toBe(7);
  });

  it('empties everything when the log is cleared', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      lastSource().emit('fact', JSON.stringify(fact(7)));
    });

    cleared = true;
    act(() => {
      lastSource().emit('cleared', '{}');
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(result.current.total).toBe(0);
    expect(result.current.hasOlder).toBe(false);
    // The server's ids keep counting after a clear.
    await waitFor(() => {
      expect(lastSource().url).toBe(
        '/api/v1/servers/weather/logs/stream?after=6',
      );
    });
  });

  it('empties everything on reset', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([6, 5, 4]);
    });

    cleared = true;
    act(() => {
      result.current.reset();
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.loadingOlder).toBe(false);
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
  });

  it('closes the old stream and opens a new one when the query changes', async () => {
    const { result, rerender } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const first = lastSource();

    rerender({ q: 'tools/call' });

    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([5, 2]);
    });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    expect(first.closed).toBe(true);
    expect(lastSource().url).toContain('q=tools%2Fcall');
    expect(result.current.total).toBe(2);
  });

  it('starts over from a fresh first page past MAX_ENTRIES', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      result.current.pause();
    });
    act(() => {
      for (let id = 100; id <= 100 + MAX_ENTRIES; id++) {
        lastSource().emit('fact', JSON.stringify(fact(id)));
      }
    });

    act(() => {
      result.current.resume();
    });

    await waitFor(
      () => {
        expect(FakeEventSource.instances).toHaveLength(2);
      },
      { timeout: 20_000 },
    );
    await waitFor(
      () => {
        expect(ids(result.current.entries)).toEqual([6, 5, 4]);
      },
      { timeout: 20_000 },
    );
    expect(result.current.total).toBe(6);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    // Folding MAX_ENTRIES facts one by one is quadratic: ~2s locally, ~10s on a CI runner.
  }, 30_000);

  it('reports reconnecting when the stream drops', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      lastSource().emit('error');
    });

    expect(result.current.connection).toBe('reconnecting');
  });

  it('closes the stream on unmount', async () => {
    const { unmount } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    unmount();

    expect(lastSource().closed).toBe(true);
  });
});
