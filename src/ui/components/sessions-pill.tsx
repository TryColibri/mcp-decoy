import { type ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';

/** Props of `SessionsPill`. */
export type SessionsPillProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Number of live MCP sessions. */
  count: number;
  /** Spell out "live sessions" instead of "live". */
  long?: boolean;
};

/**
 * A pill showing live MCP sessions: green when any, grey otherwise.
 * `className` is merged over the pill styles; `ref` is the `<span>`.
 */
export function SessionsPill({
  count,
  long = false,
  className,
  ...props
}: SessionsPillProps) {
  const live = count > 0;
  const noun = count === 1 ? 'live session' : 'live sessions';
  const text = long ? `${count} ${noun}` : live ? `${count} live` : '0';
  return (
    <span
      {...props}
      className={twMerge(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-medium',
        live ? 'bg-success-bg text-success' : 'bg-neutral-bg text-ink-3',
        className,
      )}
    >
      {text}
    </span>
  );
}

/** Props of `StatusDot`. */
export type StatusDotProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Green when live, grey otherwise. */
  live: boolean;
};

/**
 * An 8px status dot. Decorative: pair it with text. `className` is merged over
 * the dot styles; `ref` is the `<span>`.
 */
export function StatusDot({ live, className, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={twMerge(
        'inline-block size-2 shrink-0 rounded-full',
        live ? 'bg-live' : 'bg-ink-faint',
        className,
      )}
    />
  );
}
