import { describe, expect, it } from 'vitest';

import { formatRelative } from './format-time';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');

describe('formatRelative', () => {
  it('says "just now" within ten seconds', () => {
    expect(formatRelative('2026-10-24T11:59:55.000Z', NOW)).toBe('just now');
  });

  it('counts seconds, minutes, hours and days in the past', () => {
    expect(formatRelative('2026-10-24T11:59:30.000Z', NOW)).toBe(
      '30 seconds ago',
    );
    expect(formatRelative('2026-10-24T11:55:00.000Z', NOW)).toBe(
      '5 minutes ago',
    );
    expect(formatRelative('2026-10-24T09:00:00.000Z', NOW)).toBe('3 hours ago');
    expect(formatRelative('2026-10-22T12:00:00.000Z', NOW)).toBe('2 days ago');
  });

  it('counts into the future', () => {
    expect(formatRelative('2026-10-24T13:00:00.000Z', NOW)).toBe('in 1 hour');
  });
});
