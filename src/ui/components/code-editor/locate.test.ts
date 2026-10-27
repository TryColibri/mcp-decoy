import { describe, expect, it } from 'vitest';

import { rangeOf } from './locate';

const text = '{\n  "properties": 1,\n  "list": [10, 20]\n}';

const slice = (path: Array<string | number>) => {
  const { offset, length } = rangeOf(text, path);
  return text.slice(offset, offset + length);
};

describe('rangeOf', () => {
  it('finds the value of a property', () => {
    expect(slice(['properties'])).toBe('1');
  });

  it('finds an array item', () => {
    expect(slice(['list', 1])).toBe('20');
  });

  it('finds the root with an empty path', () => {
    expect(slice([])).toBe(text);
  });

  it('falls back to the closest ancestor of a missing path', () => {
    expect(slice(['list', 5])).toBe('[10, 20]');
    expect(slice(['missing', 'deeper'])).toBe(text);
  });

  it('covers the whole text when it is not JSON', () => {
    expect(rangeOf('', ['a'])).toEqual({ offset: 0, length: 0 });
  });
});
