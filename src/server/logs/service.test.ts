import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@/server/errors';
import {
  type HTTPEndFact,
  type HTTPEntry,
  type LogEntry,
  type LogFact,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';
import type * as SharedLogs from '@/shared/logs';
import { reconcile } from '@/shared/logs';

import { type LogEvent, type LogStore } from './log-store';
import {
  createLogsService,
  type LogStreamEvent,
  type LogsService,
  streamItemsFor,
} from './service';

vi.mock('@/shared/logs', async (importOriginal) => ({
  ...(await importOriginal<typeof SharedLogs>()),
  reconcile: vi.fn(),
}));

const mockReconcile = vi.mocked(reconcile);

const request = (id: number, raw = '{"method":"tools/call"}'): MCPFact => ({
  id,
  type: 'mcp',
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  from: 'client',
  kind: 'request',
  method: 'tools/call',
  jsonrpcId: id,
  raw,
  truncated: false,
  carriedBy: null,
  sse: null,
  replyTo: null,
  durationMs: null,
});

const reply = (id: number, replyTo: number, raw: string): MCPFact => ({
  ...request(id, raw),
  from: 'server',
  kind: 'response',
  method: null,
  replyTo,
});

const noReply = (id: number, replyTo: number): NoReplyFact => ({
  id,
  type: 'no-reply',
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  replyTo,
  reason: 'exchange-ended',
});

const httpEnd = (id: number, exchange: number): HTTPEndFact => ({
  id,
  type: 'http-end',
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  exchange,
  state: 'complete',
  durationMs: 1,
  events: 0,
});

const entryFor = (anchor: LogFact): LogEntry => {
  const entry: HTTPEntry = {
    type: 'http',
    id: anchor.id,
    exchange: {
      id: anchor.id,
      type: 'http',
      at: anchor.at,
      server: anchor.server,
      sessionId: anchor.sessionId,
      endpoint: 'mcp',
      request: {
        method: 'GET',
        url: 'http://x',
        headers: {},
        truncated: false,
      },
      response: null,
      durationMs: 1,
    },
    end: null,
    state: 'aborted',
    durationMs: 1,
  };
  return entry;
};

const mockStore = {
  append: vi.fn<LogStore['append']>(),
  lastId: vi.fn<LogStore['lastId']>(),
  get: vi.fn<LogStore['get']>(),
  attachmentOf: vi.fn<LogStore['attachmentOf']>(),
  anchors: vi.fn<LogStore['anchors']>(),
  countAnchors: vi.fn<LogStore['countAnchors']>(),
  factsAfter: vi.fn<LogStore['factsAfter']>(),
  clear: vi.fn<LogStore['clear']>(),
  rename: vi.fn<LogStore['rename']>(),
  subscribe: vi.fn<LogStore['subscribe']>(),
};
const mockAssertServerExists = vi.fn<(server: string) => void>();

describe('streamItemsFor', () => {
  it('sends an anchor that matches', () => {
    const anchor = request(1, '{"x":"needle"}');

    expect(streamItemsFor(anchor, undefined, 'needle')).toEqual([
      { fact: anchor, late: false },
    ]);
  });

  it('sends nothing for an anchor that does not match', () => {
    expect(streamItemsFor(request(1), undefined, 'needle')).toEqual([]);
  });

  it('sends an attachment whose anchor matches on its own', () => {
    const anchor = request(1, '{"x":"needle"}');
    const attachment = noReply(2, 1);

    expect(streamItemsFor(attachment, anchor, 'needle')).toEqual([
      { fact: attachment, late: false },
    ]);
  });

  it('sends a late anchor, then the attachment that makes the entry match', () => {
    const anchor = request(1);
    const attachment = reply(2, 1, '{"result":"needle"}');

    expect(streamItemsFor(attachment, anchor, 'needle')).toEqual([
      { fact: anchor, late: true },
      { fact: attachment, late: false },
    ]);
  });

  it('sends nothing when neither the anchor nor the attachment match', () => {
    expect(
      streamItemsFor(reply(2, 1, '{"result":"x"}'), request(1), 'needle'),
    ).toEqual([]);
    expect(streamItemsFor(httpEnd(2, 1), request(1), 'needle')).toEqual([]);
  });

  it('sends nothing for an attachment whose anchor is gone', () => {
    expect(
      streamItemsFor(reply(2, 1, '{"result":"needle"}'), undefined, 'needle'),
    ).toEqual([]);
    expect(streamItemsFor(noReply(2, 1), undefined)).toEqual([]);
  });

  it('sends every fact whose anchor exists without text', () => {
    const anchor = request(1);
    const attachment = noReply(2, 1);

    expect(streamItemsFor(anchor, undefined)).toEqual([
      { fact: anchor, late: false },
    ]);
    expect(streamItemsFor(attachment, anchor)).toEqual([
      { fact: attachment, late: false },
    ]);
  });
});

describe('createLogsService', () => {
  let logs: LogsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcile.mockImplementation((anchor) => entryFor(anchor));
    logs = createLogsService({
      store: mockStore,
      assertServerExists: mockAssertServerExists,
    });
  });

  describe('page', () => {
    it('reconciles each anchor with its attachment and returns the totals', () => {
      const [a, b] = [request(3), request(2)];
      const end = noReply(4, 3);
      mockStore.anchors.mockReturnValueOnce([a, b]);
      mockStore.attachmentOf.mockImplementation((id) =>
        id === a.id ? end : undefined,
      );
      mockStore.countAnchors.mockReturnValueOnce(7);
      mockStore.lastId.mockReturnValueOnce(12);

      const page = logs.page('weather', { text: 'a', limit: 2 });

      expect(page).toMatchObject({ more: false, total: 7, after: 12 });
      expect(page.items.map((item) => item.id)).toEqual([3, 2]);
      expect(mockReconcile).toHaveBeenNthCalledWith(1, a, [end]);
      expect(mockReconcile).toHaveBeenNthCalledWith(2, b, []);
      expect(mockStore.countAnchors).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        text: 'a',
        carriedBy: undefined,
      });
    });

    it('asks for one extra anchor to know whether there are more', () => {
      mockStore.anchors.mockReturnValueOnce([
        request(3),
        request(2),
        request(1),
      ]);
      mockStore.countAnchors.mockReturnValueOnce(3);

      const page = logs.page('weather', {
        carriedBy: 9,
        beforeId: 4,
        limit: 2,
      });

      expect(page.items).toHaveLength(2);
      expect(page.more).toBe(true);
      expect(mockStore.anchors).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        text: undefined,
        carriedBy: 9,
        beforeId: 4,
        limit: 3,
      });
    });

    it('throws when the server does not exist', () => {
      mockAssertServerExists.mockImplementationOnce(() => {
        throw new NotFoundError('No server');
      });

      expect(() => logs.page('nope', { limit: 1 })).toThrow(NotFoundError);
    });
  });

  describe('all', () => {
    it('returns every entry, oldest first', () => {
      mockStore.anchors.mockReturnValueOnce([request(3), request(1)]);

      const entries = logs.all('weather');

      expect(entries.map((entry) => entry.id)).toEqual([1, 3]);
      expect(mockStore.anchors).toHaveBeenCalledExactlyOnceWith({
        server: 'weather',
        limit: Number.POSITIVE_INFINITY,
      });
    });
  });

  describe('get', () => {
    it('returns the reconciled entry of an anchor', () => {
      const anchor = request(1);
      mockStore.get.mockReturnValueOnce(anchor);

      const entry = logs.get('weather', 1);

      expect(entry.id).toBe(1);
      expect(mockReconcile).toHaveBeenCalledExactlyOnceWith(anchor, []);
    });

    it.each([
      ['unknown', undefined],
      ['of another server', { ...request(1), server: 'other' }],
      ['an attachment', noReply(1, 0)],
      ['an attached reply', reply(1, 0, '{}')],
    ])('throws when the id is %s', (_name, fact) => {
      mockStore.get.mockReturnValueOnce(fact);

      expect(() => logs.get('weather', 1)).toThrow(NotFoundError);
    });

    it('throws when the server does not exist', () => {
      mockAssertServerExists.mockImplementationOnce(() => {
        throw new NotFoundError('No server');
      });

      expect(() => logs.get('nope', 1)).toThrow(NotFoundError);
    });
  });

  describe('clear', () => {
    it('clears the store of the server', () => {
      logs.clear('weather');

      expect(mockStore.clear).toHaveBeenCalledExactlyOnceWith('weather');
    });
  });

  describe('stream', () => {
    let emit: (event: LogEvent) => void;
    const unsubscribe = vi.fn();
    const received: LogStreamEvent[] = [];

    beforeEach(() => {
      received.length = 0;
      mockStore.subscribe.mockImplementation((_server, listener) => {
        emit = listener;
        return unsubscribe;
      });
      mockStore.factsAfter.mockReturnValue([]);
      mockStore.get.mockReturnValue(undefined);
    });

    const start = (text?: string, afterId = 0) =>
      logs.stream('weather', { text, afterId }, (event) => {
        received.push(event);
      });

    it('replays the backlog after the given id, then follows live facts', () => {
      const old = request(5);
      mockStore.factsAfter.mockReturnValueOnce([old]);

      start(undefined, 4);
      emit({ type: 'fact', fact: request(6) });

      expect(mockStore.factsAfter).toHaveBeenCalledExactlyOnceWith(
        'weather',
        4,
      );
      expect(received).toEqual([
        { type: 'fact', fact: old, late: false },
        { type: 'fact', fact: request(6), late: false },
      ]);
    });

    it('sends a late anchor before the attachment that makes it match', () => {
      const anchor = request(1);
      const attachment = reply(2, 1, '{"result":"needle"}');
      mockStore.get.mockReturnValue(anchor);

      start('needle');
      emit({ type: 'fact', fact: attachment });

      expect(received).toEqual([
        { type: 'fact', fact: anchor, late: true },
        { type: 'fact', fact: attachment, late: false },
      ]);
    });

    it('drops an attachment whose anchor is gone', () => {
      start();
      emit({ type: 'fact', fact: noReply(2, 1) });

      expect(received).toEqual([]);
    });

    it('forwards the eviction of an anchor that matches', () => {
      start('needle');

      emit({
        type: 'evicted',
        fact: request(1, '{"x":"needle"}'),
        attachment: undefined,
      });

      expect(received).toEqual([{ type: 'evicted', id: 1 }]);
    });

    it('forwards the eviction of an anchor that matched only through its attachment', () => {
      start('needle');

      emit({
        type: 'evicted',
        fact: request(1),
        attachment: reply(2, 1, '{"result":"needle"}'),
      });

      expect(received).toEqual([{ type: 'evicted', id: 1 }]);
    });

    it('drops the eviction of an anchor that does not match', () => {
      start('needle');

      emit({ type: 'evicted', fact: request(1), attachment: noReply(2, 1) });

      expect(received).toEqual([]);
    });

    it('drops the eviction of an attachment', () => {
      start();

      emit({ type: 'evicted', fact: noReply(2, 1), attachment: undefined });

      expect(received).toEqual([]);
    });

    it('always forwards cleared', () => {
      start('needle');

      emit({ type: 'cleared' });

      expect(received).toEqual([{ type: 'cleared' }]);
    });

    it('returns the store’s unsubscribe', () => {
      expect(start()).toBe(unsubscribe);
    });

    it('throws when the server does not exist', () => {
      mockAssertServerExists.mockImplementationOnce(() => {
        throw new NotFoundError('No server');
      });

      expect(() => start()).toThrow(NotFoundError);
      expect(mockStore.subscribe).not.toHaveBeenCalled();
    });
  });
});
