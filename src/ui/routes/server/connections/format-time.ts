const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * A time relative to now, e.g. `5 minutes ago`, `in 2 hours` or `just now`.
 *
 * @param at - ISO timestamp.
 * @param now - Current time, in milliseconds since epoch.
 */
export function formatRelative(at: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(at).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.trunc(seconds / size), unit);
    }
  }
  return Math.abs(seconds) < 10
    ? 'just now'
    : relative.format(seconds, 'second');
}

/**
 * Local date and time to the second, e.g. `10/24/2026, 12:04:31 PM`.
 *
 * @param at - ISO timestamp.
 */
export function formatDateTime(at: string): string {
  return new Date(at).toLocaleString();
}
