import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import { appendEntries, useLogStream } from './use-log-stream';

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

describe('appendEntries', () => {
  it('appends newer entries', () => {
    expect(
      appendEntries([entry(1)], [entry(2), entry(3)]).map((e) => e.id),
    ).toEqual([1, 2, 3]);
  });

  it('skips entries a reconnect replays', () => {
    const items = [entry(1), entry(2)];

    expect(appendEntries(items, [entry(2)])).toBe(items);
    expect(appendEntries(items, [entry(1), entry(3)]).map((e) => e.id)).toEqual(
      [1, 2, 3],
    );
  });
});

describe('useLogStream', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    mockFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        items: [entry(3), entry(2), entry(1)],
        nextCursor: 'abc',
      }),
    );
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the latest page oldest first, then streams after its last id', async () => {
    const { result } = renderHook(() => useLogStream('weather'), { wrapper });

    await waitFor(() => {
      expect(result.current.entries.map((e) => e.id)).toEqual([1, 2, 3]);
    });
    expect(result.current.hasOlder).toBe(true);
    expect(urlOf(mockFetch.mock.calls[0]?.[0])).toContain('limit=500');
    await waitFor(() => {
      expect(lastSource().url).toBe(
        '/api/v1/servers/weather/logs/stream?after=3',
      );
    });

    act(() => {
      lastSource().emit('open');
      lastSource().emit('entry', JSON.stringify(entry(4)));
      lastSource().emit('entry', JSON.stringify(entry(4)));
    });

    await waitFor(() => {
      expect(result.current.entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    });
    expect(result.current.connection).toBe('live');
  });

  it('buffers entries while paused and flushes them on resume', async () => {
    const { result } = renderHook(() => useLogStream('weather'), { wrapper });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      result.current.pause();
    });
    act(() => {
      lastSource().emit('entry', JSON.stringify(entry(4)));
      lastSource().emit('entry', JSON.stringify(entry(5)));
    });

    expect(result.current.pending).toBe(2);
    expect(result.current.entries.map((e) => e.id)).toEqual([1, 2, 3]);

    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.entries.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    });
    expect(result.current.pending).toBe(0);
  });

  it('empties the list when the log is cleared', async () => {
    const { result } = renderHook(() => useLogStream('weather'), { wrapper });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      lastSource().emit('cleared', '{}');
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(result.current.hasOlder).toBe(false);
  });

  it('reports reconnecting when the stream drops', async () => {
    const { result } = renderHook(() => useLogStream('weather'), { wrapper });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    act(() => {
      lastSource().emit('error');
    });

    expect(result.current.connection).toBe('reconnecting');
  });

  it('closes the stream on unmount', async () => {
    const { unmount } = renderHook(() => useLogStream('weather'), { wrapper });
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });

    unmount();

    expect(lastSource().closed).toBe(true);
  });
});
