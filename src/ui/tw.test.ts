import { describe, expect, it } from 'vitest';

import { tw } from './tw';

describe('tw', () => {
  it('returns the literal text when there is nothing to interpolate', () => {
    expect(tw`flex items-center`).toBe('flex items-center');
  });

  it('interpolates values like an untagged template', () => {
    const base = 'rounded-lg border';

    expect(tw`${base} px-3 ${'text-sm'}`).toBe(
      'rounded-lg border px-3 text-sm',
    );
  });
});
