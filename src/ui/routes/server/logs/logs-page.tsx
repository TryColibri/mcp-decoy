import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';

import { client, unwrapEmpty, useLogEntry } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';
import { tw } from '@/ui/tw';

import { useServerContext } from '../server-layout';
import { MessageDetail } from './message-detail';
import { MessageList } from './message-list';
import { useDebouncedValue } from './use-debounced-value';
import { useLogStream } from './use-log-stream';

/** How long the search text must hold still before the server is asked. */
const SEARCH_DEBOUNCE_MS = 250;

// The message table fills the page until an entry is selected. Then it shrinks
// to a column beside the detail pane; below `lg` the pane replaces it.
const messagesAlone = tw`flex min-w-0 flex-1 flex-col bg-white lg:min-h-0`;
const messagesWithDetail = tw`hidden min-w-0 flex-col border-r border-paper-200 bg-white lg:flex lg:min-h-0 lg:w-80 lg:flex-none`;

const numberFormat = new Intl.NumberFormat();

/** `/servers/:server/logs`: every HTTP exchange and JSON-RPC message, live. */
export function LogsPage() {
  const { server } = useServerContext();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const stream = useLogStream(server.name, query);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  // A link can point at an entry the list hasn't loaded, or that the search
  // filters out; fetch it by id then.
  const loaded =
    selectedId === null
      ? undefined
      : stream.entries.find((entry) => entry.id === selectedId);
  const fetched = useLogEntry(
    server.name,
    loaded === undefined ? selectedId : null,
  );
  const selected = loaded ?? fetched.data;

  const open = selected !== undefined;

  // Escape closes the detail pane, like Chrome's Network panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setSelectedId(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

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
    const noun = query === '' ? 'entry' : 'matching entry';
    const count = `${numberFormat.format(stream.total)} ${stream.total === 1 ? noun : noun.replace('entry', 'entries')}`;
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
        Could not load entries: {stream.error.message}
      </p>
    );
  } else if (stream.loading) {
    list = <p className="m-0 p-4 text-sm text-ink-500">Loading entries…</p>;
  } else if (stream.entries.length === 0) {
    list = <EmptyMessages server={server.mcpUrl} searching={query !== ''} />;
  } else {
    list = (
      <MessageList
        layout={open ? 'compact' : 'full'}
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
          Search entries by method, URL or text
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search method, URL or any text"
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
          aria-label="Entries"
          className={open ? messagesWithDetail : messagesAlone}
        >
          {list}
          <div
            aria-live="polite"
            className="mt-auto flex shrink-0 flex-wrap justify-between gap-3 border-t border-paper-100 px-4 py-2.5 text-xs text-ink-500"
          >
            <span>{status}</span>
          </div>
        </section>

        {selected !== undefined && (
          <MessageDetail
            entry={selected}
            entries={stream.entries}
            server={server.name}
            onSelect={setSelectedId}
            onClose={() => {
              setSelectedId(null);
            }}
          />
        )}
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
    return <p className="m-0 p-4 text-sm text-ink-500">No entries match.</p>;
  }
  return (
    <div className="flex flex-col gap-2 p-6">
      <h2 className="m-0 text-[15px] font-semibold">Waiting for traffic</h2>
      <p className="m-0 max-w-prose text-sm/relaxed text-ink-600">
        Point your MCP client at{' '}
        <span className="font-mono wrap-anywhere text-ink-900">{server}</span>.
        Every HTTP exchange and JSON-RPC message shows up here as it happens.
      </p>
    </div>
  );
}
