import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { client, unwrapEmpty } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';

import { useServerContext } from '../server-layout';
import { MessageDetail } from './message-detail';
import { MessageList } from './message-list';
import { useDebouncedValue } from './use-debounced-value';
import { useLogStream } from './use-log-stream';

/** How long the search text must hold still before the server is asked. */
const SEARCH_DEBOUNCE_MS = 250;

const numberFormat = new Intl.NumberFormat();

/** `/servers/:server/logs`: every JSON-RPC message, live. */
export function LogsPage() {
  const { server } = useServerContext();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const stream = useLogStream(server.name, query);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const selected =
    selectedId === null
      ? undefined
      : stream.entries.find((entry) => entry.id === selectedId);

  const clear = async () => {
    setClearError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].logs.$delete({
          param: { server: server.name },
        }),
      );
      setSelectedId(null);
      stream.reset();
    } catch (caught) {
      setClearError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const status = (() => {
    const noun = query === '' ? 'message' : 'matching message';
    const count = `${numberFormat.format(stream.total)} ${noun}${stream.total === 1 ? '' : 's'}`;
    if (stream.paused) {
      return `${count} · paused`;
    }
    switch (stream.connection) {
      case 'live':
        return `${count} · streaming`;
      case 'connecting':
        return `${count} · connecting…`;
      case 'reconnecting':
        return `${count} · reconnecting…`;
      case 'closed':
        return `${count} · disconnected`;
    }
  })();

  let list;
  if (stream.error !== undefined) {
    list = (
      <p role="alert" className="m-0 p-4 text-sm text-red-800">
        Could not load messages: {stream.error.message}
      </p>
    );
  } else if (stream.loading) {
    list = <p className="m-0 p-4 text-sm text-ink-500">Loading messages…</p>;
  } else if (stream.entries.length === 0) {
    list = <EmptyMessages server={server.mcpUrl} searching={query !== ''} />;
  } else {
    list = (
      <MessageList
        entries={stream.entries}
        hasOlder={stream.hasOlder}
        loadingOlder={stream.loadingOlder}
        selectedId={selectedId}
        onLoadOlder={stream.loadOlder}
        onSelect={setSelectedId}
      />
    );
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-paper-200 bg-white px-6 py-3">
        <label htmlFor={searchId} className="sr-only">
          Search messages by method or text
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search method or any text"
          className="box-border min-h-9 min-w-0 flex-[1_1_280px] rounded-lg border border-paper-300 bg-white px-3 font-mono text-[13px] text-ink-900"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          {stream.paused ? (
            <Button size="small" onClick={stream.resume}>
              <PlayIcon size={14} aria-hidden="true" />
              Resume{stream.pending > 0 ? ` · ${stream.pending} new` : ''}
            </Button>
          ) : (
            <Button size="small" onClick={stream.pause}>
              <PauseIcon size={14} aria-hidden="true" />
              Pause
            </Button>
          )}
          <Button size="small" onClick={clear}>
            Clear
          </Button>
          <a
            href={`/api/v1/servers/${encodeURIComponent(server.name)}/logs/export`}
            download
            className={buttonClasses('secondary', 'small')}
          >
            Export JSONL
          </a>
        </div>
        {clearError !== null && (
          <p role="alert" className="m-0 w-full text-[13px] text-red-800">
            {clearError}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section
          aria-label="Messages"
          className="flex min-w-0 flex-col border-r border-paper-200 bg-white lg:min-h-0 lg:flex-[999_1_620px]"
        >
          {list}
          <div
            aria-live="polite"
            className="mt-auto flex shrink-0 flex-wrap justify-between gap-3 border-t border-paper-100 px-4 py-2.5 text-xs text-ink-500"
          >
            <span>{status}</span>
          </div>
        </section>

        <MessageDetail
          entry={selected}
          entries={stream.entries}
          server={server.name}
          onSelect={setSelectedId}
        />
      </div>
    </>
  );
}

type EmptyMessagesProps = {
  server: string;
  searching: boolean;
};

function EmptyMessages({ server, searching }: EmptyMessagesProps) {
  if (searching) {
    return <p className="m-0 p-4 text-sm text-ink-500">No messages match.</p>;
  }
  return (
    <div className="flex flex-col gap-2 p-6">
      <h2 className="m-0 text-[15px] font-semibold">Waiting for traffic</h2>
      <p className="m-0 max-w-prose text-sm/relaxed text-ink-600">
        Point your MCP client at{' '}
        <span className="font-mono wrap-anywhere text-ink-900">{server}</span>.
        Every message in and out shows up here as it happens.
      </p>
    </div>
  );
}
