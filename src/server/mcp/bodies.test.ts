import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES } from '@/shared/api';

import { bodyOf, truncate } from './bodies';

describe('bodyOf', () => {
  it('parses JSON bodies', () => {
    expect(bodyOf('application/json', '{"a":[1]}')).toEqual({ a: [1] });
    expect(bodyOf('application/problem+json; charset=utf-8', '[]')).toEqual([]);
  });

  it('keeps JSON that does not parse as text', () => {
    expect(bodyOf('application/json', '{nope')).toBe('{nope');
  });

  it('decodes form bodies to an object', () => {
    expect(
      bodyOf('application/x-www-form-urlencoded', 'a=1&b=two%20words'),
    ).toEqual({ a: '1', b: 'two words' });
  });

  it('summarizes HTML bodies by their size in bytes', () => {
    expect(bodyOf('text/html; charset=utf-8', '<p>é</p>')).toBe(
      '(HTML, 9 bytes)',
    );
  });

  it('returns other bodies as text', () => {
    expect(bodyOf('text/plain', 'hello')).toBe('hello');
    expect(bodyOf(null, '{"a":1}')).toBe('{"a":1}');
  });
});

describe('truncate', () => {
  it('leaves a short text alone', () => {
    expect(truncate('hello')).toEqual({ text: 'hello', truncated: false });
  });

  it('keeps a text of exactly the limit', () => {
    const text = 'a'.repeat(MAX_BODY_BYTES);

    expect(truncate(text)).toEqual({ text, truncated: false });
  });

  it('cuts a longer text at the limit', () => {
    const result = truncate('a'.repeat(MAX_BODY_BYTES + 10));

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_BODY_BYTES);
  });

  it('does not leave half a character at the end', () => {
    const result = truncate('a'.repeat(MAX_BODY_BYTES - 1) + 'é');

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('a'.repeat(MAX_BODY_BYTES - 1));
  });
});
