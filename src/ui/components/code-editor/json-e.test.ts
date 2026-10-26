import { describe, expect, it } from 'vitest';

import { findJSONEHighlights } from './json-e';

const spans = (text: string) =>
  findJSONEHighlights(text).map(({ kind, offset, length }) => ({
    kind,
    text: text.slice(offset, offset + length),
  }));

describe('findJSONEHighlights', () => {
  it('finds operator keys, quotes included', () => {
    expect(spans('{"$if": "x", "then": 1, "else": 2}')).toEqual([
      { kind: 'operator', text: '"$if"' },
    ]);
  });

  it('finds interpolations in string values', () => {
    expect(spans('{"text": "Forecast for ${args.city}, ${1 + 2}"}')).toEqual([
      { kind: 'interpolation', text: '${args.city}' },
      { kind: 'interpolation', text: '${1 + 2}' },
    ]);
  });

  it('ignores the $$ and $${ escapes', () => {
    expect(spans('{"$$eval": "$${args.city} costs $$5"}')).toEqual([]);
  });

  it('finds syntax in nested templates and arrays', () => {
    expect(
      spans('{"content": [{"$map": "args.items", "each(x)": "${x}"}]}'),
    ).toEqual([
      { kind: 'operator', text: '"$map"' },
      { kind: 'interpolation', text: '${x}' },
    ]);
  });

  it('keeps braces and quoted strings inside an interpolation', () => {
    expect(spans('{"a": "${ {x: \'}\'}.x } tail"}')).toEqual([
      { kind: 'interpolation', text: "${ {x: '}'}.x }" },
    ]);
  });

  it('reaches the end of the string when an interpolation is unclosed', () => {
    expect(spans('{"a": "${args.city"}')).toEqual([
      { kind: 'interpolation', text: '${args.city' },
    ]);
  });

  it('highlights what parses in invalid JSON', () => {
    expect(spans('{"$eval": "args", ')).toEqual([
      { kind: 'operator', text: '"$eval"' },
    ]);
  });

  it('finds nothing in text that is not JSON', () => {
    expect(spans('')).toEqual([]);
  });
});
