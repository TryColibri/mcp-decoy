import { Tabs } from '@base-ui/react/tabs';
import { XIcon } from '@phosphor-icons/react';
import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import {
  type HTTPEntry,
  type LogEntry,
  type MCPEntry,
  type MCPFact,
} from '@/shared/api';
import { useCarriedEntries } from '@/ui/api';
import { Button } from '@/ui/components/button';
import { tw } from '@/ui/tw';

import { BodyView } from './body-view';
import {
  CarriedList,
  CarriedRow,
  CarriedRows,
  type CarriedItem,
} from './carried-list';
import { HeadersView } from './headers-view';
import {
  atOf,
  formatTime,
  isPair,
  logsPath,
  nameOf,
  parsedMessage,
  splitURL,
  statusOf,
  tookOf,
  typeOf,
} from './log-format';
import { StatusText, TypeChip } from './message-list';

/** Props of `MessageDetail`. */
export type MessageDetailProps = {
  /** The selected entry. */
  entry: LogEntry;
  /** Every loaded entry, to name the exchanges an entry links to. */
  entries: LogEntry[];
  /** Server name, to fetch the entries an exchange carried. */
  server: string;
  /** Closes the pane. */
  onClose: () => void;
};

const TABS = ['overview', 'request', 'response'] as const;

type DetailTab = (typeof TABS)[number];

const isDetailTab = (value: unknown): value is DetailTab =>
  TABS.some((tab) => tab === value);

// Exchanges and request/reply pairs have all three tabs; an unpaired message
// has its message, shown under the Request tab so the choice carries over,
// and the overview.
const tabsOf = (entry: LogEntry): DetailTab[] =>
  entry.type === 'http' || isPair(entry)
    ? ['overview', 'request', 'response']
    : ['overview', 'request'];

const labelOf = (tab: DetailTab, entry: LogEntry): string => {
  if (tab === 'overview') {
    return 'Overview';
  }
  if (tab === 'response') {
    return 'Response';
  }
  return entry.type === 'mcp' && !isPair(entry) ? 'Message' : 'Request';
};

const tabClasses = tw`-mb-px cursor-pointer border-0 border-b-2 border-solid border-transparent bg-transparent px-3 py-2.5 font-sans text-[13px] font-medium text-ink-600 hover:text-ink-900 data-active:border-blue-700 data-active:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100 dark:data-active:border-blue-400 dark:data-active:text-ink-100`;
const panelClasses = tw`min-h-0 flex-1 overflow-auto p-4.5 outline-none`;
const linkClasses = tw`font-mono text-[13px] text-blue-700 underline hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300`;

/**
 * Right pane of the Logs tab, like Chrome's Network panel: a header bar and
 * tabs that show the selected entry's request, response and overview.
 */
export function MessageDetail({
  entry,
  entries,
  server,
  onClose,
}: MessageDetailProps) {
  // The tab is the URL fragment, so a link can open an entry on a given tab
  // and the choice survives switching entries; an entry without the tab shows
  // its first one.
  const { hash } = useLocation();
  const navigate = useNavigate();
  const chosen = hash.slice(1);
  const tabs = tabsOf(entry);
  const active = tabs.find((tab) => tab === chosen) ?? tabs[0];
  const took = tookOf(entry);

  return (
    <aside
      aria-label="Entry detail"
      className="relative box-border flex min-w-0 flex-1 flex-col bg-white lg:min-h-0 dark:bg-paper-900"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-paper-100 px-4.5 py-3 dark:border-paper-800">
        <h2 className="m-0 font-mono text-sm font-medium">{nameOf(entry)}</h2>
        <TypeChip type={typeOf(entry)} />
        <StatusText status={statusOf(entry)} />
        <span className="text-xs text-ink-600 dark:text-ink-300">
          {formatTime(atOf(entry))}
          {took === '' ? '' : ` · ${took}`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="small"
            aria-label="Close details"
            title="Close details"
            onClick={onClose}
            className="px-2"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Tabs.Root
        value={active}
        onValueChange={(value) => {
          if (isDetailTab(value)) {
            void navigate({ hash: value }, { replace: true });
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List className="flex shrink-0 gap-1 border-b border-paper-100 px-3 dark:border-paper-800">
          {tabs.map((tab) => (
            <Tabs.Tab key={tab} value={tab} className={tabClasses}>
              {labelOf(tab, entry)}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {tabs.map((tab) => (
          <Tabs.Panel key={tab} value={tab} className={panelClasses}>
            <Panel tab={tab} entry={entry} entries={entries} server={server} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </aside>
  );
}

type PanelProps = {
  tab: DetailTab;
  entry: LogEntry;
  entries: LogEntry[];
  server: string;
};

function Panel({ tab, entry, entries, server }: PanelProps) {
  if (entry.type === 'http') {
    switch (tab) {
      case 'request':
        return <HTTPRequestPanel entry={entry} server={server} />;
      case 'response':
        return <HTTPResponsePanel entry={entry} server={server} />;
      case 'overview':
        return <HTTPOverviewPanel entry={entry} />;
    }
  }
  switch (tab) {
    case 'request':
      return <MCPMessagePanel entry={entry} />;
    case 'response':
      return <MCPResponsePanel entry={entry} />;
    case 'overview':
      return (
        <MCPOverviewPanel entry={entry} entries={entries} server={server} />
      );
  }
}

type FactListProps = {
  facts: Array<[string, ReactNode]>;
};

function FactList({ facts }: FactListProps) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
      {facts.map(([name, value]) => (
        <div key={name} className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-ink-600 dark:text-ink-300">{name}</dt>
          <dd className="m-0 font-mono wrap-anywhere text-ink-900 dark:text-ink-100">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type SectionProps = {
  title: string;
  children: ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-semibold tracking-wide text-ink-500 uppercase dark:text-ink-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

type HTTPPanelProps = {
  entry: HTTPEntry;
  server: string;
};

// The messages an exchange carried: loaded on demand, and polled while a
// stream is still open.
const useCarried = ({ entry, server }: HTTPPanelProps) => {
  const { data } = useCarriedEntries(
    server,
    entry.exchange.endpoint === 'mcp' ? entry.id : null,
    entry.state === 'streaming',
  );
  const items = (data ?? [])
    .filter((candidate): candidate is MCPEntry => candidate.type === 'mcp')
    .flatMap((candidate): CarriedItem[] =>
      candidate.reply?.type === 'mcp'
        ? [
            { entry: candidate, fact: candidate.message },
            { entry: candidate, fact: candidate.reply },
          ]
        : [{ entry: candidate, fact: candidate.message }],
    )
    .filter(({ fact }) => fact.carriedBy === entry.id)
    .toSorted((a, b) => a.fact.id - b.fact.id);
  return {
    sent: items.filter(({ fact }) => fact.from === 'client'),
    received: items.filter(({ fact }) => fact.from === 'server'),
  };
};

type CarriedSectionProps = {
  items: CarriedItem[];
  empty: string;
  server: string;
};

function CarriedItems({ items, empty, server }: CarriedSectionProps) {
  return items.length === 0 ? (
    <p className="m-0 text-sm text-ink-500 dark:text-ink-400">{empty}</p>
  ) : (
    <CarriedList items={items} server={server} />
  );
}

// The body of an MCP exchange is the messages it carried, which their own
// entries show; only other exchanges (OAuth) show their body here.
function HTTPRequestPanel({ entry, server }: HTTPPanelProps) {
  const { request } = entry.exchange;
  const { sent } = useCarried({ entry, server });
  const { base, query } = splitURL(request.url);
  return (
    <div className="flex flex-col gap-4">
      <HeadersView
        line={`${request.method} ${base}`}
        headers={request.headers}
        query={query}
      />
      {entry.exchange.endpoint === 'mcp' ? (
        <Section title="Messages sent">
          <CarriedItems items={sent} empty="None." server={server} />
        </Section>
      ) : (
        <Section title="Body">
          <BodyView body={request.body} copyLabel="Copy request body" />
          {request.truncated && <TruncatedNote />}
        </Section>
      )}
    </div>
  );
}

function HTTPResponsePanel({ entry, server }: HTTPPanelProps) {
  const { response } = entry.exchange;
  const { received } = useCarried({ entry, server });
  if (response === null) {
    return (
      <p className="m-0 text-sm text-ink-500 dark:text-ink-400">
        No response: the client left before headers.
      </p>
    );
  }
  const events = entry.end?.events ?? received.length;
  const open = entry.state === 'streaming' ? ' (open)' : '';
  const title = response.stream
    ? `Event stream: ${events} ${events === 1 ? 'event' : 'events'}${open}`
    : 'Messages received';
  return (
    <div className="flex flex-col gap-4">
      <HeadersView
        line={`HTTP ${response.status}`}
        headers={response.headers}
      />
      {entry.exchange.endpoint === 'mcp' ? (
        <Section title={title}>
          <CarriedItems
            items={received}
            empty={response.stream ? 'No events yet.' : 'None.'}
            server={server}
          />
        </Section>
      ) : (
        <Section title="Body">
          <BodyView body={response.body} copyLabel="Copy response body" />
          {response.truncated && <TruncatedNote />}
        </Section>
      )}
    </div>
  );
}

type HTTPOverviewPanelProps = {
  entry: HTTPEntry;
};

function HTTPOverviewPanel({ entry }: HTTPOverviewPanelProps) {
  const { exchange } = entry;
  const took = tookOf(entry);
  return (
    <FactList
      facts={[
        ['URL', splitURL(exchange.request.url).base],
        ['Method', exchange.request.method],
        [
          'Status',
          exchange.response === null ? 'no response' : exchange.response.status,
        ],
        ['State', entry.state],
        ['Duration', took === '' ? '—' : took],
        ['Session ID', exchange.sessionId ?? '—'],
        ['Endpoint', exchange.endpoint],
      ]}
    />
  );
}

type MCPEntryPanelProps = {
  entry: MCPEntry;
};

function MCPMessagePanel({ entry }: MCPEntryPanelProps) {
  return <MessageBody fact={entry.message} copyLabel="Copy JSON" />;
}

function MCPResponsePanel({ entry }: MCPEntryPanelProps) {
  const { reply } = entry;
  if (reply === null) {
    return (
      <p className="m-0 text-sm text-ink-500 dark:text-ink-400">
        Waiting for the response…
      </p>
    );
  }
  if (reply.type === 'no-reply') {
    return (
      <p className="m-0 text-sm text-ink-500 dark:text-ink-400">
        No response:{' '}
        {reply.reason === 'session-closed'
          ? 'the session closed.'
          : 'the exchange ended.'}
      </p>
    );
  }
  return <MessageBody fact={reply} copyLabel="Copy JSON" />;
}

type MessageBodyProps = {
  fact: MCPFact;
  copyLabel: string;
};

function MessageBody({ fact, copyLabel }: MessageBodyProps) {
  return (
    <div className="flex flex-col gap-2">
      <BodyView body={parsedMessage(fact) ?? fact.raw} copyLabel={copyLabel} />
      {fact.truncated && <TruncatedNote />}
    </div>
  );
}

function TruncatedNote() {
  return (
    <p className="m-0 text-xs text-ink-500 dark:text-ink-400">
      Cut at 1 MiB: only the beginning was kept.
    </p>
  );
}

type MCPOverviewPanelProps = {
  entry: MCPEntry;
  entries: LogEntry[];
  server: string;
};

function MCPOverviewPanel({ entry, entries, server }: MCPOverviewPanelProps) {
  const { message, reply } = entry;
  const took = tookOf(entry);

  const exchangeNameOf = (id: number) => {
    const found = entries.find((candidate) => candidate.id === id);
    return found === undefined ? `Exchange #${id}` : nameOf(found);
  };

  const carriedBy = (label: string, fact: MCPFact) => (
    <CarriedRow key={fact.id} label={label} sse={fact.sse}>
      {fact.carriedBy === null ? (
        <span className="font-mono text-red-800 dark:text-red-400">
          not sent
        </span>
      ) : (
        <Link
          to={logsPath(
            server,
            fact.carriedBy,
            fact.from === 'client' ? 'request' : 'response',
          )}
          className={linkClasses}
        >
          {exchangeNameOf(fact.carriedBy)}
        </Link>
      )}
    </CarriedRow>
  );

  return (
    <div className="flex flex-col gap-4">
      <FactList
        facts={[
          ['Method', message.method ?? '—'],
          [
            'JSON-RPC ID',
            message.jsonrpcId === null ? '—' : String(message.jsonrpcId),
          ],
          ['From', message.from === 'client' ? 'Client' : 'Server'],
          ['Duration', took === '' ? '—' : took],
          ['Session ID', message.sessionId ?? '—'],
        ]}
      />
      <Section title="Carried by">
        <CarriedRows>
          {carriedBy(isPair(entry) ? 'Request' : 'Message', message)}
          {reply?.type === 'mcp' && carriedBy('Reply', reply)}
        </CarriedRows>
      </Section>
    </div>
  );
}
