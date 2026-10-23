import { memo, useEffect, useRef } from 'react';
import { twMerge } from 'tailwind-merge';

import { type LogEntry } from '@/shared/api';
import { tw } from '@/ui/tw';

import {
  formatTime,
  noteOf,
  shortSession,
  type LogTag,
  tagOf,
} from './log-format';

/** Props of `MessageList`. */
export type MessageListProps = {
  /** Entries to show, newest first. */
  entries: LogEntry[];
  /** Whether older entries are still to be loaded. */
  hasOlder: boolean;
  /** Whether an older page is loading. */
  loadingOlder: boolean;
  /** Id of the selected entry. */
  selectedId: number | null;
  /** Called when the end of the list nears the viewport and older entries exist. */
  onLoadOlder: () => void;
  /** Called with the id of a clicked row. */
  onSelect: (id: number) => void;
};

const grid = tw`grid w-full grid-cols-[104px_28px_minmax(0,1fr)_56px_64px_84px] items-center gap-2 px-4`;

const tagStyles: Record<LogTag, string> = {
  request: tw`bg-blue-100 text-blue-900`,
  result: tw`bg-green-50 text-green-900`,
  notify: tw`bg-paper-100 text-ink-700`,
  error: tw`bg-red-50 text-red-800`,
  invalid: tw`bg-red-50 text-red-800`,
};

/** How far before the end of the list older entries start loading. */
const LOAD_MARGIN = '600px';

/**
 * The message table: one button per entry, newest first. New rows appear at
 * the top; the browser keeps the position of a list scrolled further down.
 * Scrolling near the end asks for older entries.
 */
export function MessageList({
  entries,
  hasOlder,
  loadingOlder,
  selectedId,
  onLoadOlder,
  onSelect,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Observing again reports the current state, so a page that doesn't fill the
  // viewport keeps loading until it does.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasOlder || loadingOlder || sentinel === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((change) => change.isIntersecting)) {
          onLoadOlder();
        }
      },
      { root: scrollRef.current, rootMargin: LOAD_MARGIN },
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [entries.length, hasOlder, loadingOlder, onLoadOlder]);

  return (
    <div
      ref={scrollRef}
      className="relative max-h-[60dvh] min-h-80 overflow-auto lg:max-h-none lg:min-h-0 lg:flex-1"
    >
      <div className="min-w-140">
        <div
          className={twMerge(
            grid,
            'sticky top-0 z-10 min-h-8.5 border-b border-paper-100 bg-paper-50 text-xs font-semibold tracking-wide text-ink-500 uppercase',
          )}
        >
          <span>Time</span>
          <span>
            <span className="sr-only">Direction</span>
          </span>
          <span>Method</span>
          <span>ID</span>
          <span>Session</span>
          <span className="text-right">Took</span>
        </div>
        {entries.map((entry) => (
          <MessageRow
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedId}
            onSelect={onSelect}
          />
        ))}
        <div
          ref={sentinelRef}
          className="px-4 py-3 text-center text-xs text-ink-500"
        >
          {hasOlder
            ? loadingOlder
              ? 'Loading older messages…'
              : '\u00A0'
            : 'Start of log'}
        </div>
      </div>
    </div>
  );
}

type MessageRowProps = {
  entry: LogEntry;
  selected: boolean;
  onSelect: (id: number) => void;
};

const MessageRow = memo(function MessageRow({
  entry,
  selected,
  onSelect,
}: MessageRowProps) {
  const tag = tagOf(entry);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onSelect(entry.id);
      }}
      className={twMerge(
        grid,
        'min-h-10 cursor-pointer border-0 border-b border-solid border-paper-100 text-left font-sans text-[13px] text-ink-900 [contain-intrinsic-size:auto_40px] [content-visibility:auto]',
        selected
          ? 'bg-blue-50 shadow-[inset_3px_0_0_var(--color-blue-700)]'
          : 'bg-white hover:bg-blue-50/50',
      )}
    >
      <span className="font-mono text-ink-500">{formatTime(entry.at)}</span>
      <DirectionBadge direction={entry.direction} />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono font-medium">
          {entry.method ?? '(unknown)'}
        </span>
        <span
          className={twMerge(
            'flex-none rounded-sm px-1.5 py-0.5 text-[11px] font-semibold',
            tagStyles[tag],
          )}
        >
          {tag}
        </span>
        <span className="truncate text-xs text-ink-500">{noteOf(entry)}</span>
      </span>
      <span className="truncate font-mono text-ink-600">
        {entry.jsonrpcId ?? '—'}
      </span>
      <span
        className="font-mono text-ink-600"
        title={entry.sessionId ?? undefined}
      >
        {shortSession(entry.sessionId)}
      </span>
      <span className="text-right font-mono text-ink-600">
        {entry.durationMs === null ? '' : `${entry.durationMs} ms`}
      </span>
    </button>
  );
});

/** Props of `DirectionBadge`. */
export type DirectionBadgeProps = {
  /** `in` is client → server. */
  direction: LogEntry['direction'];
};

/** A small arrow badge: blue → for client → server, orange ← for server → client. */
export function DirectionBadge({ direction }: DirectionBadgeProps) {
  const incoming = direction === 'in';
  const label = incoming ? 'Client → server' : 'Server → client';
  return (
    <span
      title={label}
      className={twMerge(
        'inline-flex size-5.5 items-center justify-center rounded-md font-bold',
        incoming ? 'bg-blue-100 text-blue-700' : 'bg-orange-50 text-orange-800',
      )}
    >
      <span aria-hidden="true">{incoming ? '→' : '←'}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
