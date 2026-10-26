import { describe, expect, it } from 'vitest';

import {
  type HTTPEndFact,
  type HTTPFact,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';

import { anchorIdOf, factsOf, reconcile } from './reconcile';

const base = {
  at: '2026-01-01T00:00:00.000Z',
  server: 'demo',
  sessionId: 's1',
};

const httpFact = (
  id: number,
  response: Partial<NonNullable<HTTPFact['response']>> | null,
): HTTPFact => ({
  ...base,
  id,
  type: 'http',
  endpoint: 'mcp',
  request: {
    method: 'POST',
    url: 'http://127.0.0.1:6280/s/demo/mcp',
    headers: {},
    truncated: false,
  },
  response:
    response === null
      ? null
      : {
          status: 200,
          headers: {},
          stream: false,
          truncated: false,
          ...response,
        },
  durationMs: 4,
});

const httpEnd = (
  id: number,
  exchange: number,
  state: HTTPEndFact['state'] = 'complete',
): HTTPEndFact => ({
  ...base,
  id,
  type: 'http-end',
  exchange,
  state,
  durationMs: 99,
  events: 2,
});

const mcpFact = (id: number, fields: Partial<MCPFact> = {}): MCPFact => ({
  ...base,
  id,
  type: 'mcp',
  from: 'client',
  kind: 'request',
  method: 'tools/list',
  jsonrpcId: 1,
  raw: '{}',
  truncated: false,
  carriedBy: null,
  sse: null,
  replyTo: null,
  durationMs: null,
  ...fields,
});

const reply = (id: number, replyTo: number): MCPFact =>
  mcpFact(id, {
    from: 'server',
    kind: 'response',
    method: null,
    replyTo,
    durationMs: 12.5,
  });

const noReply = (id: number, replyTo: number): NoReplyFact => ({
  ...base,
  id,
  type: 'no-reply',
  replyTo,
  reason: 'exchange-ended',
});

describe('anchorIdOf', () => {
  it('is null for anchors', () => {
    expect(anchorIdOf(httpFact(1, null))).toBeNull();
    expect(anchorIdOf(mcpFact(2))).toBeNull();
  });

  it('is the anchor id of attachments', () => {
    expect(anchorIdOf(httpEnd(3, 1))).toBe(1);
    expect(anchorIdOf(reply(4, 2))).toBe(2);
    expect(anchorIdOf(noReply(5, 2))).toBe(2);
  });
});

describe('reconcile', () => {
  describe('http', () => {
    it('is streaming while an event stream is open', () => {
      const entry = reconcile(httpFact(1, { stream: true }), []);

      expect(entry).toMatchObject({
        type: 'http',
        id: 1,
        end: null,
        state: 'streaming',
        durationMs: null,
      });
    });

    it('takes its state and duration from the end of a stream', () => {
      const end = httpEnd(2, 1, 'aborted');

      const entry = reconcile(httpFact(1, { stream: true }), [end]);

      expect(entry).toMatchObject({ end, state: 'aborted', durationMs: 99 });
    });

    it('is complete with the exchange duration without a stream', () => {
      const entry = reconcile(httpFact(1, {}), []);

      expect(entry).toMatchObject({ state: 'complete', durationMs: 4 });
    });

    it('is aborted when the client left before the headers', () => {
      const entry = reconcile(httpFact(1, null), []);

      expect(entry).toMatchObject({ state: 'aborted', durationMs: 4 });
    });

    it('ignores the end of another exchange', () => {
      const entry = reconcile(httpFact(1, { stream: true }), [httpEnd(3, 2)]);

      expect(entry).toMatchObject({ end: null, state: 'streaming' });
    });

    it('keeps the first of repeated ends', () => {
      const first = httpEnd(2, 1);

      const entry = reconcile(httpFact(1, { stream: true }), [
        first,
        httpEnd(3, 1, 'aborted'),
      ]);

      expect(entry).toMatchObject({ end: first, state: 'complete' });
    });
  });

  describe('mcp', () => {
    it('leaves a request without reply pending', () => {
      const entry = reconcile(mcpFact(1), []);

      expect(entry).toMatchObject({
        type: 'mcp',
        id: 1,
        reply: null,
        state: 'pending',
        durationMs: null,
      });
    });

    it('completes a request with its reply', () => {
      const answer = reply(2, 1);

      const entry = reconcile(mcpFact(1), [answer]);

      expect(entry).toMatchObject({
        reply: answer,
        state: 'complete',
        durationMs: 12.5,
      });
    });

    it('aborts a request that will get no reply', () => {
      const decision = noReply(2, 1);

      const entry = reconcile(mcpFact(1), [decision]);

      expect(entry).toMatchObject({
        reply: decision,
        state: 'aborted',
        durationMs: null,
      });
    });

    it('completes unpaired messages', () => {
      const notification = mcpFact(1, {
        kind: 'notification',
        jsonrpcId: null,
      });

      expect(reconcile(notification, [])).toMatchObject({
        reply: null,
        state: 'complete',
      });
    });

    it('ignores attachments of other anchors', () => {
      const entry = reconcile(mcpFact(1), [reply(5, 4), noReply(6, 4)]);

      expect(entry).toMatchObject({ reply: null, state: 'pending' });
    });

    it('keeps the first of repeated attachments', () => {
      const first = reply(2, 1);

      const entry = reconcile(mcpFact(1), [first, noReply(3, 1)]);

      expect(entry).toMatchObject({ reply: first, state: 'complete' });
    });
  });

  it('throws when the anchor is an attachment', () => {
    expect(() => reconcile(httpEnd(2, 1), [])).toThrow(TypeError);
    expect(() => reconcile(reply(2, 1), [])).toThrow(TypeError);
    expect(() => reconcile(noReply(2, 1), [])).toThrow(TypeError);
  });
});

describe('factsOf', () => {
  it('lists the anchor first, then its attachment', () => {
    const exchange = httpFact(1, { stream: true });
    const end = httpEnd(2, 1);
    const request = mcpFact(3);
    const answer = reply(4, 3);

    expect(factsOf(reconcile(exchange, [end]))).toEqual([exchange, end]);
    expect(factsOf(reconcile(request, [answer]))).toEqual([request, answer]);
  });

  it('lists only the anchor without an attachment', () => {
    const exchange = httpFact(1, { stream: true });
    const request = mcpFact(3);

    expect(factsOf(reconcile(exchange, []))).toEqual([exchange]);
    expect(factsOf(reconcile(request, []))).toEqual([request]);
  });
});
