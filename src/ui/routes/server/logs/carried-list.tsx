import { Link } from 'react-router';

import { type MCPEntry, type MCPFact } from '@/shared/api';
import { tw } from '@/ui/tw';

import { logsPath, nameOf } from './log-format';

/** A message an exchange carried, and the entry that shows it. */
export type CarriedItem = {
  /** The MCP entry the message belongs to. */
  entry: MCPEntry;
  /** The message the exchange carried: the entry's message or its reply. */
  fact: MCPFact;
};

/** Props of `CarriedList`. */
export type CarriedListProps = {
  /** Messages the exchange carried, in the order to show them. */
  items: CarriedItem[];
  /** Server name, to link to the entry of each message. */
  server: string;
};

const linkClasses = tw`font-mono text-[13px] text-blue-700 underline hover:text-blue-900`;

const labelOf = ({ kind }: MCPFact): string => {
  switch (kind) {
    case 'request':
      return 'Request';
    case 'notification':
      return 'Notification';
    case 'response':
    case 'error':
      return 'Reply';
    case 'invalid':
      return 'Invalid';
  }
};

/**
 * The messages an exchange carried, mirroring the "Carried by" list of an MCP
 * entry: a label, a link to the entry and the SSE fields when streamed. The
 * messages themselves are shown by their entries, not here.
 */
export function CarriedList({ items, server }: CarriedListProps) {
  return (
    <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-paper-200 p-0 text-[13px]">
      {items.map(({ entry, fact }) => (
        <li
          key={fact.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-paper-100 px-3 py-2 first:border-t-0"
        >
          <span className="w-24 shrink-0 text-xs text-ink-600">
            {labelOf(fact)}
          </span>
          <Link
            to={logsPath(
              server,
              entry.id,
              fact.id === entry.message.id ? 'request' : 'response',
            )}
            className={linkClasses}
          >
            {nameOf(entry)}
          </Link>
          {fact.sse !== null && (
            <span className="ml-auto font-mono text-xs text-ink-600">
              event: {fact.sse.event ?? '—'} · id: {fact.sse.id ?? '—'}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
