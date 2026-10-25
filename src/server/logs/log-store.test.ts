import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type HTTPEndFact,
  type HTTPFact,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';

import {
  createRingBufferLogStore,
  type LogEvent,
  type LogStore,
  matches,
} from './log-store';

const base = (server: string) => ({
  at: '2026-10-21T12:00:00.000Z',
  server,
  sessionId: 's1',
});

const http = (
  server: string,
  fields: Partial<Omit<HTTPFact, 'id'>> = {},
): Omit<HTTPFact, 'id'> => ({
  ...base(server),
  type: 'http',
  endpoint: 'mcp',
  request: {
    method: 'POST',
    url: `http://127.0.0.1:6280/s/${server}/mcp`,
    headers: { 'content-type': 'application/json' },
    truncated: false,
  },
  response: { status: 200, headers: {}, stream: true, truncated: false },
  durationMs: 1,
  ...fields,
});

const httpEnd = (
  server: string,
  exchange: number,
): Omit<HTTPEndFact, 'id'> => ({
  ...base(server),
  type: 'http-end',
  exchange,
  state: 'complete',
  durationMs: 5,
  events: 1,
});

const mcp = (
  server: string,
  method: string | null,
  fields: Partial<Omit<MCPFact, 'id'>> = {},
): Omit<MCPFact, 'id'> => ({
  ...base(server),
  type: 'mcp',
  from: 'client',
  kind: 'request',
  method,
  jsonrpcId: 1,
  raw: `{"method":"${method}"}`,
  truncated: false,
  carriedBy: null,
  sse: null,
  replyTo: null,
  durationMs: null,
  ...fields,
});

const noReply = (server: string, replyTo: number): Omit<NoReplyFact, 'id'> => ({
  ...base(server),
  type: 'no-reply',
  replyTo,
  reason: 'exchange-ended',
});

const idsOf = (facts: Array<{ id: number }>) => facts.map((fact) => fact.id);

describe('createRingBufferLogStore', () => {
  let store: LogStore;

  beforeEach(() => {
    store = createRingBufferLogStore(100);
  });

  describe('append', () => {
    it('assigns increasing ids across servers', () => {
      const first = store.append(mcp('a', 'ping'));
      const second = store.append(mcp('b', 'ping'));

      expect([first.id, second.id]).toEqual([1, 2]);
    });

    it('notifies subscribers of the fact`s server only', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      store.subscribe('a', listenerA);
      store.subscribe('b', listenerB);

      const fact = store.append(mcp('a', 'ping'));

      expect(listenerA).toHaveBeenCalledExactlyOnceWith({ type: 'fact', fact });
      expect(listenerB).not.toHaveBeenCalled();
    });
  });

  describe('lastId', () => {
    it('is 0 before the first fact and then the highest id', () => {
      expect(store.lastId()).toBe(0);

      store.append(mcp('a', 'ping'));
      store.append(mcp('b', 'ping'));

      expect(store.lastId()).toBe(2);
    });
  });

  describe('get', () => {
    it('finds a stored fact by id', () => {
      const fact = store.append(mcp('a', 'ping'));

      expect(store.get(fact.id)).toBe(fact);
      expect(store.get(99)).toBeUndefined();
    });
  });

  describe('attachmentOf', () => {
    it('finds the attachment of an anchor', () => {
      const exchange = store.append(http('a'));
      const end = store.append(httpEnd('a', exchange.id));
      const request = store.append(mcp('a', 'tools/list'));
      const reply = store.append(
        mcp('a', null, {
          from: 'server',
          kind: 'response',
          replyTo: request.id,
        }),
      );
      const unanswered = store.append(mcp('a', 'ping'));

      expect(store.attachmentOf(exchange.id)).toBe(end);
      expect(store.attachmentOf(request.id)).toBe(reply);
      expect(store.attachmentOf(unanswered.id)).toBeUndefined();
    });

    it('keeps the first of two attachments', () => {
      const request = store.append(mcp('a', 'ping'));
      const first = store.append(noReply('a', request.id));
      store.append(noReply('a', request.id));

      expect(store.attachmentOf(request.id)).toBe(first);
    });
  });

  describe('anchors', () => {
    it('lists only anchors, newest first, of one server', () => {
      const exchange = store.append(http('a'));
      store.append(httpEnd('a', exchange.id));
      const request = store.append(mcp('a', 'tools/list'));
      store.append(
        mcp('a', null, {
          from: 'server',
          kind: 'response',
          replyTo: request.id,
        }),
      );
      store.append(mcp('b', 'ping'));
      const notification = store.append(
        mcp('a', 'notifications/x', { kind: 'notification' }),
      );

      const anchors = store.anchors({ server: 'a', limit: 10 });

      expect(idsOf(anchors)).toEqual([
        notification.id,
        request.id,
        exchange.id,
      ]);
    });

    it('pages with beforeId and limit', () => {
      const facts = [1, 2, 3, 4].map(() => store.append(mcp('a', 'ping')));

      const page = store.anchors({
        server: 'a',
        beforeId: facts[3].id,
        limit: 2,
      });

      expect(idsOf(page)).toEqual([facts[2].id, facts[1].id]);
    });

    it('matches an entry when its anchor matches', () => {
      store.append(mcp('a', 'tools/list'));
      const call = store.append(mcp('a', 'tools/call'));

      const found = store.anchors({ server: 'a', text: 'CALL', limit: 10 });

      expect(idsOf(found)).toEqual([call.id]);
    });

    it('matches an entry when its attachment matches', () => {
      const request = store.append(mcp('a', 'tools/call'));
      store.append(
        mcp('a', null, {
          from: 'server',
          kind: 'response',
          replyTo: request.id,
          raw: '{"result":"needle"}',
        }),
      );
      store.append(mcp('a', 'tools/call'));

      const found = store.anchors({ server: 'a', text: 'needle', limit: 10 });

      expect(idsOf(found)).toEqual([request.id]);
    });

    it('matches http facts by URL, headers and bodies', () => {
      const byURL = store.append(http('a'));
      const byHeader = store.append(
        http('a', {
          request: {
            method: 'GET',
            url: 'http://x/y',
            headers: { 'x-trace': 'abc123' },
            truncated: false,
          },
        }),
      );
      const byBody = store.append(
        http('a', {
          request: {
            method: 'POST',
            url: 'http://x/z',
            headers: {},
            body: { note: 'say "hi"' },
            truncated: false,
          },
        }),
      );

      expect(
        idsOf(store.anchors({ server: 'a', text: '/s/a/mcp', limit: 10 })),
      ).toEqual([byURL.id]);
      expect(
        idsOf(store.anchors({ server: 'a', text: 'abc123', limit: 10 })),
      ).toEqual([byHeader.id]);
      expect(
        idsOf(store.anchors({ server: 'a', text: 'say "hi"', limit: 10 })),
      ).toEqual([byBody.id]);
    });

    it('matches carriedBy through the anchor and through the attachment', () => {
      const exchange = store.append(http('a'));
      const direct = store.append(
        mcp('a', 'notifications/x', {
          kind: 'notification',
          carriedBy: exchange.id,
        }),
      );
      const request = store.append(mcp('a', 'tools/list', { carriedBy: 999 }));
      store.append(
        mcp('a', null, {
          from: 'server',
          kind: 'response',
          replyTo: request.id,
          carriedBy: exchange.id,
        }),
      );
      store.append(mcp('a', 'ping', { carriedBy: 999 }));

      const found = store.anchors({
        server: 'a',
        carriedBy: exchange.id,
        limit: 10,
      });

      expect(idsOf(found)).toEqual([request.id, direct.id]);
    });

    it('never matches http entries by carriedBy', () => {
      const exchange = store.append(http('a'));

      expect(
        store.anchors({ server: 'a', carriedBy: exchange.id, limit: 10 }),
      ).toEqual([]);
    });
  });

  describe('countAnchors', () => {
    it('counts matching anchors only', () => {
      const exchange = store.append(http('a'));
      store.append(httpEnd('a', exchange.id));
      store.append(mcp('a', 'ping'));
      store.append(mcp('b', 'ping'));

      expect(store.countAnchors({ server: 'a' })).toBe(2);
      expect(store.countAnchors({ server: 'a', text: 'PING' })).toBe(1);
      expect(store.countAnchors({ server: 'c' })).toBe(0);
    });
  });

  describe('factsAfter', () => {
    it('lists facts of every type of one server, oldest first', () => {
      const exchange = store.append(http('a'));
      store.append(mcp('b', 'ping'));
      const end = store.append(httpEnd('a', exchange.id));
      const request = store.append(mcp('a', 'ping'));

      expect(idsOf(store.factsAfter('a', 0))).toEqual([
        exchange.id,
        end.id,
        request.id,
      ]);
      expect(idsOf(store.factsAfter('a', end.id))).toEqual([request.id]);
    });
  });

  describe('eviction', () => {
    beforeEach(() => {
      store = createRingBufferLogStore(3);
    });

    it('drops an anchor before its attachment and leaves no orphan in reads', () => {
      const request = store.append(mcp('a', 'tools/list'));
      const reply = store.append(
        mcp('a', null, {
          from: 'server',
          kind: 'response',
          replyTo: request.id,
        }),
      );
      const other = store.append(mcp('a', 'ping'));
      const listener = vi.fn();
      store.subscribe('a', listener);

      const next = store.append(mcp('a', 'ping'));

      expect(listener).toHaveBeenCalledWith({
        type: 'evicted',
        fact: request,
        attachment: reply,
      });
      expect(store.get(request.id)).toBeUndefined();
      expect(store.attachmentOf(request.id)).toBeUndefined();
      expect(idsOf(store.anchors({ server: 'a', limit: 10 }))).toEqual([
        next.id,
        other.id,
      ]);
      expect(store.countAnchors({ server: 'a' })).toBe(2);
    });

    it('reports an evicted attachment without one of its own', () => {
      const request = store.append(mcp('a', 'ping'));
      const reply = store.append(noReply('a', request.id));
      store.append(mcp('a', 'ping'));
      store.append(mcp('a', 'ping'));
      const events: LogEvent[] = [];
      store.subscribe('a', (event) => events.push(event));

      store.append(mcp('a', 'ping'));

      expect(events[0]).toEqual({
        type: 'evicted',
        fact: reply,
        attachment: undefined,
      });
      expect(store.attachmentOf(request.id)).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('drops one server`s facts and indexes and notifies', () => {
      const request = store.append(mcp('a', 'ping'));
      store.append(noReply('a', request.id));
      const kept = store.append(mcp('b', 'ping'));
      const listener = vi.fn();
      store.subscribe('a', listener);

      store.clear('a');

      expect(listener).toHaveBeenCalledExactlyOnceWith({ type: 'cleared' });
      expect(store.get(request.id)).toBeUndefined();
      expect(store.attachmentOf(request.id)).toBeUndefined();
      expect(store.anchors({ server: 'a', limit: 10 })).toEqual([]);
      expect(idsOf(store.anchors({ server: 'b', limit: 10 }))).toEqual([
        kept.id,
      ]);
      expect(store.lastId()).toBe(3);
    });

    it('keeps the ring buffer working afterwards', () => {
      store = createRingBufferLogStore(2);
      store.append(mcp('a', 'ping'));
      store.append(mcp('b', 'ping'));
      store.clear('a');

      store.append(mcp('b', 'one'));
      const last = store.append(mcp('b', 'two'));

      expect(store.anchors({ server: 'b', limit: 10 })[0]).toBe(last);
      expect(store.countAnchors({ server: 'b' })).toBe(2);
    });
  });

  describe('rename', () => {
    it('reassigns facts and keeps lookups consistent', () => {
      const request = store.append(mcp('old', 'ping'));
      const reply = store.append(noReply('old', request.id));
      store.append(mcp('other', 'ping'));

      store.rename('old', 'new');

      expect(store.anchors({ server: 'old', limit: 10 })).toEqual([]);
      expect(store.anchors({ server: 'new', limit: 10 })).toEqual([
        expect.objectContaining({ id: request.id, server: 'new' }),
      ]);
      expect(store.attachmentOf(request.id)).toEqual({
        ...reply,
        server: 'new',
      });
      expect(store.get(request.id)).toMatchObject({ server: 'new' });
      expect(idsOf(store.factsAfter('new', 0))).toEqual([request.id, reply.id]);
    });
  });

  describe('subscribe', () => {
    it('stops notifying after unsubscribing', () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe('a', listener);

      unsubscribe();
      store.append(mcp('a', 'ping'));

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('matches', () => {
  it('matches mcp facts by method and raw JSON, ignoring case', () => {
    const request: MCPFact = {
      id: 1,
      ...mcp('a', 'tools/call', { raw: '{"x":"Needle"}' }),
    };

    expect(matches(request, 'TOOLS')).toBe(true);
    expect(matches(request, 'needle')).toBe(true);
    expect(matches(request, 'other')).toBe(false);
  });

  it('matches everything with empty or missing text', () => {
    const request: MCPFact = { id: 1, ...mcp('a', 'ping') };

    expect(matches(request)).toBe(true);
    expect(matches(request, '')).toBe(true);
  });

  it('matches attachments only with empty text', () => {
    const end: HTTPEndFact = { id: 2, ...httpEnd('a', 1) };

    expect(matches(end, 'a')).toBe(false);
    expect(matches(end, '')).toBe(true);
  });
});
