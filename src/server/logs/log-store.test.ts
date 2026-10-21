import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogEntry } from '@/shared/api';

import { createRingBufferLogStore, type LogStore } from './log-store';

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
