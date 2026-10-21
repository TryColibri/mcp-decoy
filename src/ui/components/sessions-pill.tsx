/** Props of `SessionsPill`. */
export type SessionsPillProps = {
  /** Number of live MCP sessions. */
  count: number;
  /** Spell out "live sessions" instead of "live". */
  long?: boolean;
};

/** A pill showing live MCP sessions: green when any, grey otherwise. */
export function SessionsPill({ count, long = false }: SessionsPillProps) {
  const live = count > 0;
  const noun = count === 1 ? 'live session' : 'live sessions';
  const text = long ? `${count} ${noun}` : live ? `${count} live` : '0';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium ${
        live ? 'bg-success-bg text-success' : 'bg-neutral-bg text-ink-3'
      }`}
    >
      {text}
    </span>
  );
}

/** Props of `StatusDot`. */
export type StatusDotProps = {
  /** Green when live, grey otherwise. */
  live: boolean;
};

/** An 8px status dot. Decorative: pair it with text. */
export function StatusDot({ live }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${
        live ? 'bg-live' : 'bg-ink-faint'
      }`}
    />
  );
}
