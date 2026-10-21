import { PauseIcon, PlayIcon } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { type LogEntry } from '@/shared/api';
import { type ApiError, client, keys, unwrap, unwrapEmpty } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';

import { useServerContext } from '../server-layout';
import { matchesSearch } from './log-format';
import { MessageDetail } from './message-detail';
import { MessageList } from './message-list';
import { type LoadedLogs, useLogStream } from './use-log-stream';

/** `/servers/:server/logs`: every JSON-RPC message, live. */
export function LogsPage() {
  const { server } = useServerContext();
  const stream = useLogStream(server.name);
  const { mutate } = useSWRConfig();
  const searchId = useId();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [searchAll, setSearchAll] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const { data: allResults, error: searchError } = useSWR<LogEntry[], ApiError>(
    searchAll === null ? null : [keys.logs(server.name), 'search', searchAll],
    async () =>
      [
        ...(
          await unwrap(
            client.servers[':server'].logs.$get({
              param: { server: server.name },
              query: { q: searchAll ?? '', limit: '1000' },
            }),
          )
        ).items,
      ].reverse(),
  );

  const visible = useMemo(() => {
    if (searchAll !== null) {
      return allResults ?? [];
    }
    return query === ''
      ? stream.entries
      : stream.entries.filter((entry) => matchesSearch(entry, query));
  }, [allResults, query, searchAll, stream.entries]);

  const selected =
    selectedId === null
      ? undefined
      : (visible.find((entry) => entry.id === selectedId) ??
        stream.entries.find((entry) => entry.id === selectedId));

  const clear = async () => {
    setClearError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].logs.$delete({
          param: { server: server.name },
        }),
      );
      setSelectedId(null);
      setSearchAll(null);
      await mutate<LoadedLogs>(
        keys.logs(server.name),
        { items: [], hasOlder: false },
        { revalidate: false },
      );
    } catch (caught) {
      setClearError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const toolbarError = clearError ?? searchError?.message ?? null;

  const status = (() => {
    if (searchAll !== null) {
      return `${visible.length} matches for “${searchAll}” across all stored messages`;
    }
    const count = `${visible.length} ${visible.length === 1 ? 'message' : 'messages'} shown`;
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
      <p role="alert" className="m-0 p-4 text-sm text-error">
        Could not load messages: {stream.error.message}
      </p>
    );
  } else if (stream.loading) {
    list = <p className="m-0 p-4 text-sm text-ink-4">Loading messages…</p>;
  } else if (visible.length === 0) {
    list = (
      <EmptyMessages
        server={server.mcpUrl}
        searching={query !== '' || searchAll !== null}
      />
    );
  } else {
    list = (
      <MessageList
        entries={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        follow={searchAll === null}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-6 py-3">
        <label htmlFor={searchId} className="sr-only">
          Search messages by method or text
        </label>
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setSearchAll(null);
          }}
          placeholder="Search method or any text"
          className="box-border min-h-9 min-w-0 flex-[1_1_280px] rounded-lg border border-control bg-surface px-3 font-mono text-[13px] text-ink"
        />
        {query !== '' && stream.hasOlder && searchAll === null && (
          <Button
            size="small"
            onClick={() => {
              setSearchAll(query);
            }}
          >
            Search all
          </Button>
        )}
        {searchAll !== null && (
          <Button
            size="small"
            onClick={() => {
              setSearchAll(null);
            }}
          >
            Back to live
          </Button>
        )}
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
        {toolbarError !== null && (
          <p role="alert" className="m-0 w-full text-[13px] text-error">
            {toolbarError}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap items-stretch">
        <section
          aria-label="Messages"
          className="flex min-w-0 flex-[999_1_620px] flex-col border-r border-line bg-surface"
        >
          {list}
          <div
            aria-live="polite"
            className="mt-auto flex flex-wrap justify-between gap-3 border-t border-line-soft px-4 py-2.5 text-xs text-ink-4"
          >
            <span>{status}</span>
            {stream.hasOlder && searchAll === null && (
              <span>
                Older messages are stored; use Search all to find them.
              </span>
            )}
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
    return <p className="m-0 p-4 text-sm text-ink-4">No messages match.</p>;
  }
  return (
    <div className="flex flex-col gap-2 p-6">
      <h2 className="m-0 text-[15px] font-semibold">Waiting for traffic</h2>
      <p className="m-0 max-w-prose text-sm leading-relaxed text-ink-3">
        Point your MCP client at{' '}
        <span className="font-mono [overflow-wrap:anywhere] text-ink">
          {server}
        </span>
        . Every message in and out shows up here as it happens.
      </p>
    </div>
  );
}
