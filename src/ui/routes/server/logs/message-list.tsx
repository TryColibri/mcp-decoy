import { type ComponentProps, memo, useEffect, useRef } from 'react';
import { twMerge } from 'tailwind-merge';

import { type LogEntry } from '@/shared/api';
import { tw } from '@/ui/tw';

import {
  atOf,
  formatTime,
  nameOf,
  noteOf,
  type EntryStatus,
  sessionOf,
  shortSession,
  statusOf,
  type StatusTone,
  tookOf,
  type LogType,
  typeOf,
} from './log-format';

/**
 * Which columns the table shows: `full` is the whole table, `compact` only
 * Time and Method, next to the detail pane.
 */
export type MessageListLayout = 'full' | 'compact';

/** Props of `MessageList`. */
export type MessageListProps = {
  /** Columns to show. */
  layout: MessageListLayout;
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

const grids: Record<MessageListLayout, string> = {
  full: tw`grid w-full grid-cols-[104px_44px_104px_minmax(0,1.4fr)_92px_minmax(0,1fr)_56px_84px] items-center gap-2 px-4`,
  compact: tw`grid w-full grid-cols-[104px_minmax(0,1fr)] items-center gap-2 px-4`,
};

const typeStyles: Record<LogType, string> = {
  http: tw`bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-300`,
  oauth: tw`bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-300`,
  request: tw`bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300`,
  'server request': tw`bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300`,
  'client notify': tw`bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300`,
  'server notify': tw`bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300`,
  'client result': tw`bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-300`,
  'server result': tw`bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-300`,
  'client error': tw`bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-400`,
  'server error': tw`bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-400`,
  invalid: tw`bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300`,
};

const layerStyles: Record<LogEntry['type'], string> = {
  http: tw`bg-purple-50 text-purple-900 dark:bg-purple-950 dark:text-purple-300`,
  mcp: tw`bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-300`,
};

const methodStyle = tw`bg-paper-100 text-ink-700 dark:bg-paper-800 dark:text-ink-200`;

const statusTextStyles: Record<StatusTone, string> = {
  ok: tw`text-green-900 dark:text-green-300`,
  error: tw`text-red-800 dark:text-red-400`,
  neutral: tw`text-ink-600 dark:text-ink-300`,
  pending: tw`text-ink-500 dark:text-ink-400`,
};

const statusDotStyles: Record<StatusTone, string> = {
  ok: tw`bg-green-700 dark:bg-green-500`,
  error: tw`bg-red-700 dark:bg-red-500`,
  neutral: tw`bg-ink-400 dark:bg-ink-600`,
  pending: tw`bg-paper-300 dark:bg-paper-700`,
};

/** How far before the end of the list older entries start loading. */
const LOAD_MARGIN = '600px';

/**
 * The message table: one button per entry, newest first. New rows appear at
 * the top; the browser keeps the position of a list scrolled further down.
 * Scrolling near the end asks for older entries.
 */
export function MessageList({
  layout,
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
      <div className={layout === 'full' ? 'min-w-220' : undefined}>
        <div
          className={twMerge(
            grids[layout],
            'sticky top-0 z-10 min-h-8.5 border-b border-paper-100 bg-paper-50 text-xs font-semibold tracking-wide text-ink-500 uppercase dark:border-paper-800 dark:bg-paper-950 dark:text-ink-400',
          )}
        >
          <span>Time</span>
          {layout === 'full' && (
            <>
              <span>Layer</span>
              <span>Kind</span>
            </>
          )}
          <span>Name</span>
          {layout === 'full' && (
            <>
              <span>Status</span>
              <span>Summary</span>
              <span>Session</span>
              <span className="text-right">Took</span>
            </>
          )}
        </div>
        {entries.map((entry) => (
          <MessageRow
            key={entry.id}
            layout={layout}
            entry={entry}
            selected={entry.id === selectedId}
            onSelect={onSelect}
          />
        ))}
        <div
          ref={sentinelRef}
          className="px-4 py-3 text-center text-xs text-ink-500 dark:text-ink-400"
        >
          {hasOlder
            ? loadingOlder
              ? 'Loading older entries…'
              : '\u00A0'
            : 'Start of log'}
        </div>
      </div>
    </div>
  );
}

type MessageRowProps = {
  layout: MessageListLayout;
  entry: LogEntry;
  selected: boolean;
  onSelect: (id: number) => void;
};

const MessageRow = memo(function MessageRow({
  layout,
  entry,
  selected,
  onSelect,
}: MessageRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onSelect(entry.id);
      }}
      className={twMerge(
        grids[layout],
        'min-h-10 cursor-pointer border-0 border-b border-solid border-paper-100 text-left font-sans text-[13px] text-ink-900 [contain-intrinsic-size:auto_40px] [content-visibility:auto] dark:border-paper-800 dark:text-ink-100',
        selected
          ? 'bg-blue-50 shadow-[inset_3px_0_0_var(--color-blue-700)] dark:bg-blue-950 dark:shadow-[inset_3px_0_0_var(--color-blue-400)]'
          : 'bg-white hover:bg-blue-50/50 dark:bg-paper-900 dark:hover:bg-blue-950/50',
      )}
    >
      <span className="font-mono text-ink-500 dark:text-ink-400">
        {formatTime(atOf(entry))}
      </span>
      {layout === 'full' ? (
        <FullColumns entry={entry} />
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={statusOf(entry).tone} />
          <span className="truncate font-mono font-medium">
            {nameOf(entry)}
          </span>
        </span>
      )}
    </button>
  );
});

type FullColumnsProps = {
  entry: LogEntry;
};

// Every column after Time in the full layout: Layer, Kind (the HTTP method or
// the MCP message type), then Name onwards.
function FullColumns({ entry }: FullColumnsProps) {
  const sessionId = sessionOf(entry);
  return (
    <>
      <span>
        <Pill className={layerStyles[entry.type]}>{entry.type}</Pill>
      </span>
      <span>
        {entry.type === 'http' ? (
          <Pill className={methodStyle}>{entry.exchange.request.method}</Pill>
        ) : (
          <TypeChip type={typeOf(entry)} />
        )}
      </span>
      <span className="truncate font-mono font-medium">{nameOf(entry)}</span>
      <span>
        <StatusText status={statusOf(entry)} />
      </span>
      <span className="truncate text-xs text-ink-500 dark:text-ink-400">
        {noteOf(entry)}
      </span>
      <span
        className="font-mono text-ink-600 dark:text-ink-300"
        title={sessionId ?? undefined}
      >
        {shortSession(sessionId)}
      </span>
      <span className="text-right font-mono text-ink-600 dark:text-ink-300">
        {tookOf(entry)}
      </span>
    </>
  );
}

/** Props of `TypeChip`. */
export type TypeChipProps = {
  /** The type to label. */
  type: LogType;
};

/** A small colored label for an entry's type. */
export function TypeChip({ type }: TypeChipProps) {
  return <Pill className={typeStyles[type]}>{type}</Pill>;
}

/** A small rounded label; the caller's classes set its colors. */
function Pill({ className, ...rest }: ComponentProps<'span'>) {
  return (
    <span
      className={twMerge(
        'rounded-sm px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        className,
      )}
      {...rest}
    />
  );
}

/** Props of `StatusText`. */
export type StatusTextProps = {
  /** The status to show. */
  status: EntryStatus;
};

/** An entry's status, colored by tone. */
export function StatusText({ status }: StatusTextProps) {
  return (
    <span
      className={twMerge(
        'font-mono text-xs font-medium',
        statusTextStyles[status.tone],
      )}
    >
      {status.label}
    </span>
  );
}

type StatusDotProps = {
  tone: StatusTone;
};

function StatusDot({ tone }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={twMerge('size-2 shrink-0 rounded-full', statusDotStyles[tone])}
    />
  );
}
