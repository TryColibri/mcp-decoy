import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import { createRingBufferLogStore, type LogStore, matches } from './log-store';

const entry = (
  server: string,
  method: string,
  raw = `{"method":"${method}"}`,
): Omit<LogEntry, 'id'> => ({
  at: '2026-10-21T12:00:00.000Z',
  server,
  sessionId: 's1',
  direction: 'in',
  kind: 'request',
  method,
  jsonrpcId: 1,
  durationMs: null,
  raw,
});

describe('createRingBufferLogStore', () => {
  let store: LogStore;

  beforeEach(() => {
    store = createRingBufferLogStore(3);
  });

  describe('append', () => {
    it('assigns monotonic ids across servers', () => {
      const a = store.append(entry('a', 'one'));
      const b = store.append(entry('b', 'two'));

      expect([a.id, b.id]).toEqual([1, 2]);
    });

    it('evicts the oldest entry once the global cap is reached', () => {
      store.append(entry('a', 'one'));
      store.append(entry('b', 'two'));
      store.append(entry('a', 'three'));
      store.append(entry('a', 'four'));

      expect(
        store.query({ server: 'a', limit: 10 }).map((e) => e.method),
      ).toEqual(['four', 'three']);
      expect(store.query({ server: 'b', limit: 10 })).toHaveLength(1);
    });
  });

  describe('append events', () => {
    it('tells only the evicted entry’s server about the eviction', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const first = store.append(entry('a', 'one'));
      store.append(entry('b', 'two'));
      store.append(entry('b', 'three'));
      store.subscribe('a', listenerA);
      store.subscribe('b', listenerB);

      const appended = store.append(entry('b', 'four'));

      expect(listenerA).toHaveBeenCalledExactlyOnceWith({
        type: 'evicted',
        entry: first,
      });
      expect(listenerB).toHaveBeenCalledExactlyOnceWith({
        type: 'entry',
        entry: appended,
      });
    });

    it('sends the eviction before the new entry of the same server', () => {
      const listener = vi.fn();
      const first = store.append(entry('a', 'one'));
      store.append(entry('a', 'two'));
      store.append(entry('a', 'three'));
      store.subscribe('a', listener);

      const appended = store.append(entry('a', 'four'));

      expect(listener.mock.calls).toEqual([
        [{ type: 'evicted', entry: first }],
        [{ type: 'entry', entry: appended }],
      ]);
    });

    it('does not evict while the buffer has room', () => {
      const listener = vi.fn();
      store.subscribe('a', listener);

      store.append(entry('a', 'one'));

      expect(listener).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: 'entry' }),
      );
    });
  });

  describe('count', () => {
    beforeEach(() => {
      store = createRingBufferLogStore(100);
      store.append(entry('a', 'initialize'));
      store.append(entry('a', 'tools/list'));
      store.append(entry('b', 'tools/list'));
      store.append(entry('a', 'tools/call', '{"name":"Get_Forecast"}'));
    });

    it('counts the entries of one server', () => {
      expect(store.count({ server: 'a' })).toBe(3);
      expect(store.count({ server: 'b' })).toBe(1);
      expect(store.count({ server: 'none' })).toBe(0);
    });

    it('counts only entries matching the text, like query', () => {
      expect(store.count({ server: 'a', text: 'TOOLS/' })).toBe(2);
      expect(store.count({ server: 'a', text: 'get_forecast' })).toBe(1);
      expect(store.count({ server: 'a', text: 'nothing' })).toBe(0);
      expect(store.count({ server: 'a', text: '' })).toBe(3);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      store = createRingBufferLogStore(100);
      store.append(entry('a', 'initialize'));
      store.append(entry('a', 'tools/list'));
      store.append(entry('b', 'tools/list'));
      store.append(entry('a', 'tools/call', '{"name":"Get_Forecast"}'));
    });

    it('returns entries of one server, newest first', () => {
      expect(store.query({ server: 'a', limit: 10 }).map((e) => e.id)).toEqual([
        4, 2, 1,
      ]);
    });

    it('honors limit', () => {
      expect(store.query({ server: 'a', limit: 1 }).map((e) => e.id)).toEqual([
        4,
      ]);
    });

    it('filters by afterId and beforeId', () => {
      expect(
        store.query({ server: 'a', afterId: 1, limit: 10 }).map((e) => e.id),
      ).toEqual([4, 2]);
      expect(
        store.query({ server: 'a', beforeId: 4, limit: 10 }).map((e) => e.id),
      ).toEqual([2, 1]);
    });

    it('searches method and raw case-insensitively', () => {
      expect(
        store
          .query({ server: 'a', text: 'TOOLS/', limit: 10 })
          .map((e) => e.id),
      ).toEqual([4, 2]);
      expect(
        store
          .query({ server: 'a', text: 'get_forecast', limit: 10 })
          .map((e) => e.id),
      ).toEqual([4]);
    });
  });

  describe('clear', () => {
    it('drops only the given server and notifies its subscribers', () => {
      store.append(entry('a', 'one'));
      store.append(entry('b', 'two'));
      const listener = vi.fn();
      store.subscribe('a', listener);

      store.clear('a');

      expect(store.query({ server: 'a', limit: 10 })).toEqual([]);
      expect(store.query({ server: 'b', limit: 10 })).toHaveLength(1);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'cleared' });
    });

    it('keeps accepting entries afterwards', () => {
      store.append(entry('a', 'one'));
      store.clear('a');
      store.append(entry('a', 'two'));
      store.append(entry('a', 'three'));
      store.append(entry('a', 'four'));
      store.append(entry('a', 'five'));

      expect(
        store.query({ server: 'a', limit: 10 }).map((e) => e.method),
      ).toEqual(['five', 'four', 'three']);
    });
  });

  describe('rename', () => {
    it('moves the entries of a server and keeps their ids', () => {
      store.append(entry('a', 'one'));
      store.append(entry('b', 'two'));
      store.append(entry('a', 'three'));

      store.rename('a', 'c');

      expect(store.query({ server: 'a', limit: 10 })).toEqual([]);
      expect(
        store.query({ server: 'c', limit: 10 }).map((e) => [e.id, e.server]),
      ).toEqual([
        [3, 'c'],
        [1, 'c'],
      ]);
      expect(store.query({ server: 'b', limit: 10 })).toHaveLength(1);
    });
  });

  describe('subscribe', () => {
    it('delivers new entries of the server until unsubscribed', () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe('a', listener);

      const appended = store.append(entry('a', 'one'));
      store.append(entry('b', 'two'));
      unsubscribe();
      store.append(entry('a', 'three'));

      expect(listener).toHaveBeenCalledExactlyOnceWith({
        type: 'entry',
        entry: appended,
      });
    });
  });
});

describe('matches', () => {
  const logEntry: LogEntry = {
    id: 1,
    ...entry('a', 'tools/call', '{"name":"Get_Forecast"}'),
  };

  it('matches method and raw case-insensitively', () => {
    expect(matches(logEntry, 'TOOLS/CALL')).toBe(true);
    expect(matches(logEntry, 'get_forecast')).toBe(true);
    expect(matches(logEntry, 'initialize')).toBe(false);
  });

  it('matches everything without text', () => {
    expect(matches(logEntry)).toBe(true);
    expect(matches(logEntry, '')).toBe(true);
  });
});
