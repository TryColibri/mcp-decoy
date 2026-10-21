import { useLayoutEffect, useRef } from 'react';

import { type LogEntry } from '@/shared/api';

import {
  formatTime,
  noteOf,
  shortSession,
  type LogTag,
  tagOf,
} from './log-format';

/** Props of `MessageList`. */
export type MessageListProps = {
  /** Entries to show, oldest first. */
  entries: LogEntry[];
  /** Id of the selected entry. */
  selectedId: number | null;
  /** Called with the id of a clicked row. */
  onSelect: (id: number) => void;
  /** Keep the newest row in view when already scrolled to the bottom. */
  follow: boolean;
};

const grid =
  'grid w-full grid-cols-[104px_28px_minmax(0,1fr)_56px_64px_84px] items-center gap-2 px-4';

const tagStyles: Record<LogTag, string> = {
  request: 'bg-in-bg text-in-tag',
  result: 'bg-success-bg text-success',
  notify: 'bg-neutral-bg text-ink-2',
  error: 'bg-error-bg text-error',
  invalid: 'bg-error-bg text-error',
};

/** How close to the bottom counts as "at the bottom", in pixels. */
const BOTTOM_SLACK = 24;

/** The message table: one button per entry. */
export function MessageList({
  entries,
  selectedId,
  onSelect,
  follow,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const onScroll = () => {
    const element = scrollRef.current;
    if (element !== null) {
      atBottomRef.current =
        element.scrollHeight - element.scrollTop - element.clientHeight <=
        BOTTOM_SLACK;
    }
  };

  const lastId = entries.at(-1)?.id;
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (follow && atBottomRef.current && element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [follow, lastId]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="max-h-[calc(100dvh-235px)] min-h-80 overflow-auto"
    >
      <div className="min-w-[560px]">
        <div
          className={`${grid} sticky top-0 z-10 min-h-[34px] border-b border-line-soft bg-subtle text-xs font-semibold tracking-wide text-ink-4 uppercase`}
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
      </div>
    </div>
  );
}

type MessageRowProps = {
  entry: LogEntry;
  selected: boolean;
  onSelect: (id: number) => void;
};

function MessageRow({ entry, selected, onSelect }: MessageRowProps) {
  const tag = tagOf(entry);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onSelect(entry.id);
      }}
      className={`${grid} min-h-10 cursor-pointer border-0 border-b border-solid border-line-soft text-left font-sans text-[13px] text-ink ${
        selected
          ? 'bg-selected shadow-[inset_3px_0_0_var(--color-link)]'
          : 'bg-surface hover:bg-row-hover'
      }`}
    >
      <span className="font-mono text-ink-4">{formatTime(entry.at)}</span>
      <DirectionBadge direction={entry.direction} />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono font-medium">
          {entry.method ?? '(unknown)'}
        </span>
        <span
          className={`flex-none rounded px-1.5 py-0.5 text-[11px] font-semibold ${tagStyles[tag]}`}
        >
          {tag}
        </span>
        <span className="truncate text-xs text-ink-4">{noteOf(entry)}</span>
      </span>
      <span className="truncate font-mono text-ink-3">
        {entry.jsonrpcId ?? '—'}
      </span>
      <span
        className="font-mono text-ink-3"
        title={entry.sessionId ?? undefined}
      >
        {shortSession(entry.sessionId)}
      </span>
      <span className="text-right font-mono text-ink-3">
        {entry.durationMs === null ? '' : `${entry.durationMs} ms`}
      </span>
    </button>
  );
}

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
      className={`inline-flex size-[22px] items-center justify-center rounded-md font-bold ${
        incoming ? 'bg-in-bg text-in' : 'bg-out-bg text-out'
      }`}
    >
      <span aria-hidden="true">{incoming ? '→' : '←'}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
