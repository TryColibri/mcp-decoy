import { PlusIcon } from '@phosphor-icons/react';

import { useInstance, useServers } from '@/ui/api';
import { ButtonLink } from '@/ui/components/button';

import { ServerTable } from './server-table';

/** `/`: every mock server, with endpoints and live sessions. */
export function ServersPage() {
  const { data: servers, error } = useServers();
  const { data: instance } = useInstance();

  let content;
  if (error !== undefined) {
    content = (
      <p role="alert" className="m-0 p-6 text-sm text-red-800">
        Could not load servers: {error.message}
      </p>
    );
  } else if (servers === undefined) {
    content = <p className="m-0 p-6 text-sm text-ink-500">Loading servers…</p>;
  } else if (servers.length === 0) {
    content = <EmptyState />;
  } else {
    content = <ServerTable servers={servers} />;
  }

  return (
    <main className="mx-auto box-border flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 pt-8 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-bold tracking-tight">Servers</h1>
          <p className="m-0 text-[15px] text-ink-600">
            Each mock server is mounted on its own URL. Point your client at one
            and watch the traffic in Logs.
          </p>
        </div>
        <ButtonLink to="/servers/new" variant="primary">
          <PlusIcon size={16} weight="bold" aria-hidden="true" />
          New server
        </ButtonLink>
      </div>

      <section
        aria-label="Server list"
        className="min-w-0 overflow-hidden rounded-xl border border-paper-200 bg-white"
      >
        {content}
        <div className="border-t border-paper-100 bg-paper-50 px-4 py-3.5 text-[13px] text-ink-500">
          Servers are stored in{' '}
          <span className="font-mono break-all text-ink-900">
            {instance?.configFile ?? 'servers.json'}
          </span>
          . Changes apply live — no restart.
        </div>
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-10">
      <h2 className="m-0 text-base font-semibold">No servers yet</h2>
      <p className="m-0 max-w-prose text-sm/relaxed text-ink-600">
        A server is a mock MCP endpoint with the tools you define. Create one,
        add a tool, then point your MCP client at its URL. Every message shows
        up live in its Logs tab.
      </p>
      <ButtonLink to="/servers/new" variant="primary">
        <PlusIcon size={16} weight="bold" aria-hidden="true" />
        New server
      </ButtonLink>
    </div>
  );
}
