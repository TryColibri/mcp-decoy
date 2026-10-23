import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import {
  MAX_ENTRIES,
  PAGE_SIZE,
  prependEntries,
  useLogStream,
} from './use-log-stream';

const entry = (id: number): LogEntry => ({
  id,
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  direction: 'in',
  kind: 'request',
  method: 'tools/list',
  jsonrpcId: id,
  durationMs: null,
  raw: `{"jsonrpc":"2.0","id":${id},"method":"tools/list"}`,
});

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
    return { items: [], nextCursor: null, total: 0 };
  }
  const filtered = url.searchParams.get('q') !== null;
  if (filtered) {
    return { items: [entry(5), entry(2)], nextCursor: null, total: 2 };
  }
  return url.searchParams.get('cursor') === 'older'
    ? { items: [entry(3), entry(2), entry(1)], nextCursor: null, total: 6 }
    : { items: [entry(6), entry(5), entry(4)], nextCursor: 'older', total: 6 };
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

describe('prependEntries', () => {
  it('prepends newer entries, newest first', () => {
    expect(ids(prependEntries([entry(1)], [entry(2), entry(3)]))).toEqual([
      3, 2, 1,
    ]);
  });

  it('skips entries a reconnect replays', () => {
    const items = [entry(2), entry(1)];

    expect(prependEntries(items, [entry(2)])).toBe(items);
    expect(ids(prependEntries(items, [entry(1), entry(3)]))).toEqual([3, 2, 1]);
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
      lastSource().emit('entry', JSON.stringify(entry(7)));
      lastSource().emit('entry', JSON.stringify(entry(7)));
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
        '/api/v1/servers/weather/logs/stream?after=5&q=tools%2Fcall',
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
      lastSource().emit('entry', JSON.stringify(entry(7)));
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
      lastSource().emit('entry', JSON.stringify(entry(7)));
      lastSource().emit('entry', JSON.stringify(entry(8)));
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

  it('empties everything when the log is cleared', async () => {
    const { result } = render();
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      lastSource().emit('entry', JSON.stringify(entry(7)));
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
    await waitFor(() => {
      expect(lastSource().url).toBe(
        '/api/v1/servers/weather/logs/stream?after=0',
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
        lastSource().emit('entry', JSON.stringify(entry(id)));
      }
    });

    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    await waitFor(() => {
      expect(ids(result.current.entries)).toEqual([6, 5, 4]);
    });
    expect(result.current.total).toBe(6);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

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
