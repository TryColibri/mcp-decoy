import { type MCPFact } from '@/shared/api';
import { tw } from '@/ui/tw';

import { formatTime, prettyJSON } from './log-format';

/** Props of `EventsView`. */
export type EventsViewProps = {
  /** Server messages an event stream carried. */
  facts: MCPFact[];
  /** Selects the entry of a message, by anchor id. */
  onSelect: (id: number) => void;
};

const linkClasses = tw`cursor-pointer border-0 bg-transparent p-0 font-mono text-[12.5px] text-blue-700 underline hover:text-blue-900`;

/** The events of an event stream, oldest first: SSE fields, message and a link to its entry. */
export function EventsView({ facts, onSelect }: EventsViewProps) {
  if (facts.length === 0) {
    return <p className="m-0 text-sm text-ink-500">No events yet.</p>;
  }
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {facts.map((fact) => (
        <li
          key={fact.id}
          className="flex flex-col gap-1.5 rounded-lg border border-paper-200 p-3"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
            <span className="font-mono">{formatTime(fact.at)}</span>
            <span className="font-mono">
              event: {fact.sse?.event ?? '—'} · id: {fact.sse?.id ?? '—'}
            </span>
            <span className="font-mono">
              {fact.kind}
              {fact.method === null ? '' : ` ${fact.method}`}
            </span>
            <button
              type="button"
              className={linkClasses}
              onClick={() => {
                onSelect(fact.replyTo ?? fact.id);
              }}
            >
              Open entry
            </button>
          </div>
          <pre className="m-0 max-h-60 overflow-auto font-mono text-[12.5px] leading-[1.6] whitespace-pre text-ink-900">
            {prettyJSON(fact)}
          </pre>
        </li>
      ))}
    </ol>
  );
}
