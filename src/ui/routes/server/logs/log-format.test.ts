import { describe, expect, it } from 'vitest';

import { type LogEntry } from '@/shared/api';

import {
  describeCapabilities,
  matchesSearch,
  negotiationOf,
  noteOf,
  pairOf,
  tagOf,
} from './log-format';

let nextId = 1;
const entry = (fields: Partial<LogEntry> & { raw: string }): LogEntry => ({
  id: nextId++,
  at: '2026-10-21T12:00:00.000Z',
  server: 'weather',
  sessionId: 's1',
  direction: 'in',
  kind: 'request',
  method: null,
  jsonrpcId: null,
  durationMs: null,
  ...fields,
});

const initialize = entry({
  method: 'initialize',
  jsonrpcId: 0,
  raw: JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: 'my-app', version: '0.3.1' },
    },
  }),
});
const initialized = entry({
  direction: 'out',
  kind: 'response',
  method: 'initialize',
  jsonrpcId: 0,
  durationMs: 8,
  raw: JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'decoy/weather', version: '0.1.0' },
    },
  }),
});

describe('tagOf', () => {
  it('names responses "result" and notifications "notify"', () => {
    expect(tagOf(initialized)).toBe('result');
    expect(tagOf(entry({ kind: 'notification', raw: '{}' }))).toBe('notify');
  });
});

describe('noteOf', () => {
  it('summarizes common messages', () => {
    expect(noteOf(initialize)).toBe('my-app 0.3.1');
    expect(noteOf(initialized)).toBe('protocol 2025-06-18');
    expect(
      noteOf(
        entry({
          method: 'tools/call',
          raw: '{"method":"tools/call","params":{"name":"get_forecast"}}',
        }),
      ),
    ).toBe('get_forecast');
    expect(
      noteOf(
        entry({
          kind: 'response',
          method: 'tools/list',
          raw: '{"result":{"tools":[{},{}]}}',
        }),
      ),
    ).toBe('2 tools');
    expect(
      noteOf(
        entry({
          kind: 'error',
          raw: '{"error":{"code":-32602,"message":"Unknown tool: x"}}',
        }),
      ),
    ).toBe('-32602 Unknown tool: x');
    expect(noteOf(entry({ kind: 'invalid', raw: '{nope' }))).toBe(
      'not JSON-RPC',
    );
  });
});

describe('pairOf', () => {
  it('finds the response of a request and the other way around', () => {
    const entries = [initialize, initialized];

    expect(pairOf(initialize, entries)).toBe(initialized);
    expect(pairOf(initialized, entries)).toBe(initialize);
  });

  it('ignores other sessions', () => {
    const other = { ...initialized, id: 999, sessionId: 's2' };

    expect(pairOf(initialize, [initialize, other])).toBeUndefined();
  });
});

describe('negotiationOf', () => {
  it('derives versions, client and capabilities from the initialize pair', () => {
    expect(negotiationOf('s1', [initialize, initialized])).toEqual({
      sessionId: 's1',
      requestedVersion: '2025-11-25',
      agreedVersion: '2025-06-18',
      client: 'my-app 0.3.1',
      clientCapabilities: { roots: { listChanged: true }, sampling: {} },
      serverCapabilities: { tools: { listChanged: true } },
    });
  });

  it('returns null when the initialize request is not loaded', () => {
    expect(negotiationOf('s1', [initialized])).toBeNull();
  });
});

describe('describeCapabilities', () => {
  it('lists capabilities with their true flags', () => {
    expect(
      describeCapabilities({ roots: { listChanged: true }, sampling: {} }),
    ).toBe('roots (listChanged), sampling');
    expect(describeCapabilities({})).toBe('none');
    expect(describeCapabilities(null)).toBe('unknown');
  });
});

describe('matchesSearch', () => {
  it('matches method and raw case-insensitively', () => {
    expect(matchesSearch(initialize, 'INITIALIZE')).toBe(true);
    expect(matchesSearch(initialize, 'my-app')).toBe(true);
    expect(matchesSearch(initialize, 'tools/call')).toBe(false);
    expect(matchesSearch(initialize, '  ')).toBe(true);
  });
});
