import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor';

describe('encodeCursor', () => {
  it('produces an 11-character base64url string', () => {
    expect(encodeCursor(42)).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});

describe('decodeCursor', () => {
  it('round-trips encodeCursor', () => {
    for (const id of [0, 1, 500, Number.MAX_SAFE_INTEGER]) {
      expect(decodeCursor(encodeCursor(id))).toBe(id);
    }
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('nope')).toBeNull();
    expect(decodeCursor('!!!!!!!!!!!')).toBeNull();
    expect(decodeCursor('__________8')).toBeNull();
  });
});
