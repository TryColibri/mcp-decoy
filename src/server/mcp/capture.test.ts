import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type LogStore } from '@/server/logs';
import { type LogFact, MAX_BODY_BYTES } from '@/shared/api';

import { type BeginParams, type Capture, createCapture } from './capture';

const SERVER = 'demo';
const SESSION = 'sess-1';
const URL_MCP = `http://127.0.0.1:6280/s/${SERVER}/mcp`;

type Harness = {
  capture: Capture;
  facts: LogFact[];
  store: LogStore;
  /** Moves both clocks forward. */
  advance: (ms: number) => void;
};

const createHarness = (): Harness => {
  const facts: LogFact[] = [];
  let wall = Date.parse('2026-10-21T12:00:00.000Z');
  let monotonic = 1000;
  const store: LogStore = {
    append: vi.fn((fact) => {
      const stored: LogFact = { ...fact, id: facts.length + 1 };
      facts.push(stored);
      return stored;
    }),
    get: vi.fn((id) => facts.find((fact) => fact.id === id)),
    lastId: vi.fn(() => facts.length),
    attachmentOf: vi.fn(),
    anchors: vi.fn(() => []),
    countAnchors: vi.fn(() => 0),
    factsAfter: vi.fn(() => []),
    clear: vi.fn(),
    rename: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  };
  const capture = createCapture(store, {
    now: () => new Date(wall),
    monotonic: () => monotonic,
  });
  return {
    capture,
    facts,
    store,
    advance: (ms) => {
      wall += ms;
      monotonic += ms;
    },
  };
};

const post = (
  body: unknown,
  init: RequestInit = {},
  sessionId: string | null = SESSION,
): Request =>
  new Request(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId === null ? {} : { 'mcp-session-id': sessionId }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

const begin = (
  capture: Capture,
  request: Request,
  body: string | null,
  overrides: Partial<BeginParams> = {},
) =>
  capture.begin({
    servers: [SERVER],
    endpoint: 'mcp',
    request,
    body,
    ...overrides,
  });

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const encoder = new TextEncoder();

/** An event stream response the test pushes events into. */
const eventStream = (headers: Record<string, string> = {}) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'mcp-session-id': SESSION,
        ...headers,
      },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
};

const readAll = async (response: Response) => {
  await response.text();
};

const event = (message: unknown, extra = '') =>
  `${extra}data: ${JSON.stringify(message)}\n\n`;

const request = (id: number, method = 'tools/list') => ({
  jsonrpc: '2.0',
  id,
  method,
});
const result = (id: number | null, value: unknown = {}) => ({
  jsonrpc: '2.0',
  id,
  result: value,
});
const errorReply = (id: number | null) => ({
  jsonrpc: '2.0',
  id,
  error: { code: -32600, message: 'nope' },
});

const types = (facts: LogFact[]) => facts.map((fact) => fact.type);

describe('createCapture', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe('begin', () => {
    describe('fact order and content', () => {
      it('writes http, client mcp, server mcp, then http-end', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);
        const stream = eventStream();

        const response = await exchange.respond(stream.response);
        stream.push(event(result(1), 'id: 5\nevent: message\n'));
        stream.close();
        await readAll(response);

        expect(types(facts)).toEqual(['http', 'mcp', 'mcp', 'http-end']);
        expect(facts[1]).toMatchObject({ from: 'client', carriedBy: 1 });
        expect(facts[2]).toMatchObject({
          from: 'server',
          carriedBy: 1,
          sse: { id: '5', event: 'message' },
          replyTo: 2,
        });
        expect(facts[3]).toMatchObject({
          exchange: 1,
          state: 'complete',
          events: 1,
        });
      });

      it('stamps arrival time and takes the session from the response header', async () => {
        const { capture, facts, advance } = harness;
        const body = JSON.stringify(request(1, 'initialize'));
        const exchange = begin(capture, post(body, {}, null), body);

        advance(25);
        await exchange.respond(
          json(result(1), 200, { 'mcp-session-id': 'new-session' }),
        );

        expect(facts[0]).toMatchObject({
          type: 'http',
          at: '2026-10-21T12:00:00.000Z',
          sessionId: 'new-session',
          durationMs: 25,
          endpoint: 'mcp',
          request: { method: 'POST', url: URL_MCP, truncated: false },
          response: { status: 200, stream: false },
        });
        expect(facts[1]).toMatchObject({
          at: '2026-10-21T12:00:00.000Z',
          sessionId: 'new-session',
        });
        expect(facts[2]).toMatchObject({ from: 'server', sse: null });
      });

      it('falls back to the request session', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);

        await exchange.respond(new Response(null, { status: 202 }));

        expect(facts[0]).toMatchObject({ sessionId: SESSION });
      });

      it('stores the parsed request and response bodies', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);

        await exchange.respond(json({ ok: true }, 400));

        expect(facts[0]).toMatchObject({
          request: { body: request(1) },
          response: { status: 400, body: { ok: true } },
        });
      });
    });

    describe('client messages', () => {
      it('writes one fact per message of a batch', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify([
          request(1),
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ]);
        const exchange = begin(capture, post(body), body);

        await exchange.respond(new Response(null, { status: 202 }));

        expect(facts.slice(1, 3)).toMatchObject([
          { kind: 'request', method: 'tools/list', jsonrpcId: 1 },
          { kind: 'notification', method: 'notifications/initialized' },
        ]);
      });

      it('writes one invalid fact for a body that is not JSON', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post('not json'), 'not json');

        await exchange.respond(new Response(null, { status: 400 }));

        expect(facts[1]).toMatchObject({
          kind: 'invalid',
          method: null,
          raw: 'not json',
        });
      });

      it('writes no mcp facts for an oauth exchange', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body, {
          endpoint: 'oauth',
        });

        await exchange.respond(json({}));

        expect(types(facts)).toEqual(['http']);
        expect(facts[0]).toMatchObject({ endpoint: 'oauth' });
      });

      it('writes one http fact per server for an oauth fan-out', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null, {
          endpoint: 'oauth',
          servers: ['a', 'b'],
        });

        await exchange.respond(json({}));

        expect(facts).toMatchObject([
          { type: 'http', server: 'a' },
          { type: 'http', server: 'b' },
        ]);
      });

      it('writes nothing for an oauth exchange of no server', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null, {
          endpoint: 'oauth',
          servers: [],
        });

        await exchange.respond(json({}));

        expect(facts).toEqual([]);
      });
    });

    describe('pairing', () => {
      it('pairs a server reply with its client request', async () => {
        const { capture, facts, advance } = harness;
        const body = JSON.stringify(request(7));
        const exchange = begin(capture, post(body), body);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        advance(40);
        stream.push(event(result(7)));
        stream.close();
        await readAll(response);

        expect(facts[2]).toMatchObject({
          kind: 'response',
          replyTo: 2,
          durationMs: 40,
        });
      });

      it('pairs a client reply with a server request', async () => {
        const { capture, facts } = harness;
        const get = begin(
          capture,
          new Request(URL_MCP, {
            headers: { 'mcp-session-id': SESSION },
          }),
          null,
        );
        const stream = eventStream();
        const response = await get.respond(stream.response);
        stream.push(event({ jsonrpc: '2.0', id: 3, method: 'sampling/x' }));
        await response.body?.getReader().read();
        const body = JSON.stringify(result(3));
        const reply = begin(capture, post(body), body);

        await reply.respond(new Response(null, { status: 202 }));

        expect(facts.at(-1)).toMatchObject({
          from: 'client',
          kind: 'response',
          replyTo: 2,
        });
      });

      it('pairs an error with a null id with the only unanswered request', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);

        await exchange.respond(json(errorReply(null), 400));

        expect(facts[2]).toMatchObject({
          kind: 'error',
          jsonrpcId: null,
          replyTo: 2,
        });
        expect(types(facts)).not.toContain('no-reply');
      });

      it('does not guess among several unanswered requests', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify([request(1), request(2)]);
        const exchange = begin(capture, post(body), body);

        await exchange.respond(json(errorReply(null), 400));

        expect(facts[3]).toMatchObject({ kind: 'error', replyTo: null });
        expect(facts.filter((fact) => fact.type === 'no-reply')).toHaveLength(
          2,
        );
      });

      it('writes a duplicate reply as an unpaired anchor', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        stream.push(event(result(1)) + event(result(1)));
        stream.close();
        await readAll(response);

        expect(facts[2]).toMatchObject({ replyTo: 2 });
        expect(facts[3]).toMatchObject({ kind: 'response', replyTo: null });
      });

      it('writes a reply as an anchor when its request is gone', async () => {
        const { capture, facts, store } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);
        vi.mocked(store.get).mockReturnValue(undefined);

        stream.push(event(result(1)));
        stream.close();
        await readAll(response);

        expect(facts[2]).toMatchObject({ kind: 'response', replyTo: null });
        expect(facts.filter((fact) => fact.type === 'no-reply')).toEqual([]);
      });
    });

    describe('non-stream response bodies', () => {
      it('keeps a body that is not JSON-RPC only in response.body', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);

        await exchange.respond(
          json({ error: 'invalid_token' }, 401, {
            'www-authenticate': 'Bearer realm="mcp"',
          }),
        );

        expect(facts[0]).toMatchObject({
          response: { status: 401, body: { error: 'invalid_token' } },
        });
        expect(facts.filter((fact) => fact.type === 'mcp')).toHaveLength(1);
      });

      it('gives requests of a rejected body no reply', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);

        await exchange.respond(json({ error: 'invalid_token' }, 401));

        expect(facts.at(-1)).toMatchObject({
          type: 'no-reply',
          replyTo: 2,
          reason: 'exchange-ended',
        });
      });

      it('records a JSON-RPC error body as a server message', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);

        await exchange.respond(json({ jsonrpc: '2.0', method: 'x/y' }, 200));

        expect(facts[1]).toMatchObject({
          from: 'server',
          kind: 'notification',
          carriedBy: 1,
          sse: null,
        });
      });
    });

    describe('event streams', () => {
      it('ends complete on flush and counts events without data', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        stream.push('id: prime\ndata:\n\n');
        stream.push(event({ jsonrpc: '2.0', method: 'a/b' }));
        stream.close();
        await readAll(response);

        expect(facts.at(-1)).toMatchObject({
          type: 'http-end',
          state: 'complete',
          events: 2,
        });
        expect(facts.filter((fact) => fact.type === 'mcp')).toHaveLength(1);
      });

      it('does not count keepalive comments', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        stream.push(': keepalive\n\n');
        stream.close();
        await readAll(response);

        expect(facts.at(-1)).toMatchObject({ type: 'http-end', events: 0 });
      });

      it('ends aborted when the body is cancelled', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        await response.body?.cancel();

        expect(facts.at(-1)).toMatchObject({
          type: 'http-end',
          state: 'aborted',
        });
      });

      it('writes no end for an exchange whose http fact is gone', async () => {
        const { capture, facts, store } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);
        vi.mocked(store.get).mockReturnValue(undefined);

        stream.close();
        await readAll(response);

        expect(facts.filter((fact) => fact.type === 'http-end')).toEqual([]);
      });

      it('handles events split across chunks', async () => {
        const { capture, facts } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);
        const text = event({ jsonrpc: '2.0', method: 'a/b' });

        stream.push(text.slice(0, 10));
        stream.push(text.slice(10));
        stream.close();
        await readAll(response);

        expect(facts.filter((fact) => fact.type === 'mcp')).toHaveLength(1);
      });

      it('gives requests still pending when the stream ends no reply', async () => {
        const { capture, facts } = harness;
        const body = JSON.stringify(request(1));
        const exchange = begin(capture, post(body), body);
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        stream.close();
        await readAll(response);

        expect(facts.slice(-2)).toMatchObject([
          { type: 'http-end' },
          { type: 'no-reply', replyTo: 2, reason: 'exchange-ended' },
        ]);
      });
    });

    describe('open', () => {
      it('is true before respond and while a stream is open', async () => {
        const { capture } = harness;
        const exchange = begin(capture, post({}), null);
        const stream = eventStream();

        expect(exchange.open).toBe(true);
        const response = await exchange.respond(stream.response);
        expect(exchange.open).toBe(true);
        stream.close();
        await readAll(response);

        expect(exchange.open).toBe(false);
      });

      it('is false once a non-stream response is recorded', async () => {
        const { capture } = harness;
        const exchange = begin(capture, post({}), null);

        await exchange.respond(json({}));

        expect(exchange.open).toBe(false);
      });
    });

    describe('abort', () => {
      it('writes an exchange without response and no replies when the client leaves before respond', async () => {
        const { capture, facts } = harness;
        const controller = new AbortController();
        const body = JSON.stringify(request(1));
        const exchange = begin(
          capture,
          post(body, { signal: controller.signal }),
          body,
        );

        controller.abort();

        expect(types(facts)).toEqual(['http', 'mcp', 'no-reply']);
        expect(facts[0]).toMatchObject({ response: null });
        expect(exchange.open).toBe(false);
      });

      it('writes nothing on a respond that comes after an abort and cancels the body', async () => {
        const { capture, facts } = harness;
        const controller = new AbortController();
        const exchange = begin(
          capture,
          post({}, { signal: controller.signal }),
          null,
        );
        controller.abort();
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({ cancel }));

        const result = await exchange.respond(response);

        expect(result).toBe(response);
        expect(facts.filter((fact) => fact.type === 'http')).toHaveLength(1);
        expect(cancel).toHaveBeenCalledOnce();
      });

      it('writes http-end aborted when the client leaves while streaming and the body is never cancelled', async () => {
        const { capture, facts } = harness;
        const controller = new AbortController();
        const exchange = begin(
          capture,
          post({}, { signal: controller.signal }),
          null,
        );
        const stream = eventStream();
        await exchange.respond(stream.response);

        controller.abort();

        expect(facts.filter((fact) => fact.type === 'http-end')).toMatchObject([
          { state: 'aborted' },
        ]);
        expect(exchange.open).toBe(false);
      });

      it('writes one end when flush races an abort', async () => {
        const { capture, facts } = harness;
        const controller = new AbortController();
        const exchange = begin(
          capture,
          post({}, { signal: controller.signal }),
          null,
        );
        const stream = eventStream();
        const response = await exchange.respond(stream.response);

        stream.close();
        controller.abort();
        await readAll(response);
        await response.body?.cancel().catch(() => {});

        expect(facts.filter((fact) => fact.type === 'http-end')).toHaveLength(
          1,
        );
      });
    });

    describe('truncation', () => {
      it('cuts a long message and flags it', async () => {
        const { capture, facts } = harness;
        const big = {
          jsonrpc: '2.0',
          method: 'x',
          params: 'a'.repeat(MAX_BODY_BYTES),
        };
        const body = JSON.stringify(big);
        const exchange = begin(capture, post(body), body);

        await exchange.respond(new Response(null, { status: 202 }));

        expect(facts[0]).toMatchObject({ request: { truncated: true } });
        expect(facts[1]).toMatchObject({ truncated: true });
        expect(facts[1]).toMatchObject({
          raw: expect.stringMatching(/^\{"jsonrpc":"2.0","method":"x"/),
        });
      });
    });
  });

  describe('undelivered', () => {
    it('writes a server message that was never carried', () => {
      const { capture, facts } = harness;

      capture.undelivered(
        { server: SERVER, sessionId: SESSION },
        { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
      );

      expect(facts).toMatchObject([
        {
          type: 'mcp',
          from: 'server',
          kind: 'notification',
          carriedBy: null,
          sse: null,
          sessionId: SESSION,
        },
      ]);
    });
  });

  describe('forgetSession', () => {
    const openRequest = async (id: number, withStream: boolean) => {
      const { capture } = harness;
      const body = JSON.stringify(request(id));
      const exchange = begin(capture, post(body), body);
      if (!withStream) {
        await exchange.respond(new Response(null, { status: 202 }));
        return { exchange };
      }
      const stream = eventStream();
      const response = await exchange.respond(stream.response);
      return { exchange, stream, response };
    };

    it('writes no-reply for pending requests of the session', async () => {
      const { capture, facts } = harness;
      const get = begin(capture, new Request(URL_MCP), null);
      const stream = eventStream();
      const response = await get.respond(stream.response);
      stream.push(event({ jsonrpc: '2.0', id: 9, method: 'sampling/x' }));
      await response.body?.getReader().read();

      capture.forgetSession(SERVER, SESSION);

      expect(facts.at(-1)).toMatchObject({
        type: 'no-reply',
        replyTo: 2,
        reason: 'session-closed',
      });
    });

    it('does not touch other sessions', async () => {
      const { capture, facts } = harness;
      const body = JSON.stringify(request(1));
      await begin(capture, post(body, {}, 'other'), body).respond(
        new Response(null, { status: 202 }),
      );
      const before = facts.length;

      capture.forgetSession(SERVER, SESSION);

      expect(facts).toHaveLength(before);
    });

    it('leaves requests of an open exchange to that exchange', async () => {
      const { capture, facts } = harness;
      const { stream, response } = await openRequest(1, true);

      capture.forgetSession(SERVER, SESSION);

      expect(facts.filter((fact) => fact.type === 'no-reply')).toEqual([]);

      stream?.close();
      await readAll(response ?? new Response());

      expect(facts.filter((fact) => fact.type === 'no-reply')).toMatchObject([
        { replyTo: 2, reason: 'session-closed' },
      ]);
      capture.forgetSession(SERVER, SESSION);
      expect(facts.filter((fact) => fact.type === 'no-reply')).toHaveLength(1);
    });

    it('writes nothing once the exchange wrote its no-reply', async () => {
      const { capture, facts } = harness;
      const { stream, response } = await openRequest(1, true);
      stream?.close();
      await readAll(response ?? new Response());
      const before = facts.length;

      capture.forgetSession(SERVER, SESSION);

      expect(facts).toHaveLength(before);
    });

    it('does not end a request that reuses a JSON-RPC id of another fact', async () => {
      const { capture, facts } = harness;
      const first = JSON.stringify(request(1));
      const one = begin(capture, post(first), first);
      const streamOne = eventStream();
      const responseOne = await one.respond(streamOne.response);
      const second = JSON.stringify(request(1));
      const two = begin(capture, post(second), second);
      const streamTwo = eventStream();
      const responseTwo = await two.respond(streamTwo.response);

      streamOne.close();
      await readAll(responseOne);

      expect(facts.filter((fact) => fact.type === 'no-reply')).toEqual([]);

      streamTwo.close();
      await readAll(responseTwo);

      expect(facts.filter((fact) => fact.type === 'no-reply')).toMatchObject([
        { replyTo: 4 },
      ]);
    });
  });
});
