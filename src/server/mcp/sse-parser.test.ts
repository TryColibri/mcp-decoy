import { describe, expect, it } from 'vitest';

import { createSSEParser, type SSEEvent } from './sse-parser';

const parseAll = (chunks: string[]): SSEEvent[] => {
  const parser = createSSEParser();
  return chunks.flatMap((chunk) => parser.feed(chunk));
};

const bytewise = (text: string): string[] => text.split('');

describe('createSSEParser', () => {
  describe('feed', () => {
    it('parses an event with id, event and data', () => {
      const events = parseAll(['id: 7\nevent: message\ndata: {"a":1}\n\n']);

      expect(events).toEqual([{ id: '7', event: 'message', data: '{"a":1}' }]);
    });

    it.each([
      ['LF', 'event: message\ndata: x\n\nid: 2\ndata: y\n\n'],
      ['CRLF', 'event: message\r\ndata: x\r\n\r\nid: 2\r\ndata: y\r\n\r\n'],
      ['CR', 'event: message\rdata: x\r\rid: 2\rdata: y\r\r'],
    ])('handles %s line breaks at every byte boundary', (_name, text) => {
      const expected: SSEEvent[] = [
        { id: null, event: 'message', data: 'x' },
        { id: '2', event: null, data: 'y' },
      ];

      expect(parseAll([text])).toEqual(expected);
      expect(parseAll(bytewise(text))).toEqual(expected);
    });

    it('joins multi-line data with newlines', () => {
      const events = parseAll(['data: one\ndata: two\ndata:three\n\n']);

      expect(events).toEqual([
        { id: null, event: null, data: 'one\ntwo\nthree' },
      ]);
    });

    it('reports events without data', () => {
      const events = parseAll(['id: prime\ndata:\n\nid: only-id\n\n']);

      expect(events).toEqual([
        { id: 'prime', event: null, data: '' },
        { id: 'only-id', event: null, data: null },
      ]);
    });

    it('skips comment-only blocks', () => {
      const text = ': keepalive\n\n: another\n: one\n\ndata: x\n\n';

      expect(parseAll([text])).toEqual([{ id: null, event: null, data: 'x' }]);
      expect(parseAll(bytewise(text))).toEqual([
        { id: null, event: null, data: 'x' },
      ]);
    });

    it('ignores comments inside an event', () => {
      const events = parseAll(['data: x\n: note\nid: 3\n\n']);

      expect(events).toEqual([{ id: '3', event: null, data: 'x' }]);
    });

    it('holds an incomplete event until its blank line arrives', () => {
      const parser = createSSEParser();

      expect(parser.feed('data: x\n')).toEqual([]);
      expect(parser.feed('\n')).toEqual([{ id: null, event: null, data: 'x' }]);
    });

    it('does not treat a CR LF split across chunks as two breaks', () => {
      const events = parseAll(['data: x\r', '\ndata: y\r\n\r', '\n']);

      expect(events).toEqual([{ id: null, event: null, data: 'x\ny' }]);
    });

    it('strips one leading space of a value only', () => {
      const events = parseAll(['data:  two\n\n']);

      expect(events).toEqual([{ id: null, event: null, data: ' two' }]);
    });

    it('counts a field without a colon as a field with an empty value', () => {
      const events = parseAll(['data\n\n']);

      expect(events).toEqual([{ id: null, event: null, data: '' }]);
    });
  });
});
