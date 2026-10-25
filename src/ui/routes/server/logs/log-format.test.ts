import { describe, expect, it } from 'vitest';

import {
  errorFact,
  httpEndFact,
  httpEntry,
  httpFact,
  mcpEntry,
  mcpFact,
  noReplyFact,
  replyFact,
} from './log-fixtures';
import {
  atOf,
  nameOf,
  noteOf,
  prettyBody,
  sessionOf,
  statusOf,
  tookOf,
  typeOf,
} from './log-format';

const request = (method: string, params: unknown = {}) =>
  mcpFact({
    method,
    jsonrpcId: 1,
    raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

const unpaired = (
  from: 'client' | 'server',
  kind: 'notification' | 'response' | 'error' | 'invalid',
  raw = '{}',
) =>
  mcpEntry(
    mcpFact({
      from,
      kind,
      method: kind === 'notification' ? 'notifications/x' : null,
      jsonrpcId: kind === 'notification' ? null : 7,
      raw,
    }),
  );

const oauthExchange = (
  path: string,
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  },
  method = 'POST',
) =>
  httpEntry(
    httpFact({
      endpoint: 'oauth',
      request: {
        method,
        url: `http://127.0.0.1:6280${path}`,
        headers: {},
        truncated: false,
      },
      response: {
        headers: {},
        stream: false,
        truncated: false,
        ...response,
      },
    }),
  );

describe('typeOf', () => {
  it('names exchanges by endpoint', () => {
    expect(typeOf(httpEntry(httpFact()))).toBe('http');
    expect(typeOf(oauthExchange('/token', { status: 200 }))).toBe('oauth');
  });

  it('names pairs by who sent the request', () => {
    expect(typeOf(mcpEntry(mcpFact()))).toBe('request');
    expect(typeOf(mcpEntry(mcpFact({ from: 'server' })))).toBe(
      'server request',
    );
  });

  it('names unpaired messages by sender and kind', () => {
    expect(typeOf(unpaired('client', 'notification'))).toBe('client notify');
    expect(typeOf(unpaired('server', 'notification'))).toBe('server notify');
    expect(typeOf(unpaired('client', 'response'))).toBe('client result');
    expect(typeOf(unpaired('server', 'response'))).toBe('server result');
    expect(typeOf(unpaired('client', 'error'))).toBe('client error');
    expect(typeOf(unpaired('server', 'error'))).toBe('server error');
    expect(typeOf(unpaired('client', 'invalid'))).toBe('invalid');
  });
});

describe('nameOf', () => {
  it('shows the method and path of an exchange', () => {
    const entry = httpEntry(
      httpFact({
        request: {
          method: 'POST',
          url: 'http://127.0.0.1:6280/s/demo/mcp?x=1',
          headers: {},
          truncated: false,
        },
      }),
    );

    expect(nameOf(entry)).toBe('POST /s/demo/mcp');
  });

  it('shows the method of a message, or #id for a reply without request', () => {
    expect(nameOf(mcpEntry(request('tools/call')))).toBe('tools/call');
    expect(nameOf(unpaired('server', 'response'))).toBe('#7');
    expect(nameOf(unpaired('client', 'invalid'))).toBe('#7');
  });
});

describe('statusOf', () => {
  it('colors status codes', () => {
    expect(statusOf(oauthExchange('/a', { status: 201 }))).toEqual({
      label: '201',
      tone: 'ok',
    });
    expect(statusOf(oauthExchange('/a', { status: 302 }))).toEqual({
      label: '302',
      tone: 'neutral',
    });
    expect(statusOf(oauthExchange('/a', { status: 401 }))).toEqual({
      label: '401',
      tone: 'error',
    });
    expect(statusOf(oauthExchange('/a', { status: 500 }))).toEqual({
      label: '500',
      tone: 'error',
    });
  });

  it('is `no response` without a response and `streaming` while open', () => {
    expect(statusOf(httpEntry(httpFact({ response: null })))).toEqual({
      label: 'no response',
      tone: 'error',
    });
    expect(statusOf(httpEntry(httpFact()))).toEqual({
      label: 'streaming',
      tone: 'pending',
    });
  });

  it('shows the status code of a stream that ended', () => {
    const exchange = httpFact();

    expect(statusOf(httpEntry(exchange, httpEndFact(exchange)))).toEqual({
      label: '200',
      tone: 'ok',
    });
  });

  describe('of a pair', () => {
    it('is pending until answered', () => {
      expect(statusOf(mcpEntry(request('tools/list')))).toEqual({
        label: 'pending',
        tone: 'pending',
      });
    });

    it('is ok for a result', () => {
      const message = request('tools/list');

      expect(statusOf(mcpEntry(message, replyFact(message, {})))).toEqual({
        label: 'ok',
        tone: 'ok',
      });
    });

    it('is red for an error and for isError', () => {
      const message = request('tools/call');

      expect(
        statusOf(mcpEntry(message, errorFact(message, -32602, 'bad'))),
      ).toEqual({ label: 'error -32602', tone: 'error' });
      expect(
        statusOf(mcpEntry(message, replyFact(message, { isError: true }))),
      ).toEqual({ label: 'isError', tone: 'error' });
    });

    it('is `no response` when no reply will come', () => {
      const message = request('tools/list');

      expect(statusOf(mcpEntry(message, noReplyFact(message)))).toEqual({
        label: 'no response',
        tone: 'error',
      });
    });
  });

  describe('of an unpaired message', () => {
    it('is `not sent` when no exchange carried it', () => {
      expect(statusOf(unpaired('server', 'notification'))).toEqual({
        label: 'not sent',
        tone: 'error',
      });
    });

    it('is blank when an exchange carried it', () => {
      const entry = mcpEntry(
        mcpFact({ kind: 'notification', method: 'n/x', carriedBy: 3 }),
      );

      expect(statusOf(entry)).toEqual({ label: '', tone: 'neutral' });
    });
  });
});

describe('tookOf', () => {
  it('shows the duration, or streaming, or nothing', () => {
    const message = request('tools/list');
    const exchange = httpFact();

    expect(tookOf(mcpEntry(message, replyFact(message, {})))).toBe('12 ms');
    expect(tookOf(httpEntry(exchange))).toBe('streaming');
    expect(tookOf(httpEntry(exchange, httpEndFact(exchange)))).toBe('5000 ms');
    expect(tookOf(mcpEntry(message))).toBe('');
  });
});

describe('atOf and sessionOf', () => {
  it('read the anchor fact', () => {
    const entry = httpEntry(httpFact({ sessionId: 'abc' }));

    expect(atOf(entry)).toBe('2026-10-21T12:00:00.000Z');
    expect(sessionOf(entry)).toBe('abc');
  });
});

describe('noteOf', () => {
  it('summarizes initialize from the request and its reply together', () => {
    const message = request('initialize', {
      clientInfo: { name: 'my-app', version: '0.3.1' },
    });

    expect(noteOf(mcpEntry(message))).toBe('my-app 0.3.1');
    expect(
      noteOf(
        mcpEntry(
          message,
          replyFact(message, { protocolVersion: '2025-06-18' }),
        ),
      ),
    ).toBe('my-app 0.3.1 · protocol 2025-06-18');
  });

  it('shows the tool of a call and the tool count of a list', () => {
    const call = request('tools/call', { name: 'get_forecast' });
    const list = request('tools/list');

    expect(noteOf(mcpEntry(call))).toBe('get_forecast');
    expect(noteOf(mcpEntry(list))).toBe('');
    expect(noteOf(mcpEntry(list, replyFact(list, { tools: [{}, {}] })))).toBe(
      '2 tools',
    );
    expect(noteOf(mcpEntry(list, replyFact(list, { tools: [{}] })))).toBe(
      '1 tool',
    );
  });

  it('shows the error of a reply, or why there is none', () => {
    const message = request('tools/call', { name: 'x' });

    expect(
      noteOf(mcpEntry(message, errorFact(message, -32602, 'Unknown tool: x'))),
    ).toBe('-32602 Unknown tool: x');
    expect(noteOf(mcpEntry(message, noReplyFact(message)))).toBe(
      'exchange ended',
    );
    expect(
      noteOf(mcpEntry(message, noReplyFact(message, 'session-closed'))),
    ).toBe('session closed');
  });

  it('shows the error of an unpaired error and flags invalid messages', () => {
    expect(
      noteOf(
        unpaired(
          'server',
          'error',
          '{"error":{"code":-32600,"message":"nope"}}',
        ),
      ),
    ).toBe('-32600 nope');
    expect(noteOf(unpaired('client', 'invalid', '{nope'))).toBe('not JSON-RPC');
  });

  it('adds the events of an ended stream to an exchange', () => {
    const exchange = httpFact();

    expect(noteOf(httpEntry(exchange))).toBe('');
    expect(
      noteOf(httpEntry(exchange, httpEndFact(exchange, { events: 1 }))),
    ).toBe('1 event');
    expect(noteOf(httpEntry(exchange, httpEndFact(exchange)))).toBe('3 events');
  });

  describe('of an OAuth exchange', () => {
    it('summarizes the response', () => {
      expect(
        noteOf(
          oauthExchange('/s/x/mcp', {
            status: 401,
            body: { error: 'invalid_token' },
          }),
        ),
      ).toBe('invalid_token');
      expect(noteOf(oauthExchange('/authorize', { status: 200 }, 'GET'))).toBe(
        'consent page',
      );
      expect(
        noteOf(
          oauthExchange('/consent/abc', {
            status: 302,
            headers: { location: 'http://cb?code=xyz&state=s' },
          }),
        ),
      ).toBe('approved');
      expect(
        noteOf(
          oauthExchange('/consent/abc', {
            status: 302,
            headers: { location: 'http://cb?error=access_denied' },
          }),
        ),
      ).toBe('denied');
      expect(
        noteOf(
          oauthExchange('/register', {
            status: 201,
            body: { client_name: 'Claude' },
          }),
        ),
      ).toBe('client "Claude"');
    });

    it('has no note without a response', () => {
      expect(
        noteOf(httpEntry(httpFact({ endpoint: 'oauth', response: null }))),
      ).toBe('');
    });
  });
});

describe('prettyBody', () => {
  it('keeps text as it is', () => {
    expect(prettyBody('(HTML, 12 bytes)')).toBe('(HTML, 12 bytes)');
  });

  it('pretty-prints anything else as JSON', () => {
    expect(prettyBody({ grant_type: 'authorization_code' })).toBe(
      '{\n  "grant_type": "authorization_code"\n}',
    );
    expect(prettyBody([1])).toBe('[\n  1\n]');
  });
});
