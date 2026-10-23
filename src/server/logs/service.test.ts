import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@/server/errors';
import { type LogEntry } from '@/shared/api';

import { type LogEvent, type LogStore } from './log-store';
import { createLogsService, type LogsService } from './service';

const entry = (id: number, method: string): LogEntry => ({
  id,
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  direction: 'in',
  kind: 'request',
  method,
  jsonrpcId: id,
  durationMs: null,
  raw: `{"method":"${method}"}`,
});

const mockStore = {
  append: vi.fn<LogStore['append']>(),
  query: vi.fn<LogStore['query']>(),
  count: vi.fn<LogStore['count']>(),
  clear: vi.fn<LogStore['clear']>(),
  rename: vi.fn<LogStore['rename']>(),
  subscribe: vi.fn<LogStore['subscribe']>(),
};
const mockAssertServerExists = vi.fn<(server: string) => void>();

describe('createLogsService', () => {
  let logs: LogsService;

  beforeEach(() => {
    vi.clearAllMocks();
    logs = createLogsService({
      store: mockStore,
      assertServerExists: mockAssertServerExists,
    });
  });

  describe('page', () => {
    it('returns the total of matching entries across pages', () => {
      mockStore.query.mockReturnValueOnce([entry(3, 'a'), entry(2, 'a')]);
      mockStore.count.mockReturnValueOnce(7);

      const page = logs.page('weather', { text: 'a', limit: 2 });

      expect(page).toEqual({
        items: [entry(3, 'a'), entry(2, 'a')],
        more: false,
        total: 7,
      });
      expect(mockStore.count).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        text: 'a',
      });
    });

    it('asks for one extra entry to know whether there are more', () => {
      mockStore.query.mockReturnValueOnce([
        entry(3, 'a'),
        entry(2, 'a'),
        entry(1, 'a'),
      ]);
      mockStore.count.mockReturnValueOnce(3);

      const page = logs.page('weather', { limit: 2, beforeId: 9 });

      expect(page.items.map((e) => e.id)).toEqual([3, 2]);
      expect(page.more).toBe(true);
      expect(mockStore.query).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        text: undefined,
        beforeId: 9,
        limit: 3,
      });
    });

    it('throws when the server does not exist', () => {
      mockAssertServerExists.mockImplementationOnce(() => {
        throw new NotFoundError('No such server');
      });

      expect(() => logs.page('nope', { limit: 1 })).toThrow(NotFoundError);
    });
  });

  describe('after', () => {
    it('returns matching entries oldest first', () => {
      mockStore.query.mockReturnValueOnce([entry(5, 'a'), entry(4, 'a')]);

      const entries = logs.after('weather', 3, 'a');

      expect(entries.map((e) => e.id)).toEqual([4, 5]);
      expect(mockStore.query).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        text: 'a',
        afterId: 3,
        limit: Number.POSITIVE_INFINITY,
      });
    });
  });

  describe('subscribe', () => {
    const subscribeFiltered = (text?: string) => {
      const listener = vi.fn<(event: LogEvent) => void>();
      logs.subscribe('weather', { text }, listener);
      const subscribed = mockStore.subscribe.mock.lastCall;
      if (subscribed === undefined) {
        throw new Error('Store was not subscribed');
      }
      return { listener, deliver: subscribed[1] };
    };

    it('forwards entry and evicted events that match the text', () => {
      const { listener, deliver } = subscribeFiltered('TOOLS/CALL');
      const hit = entry(1, 'tools/call');

      deliver({ type: 'entry', entry: hit });
      deliver({ type: 'evicted', entry: hit });

      expect(listener.mock.calls).toEqual([
        [{ type: 'entry', entry: hit }],
        [{ type: 'evicted', entry: hit }],
      ]);
    });

    it('drops entry and evicted events that do not match', () => {
      const { listener, deliver } = subscribeFiltered('tools/call');
      const miss = entry(1, 'tools/list');

      deliver({ type: 'entry', entry: miss });
      deliver({ type: 'evicted', entry: miss });

      expect(listener).not.toHaveBeenCalled();
    });

    it('always forwards cleared', () => {
      const { listener, deliver } = subscribeFiltered('tools/call');

      deliver({ type: 'cleared' });

      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'cleared' });
    });

    it('forwards everything without text', () => {
      const { listener, deliver } = subscribeFiltered();

      deliver({ type: 'entry', entry: entry(1, 'tools/list') });

      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns the store’s unsubscribe', () => {
      const unsubscribe = vi.fn();
      mockStore.subscribe.mockReturnValueOnce(unsubscribe);

      expect(logs.subscribe('weather', {}, vi.fn())).toBe(unsubscribe);
    });
  });
});
