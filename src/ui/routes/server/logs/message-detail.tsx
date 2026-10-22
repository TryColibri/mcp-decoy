import { CheckIcon } from 'lucide-react';
import { useState } from 'react';

import { type LogEntry } from '@/shared/api';
import { Button } from '@/ui/components/button';

import { formatTime, pairOf, prettyJSON } from './log-format';
import { DirectionBadge } from './message-list';
import { NegotiationCard } from './negotiation-card';

/** Props of `MessageDetail`. */
export type MessageDetailProps = {
  /** The selected entry, if any. */
  entry: LogEntry | undefined;
  /** Every loaded entry, to find pairs and `initialize` exchanges. */
  entries: LogEntry[];
  /** Server name, for live session lookups. */
  server: string;
  /** Selects another entry (the pair). */
  onSelect: (id: number) => void;
};

/** Right column of the Logs tab: negotiation and the selected message's JSON. */
export function MessageDetail({
  entry,
  entries,
  server,
  onSelect,
}: MessageDetailProps) {
  return (
    <aside
      aria-label="Message detail"
      className="box-border flex min-w-0 flex-[1_1_420px] flex-col gap-4 px-6 py-5"
    >
      {entry === undefined ? (
        <section className="rounded-xl border border-dashed border-line bg-surface p-5 text-sm text-ink-3">
          Select a message to see its JSON and the session’s negotiation.
        </section>
      ) : (
        <>
          {entry.sessionId !== null && (
            <NegotiationCard
              sessionId={entry.sessionId}
              entries={entries}
              server={server}
            />
          )}
          <MessageJSON entry={entry} entries={entries} onSelect={onSelect} />
        </>
      )}
    </aside>
  );
}

type MessageJSONProps = {
  entry: LogEntry;
  entries: LogEntry[];
  onSelect: (id: number) => void;
};

function MessageJSON({ entry, entries, onSelect }: MessageJSONProps) {
  const [copied, setCopied] = useState(false);
  const pair = pairOf(entry, entries);
  const json = prettyJSON(entry);

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4.5 py-3.5">
        <DirectionBadge direction={entry.direction} />
        <h2 className="m-0 font-mono text-sm font-medium">
          {entry.method ?? '(unknown)'}
        </h2>
        <span className="text-xs text-ink-3">
          {entry.direction === 'in' ? 'Client → server' : 'Server → client'} ·{' '}
          {formatTime(entry.at)}
          {entry.durationMs === null ? '' : ` · ${entry.durationMs} ms`}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button size="small" onClick={copy}>
            {copied && <CheckIcon size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </Button>
          {pair !== undefined && (
            <Button
              size="small"
              onClick={() => {
                onSelect(pair.id);
              }}
            >
              {entry.kind === 'request' ? 'Go to response' : 'Go to request'}
            </Button>
          )}
        </div>
      </div>
      <pre className="m-0 min-h-40 flex-1 overflow-auto bg-code px-4.5 py-4 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-code-ink">
        {json}
      </pre>
    </section>
  );
}
