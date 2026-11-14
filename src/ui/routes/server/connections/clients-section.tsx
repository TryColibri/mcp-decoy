import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { type MCPClient, type ServerSummary } from '@/shared/api';
import { client, keys, unwrapEmpty, useClients } from '@/ui/api';
import { Button, ButtonLink } from '@/ui/components/button';
import { tw } from '@/ui/tw';

import { formatDateTime, formatRelative } from './format-time';
import { Section } from './section';

/** Props of `ClientsSection`. */
export type ClientsSectionProps = {
  /** The server whose clients are listed. */
  server: ServerSummary;
};

const th = tw`border-b border-paper-200 px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-500 uppercase dark:border-paper-800 dark:text-ink-400`;
const td = tw`border-b border-paper-100 px-4 py-3 align-middle text-sm whitespace-nowrap dark:border-paper-800`;

/**
 * Clients of a server, whichever protocol generation they speak: 2025-11-25
 * sessions to close, 2026-07-28 stateless clients to forget.
 */
export function ClientsSection({ server }: ClientsSectionProps) {
  const { data: clients, error } = useClients(server.name);

  const body =
    error !== undefined ? (
      <p role="alert" className="m-0 text-sm text-red-800 dark:text-red-400">
        Could not load clients: {error.message}
      </p>
    ) : clients === undefined ? (
      <p className="m-0 text-sm text-ink-500 dark:text-ink-400">Loading…</p>
    ) : clients.length === 0 ? (
      <p className="m-0 text-sm/relaxed text-ink-600 dark:text-ink-300">
        No clients. Connect a client to the endpoint at the top of this page to
        see it here.
      </p>
    ) : (
      <ClientTable server={server.name} clients={clients} />
    );

  return <Section title="Clients">{body}</Section>;
}

type ClientTableProps = {
  server: string;
  clients: MCPClient[];
};

function ClientTable({ server, clients }: ClientTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white dark:border-paper-800 dark:bg-paper-900">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th} scope="col">
              Client
            </th>
            <th className={th} scope="col">
              Era
            </th>
            <th className={th} scope="col">
              Protocol
            </th>
            <th className={th} scope="col">
              OAuth client
            </th>
            <th className={th} scope="col">
              Connected
            </th>
            <th className={th} scope="col">
              Last seen
            </th>
            <th className={th} scope="col">
              Streams
            </th>
            <th className={th} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.map((mcpClient) => (
            <ClientRow
              key={mcpClient.id}
              server={server}
              mcpClient={mcpClient}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type EraBadgeProps = {
  era: MCPClient['era'];
};

/** Which protocol generation a client speaks. */
function EraBadge({ era }: EraBadgeProps) {
  const legacy = era === 'legacy';
  return (
    <span className="inline-flex flex-col">
      <span className="font-mono text-[13px] font-medium">
        {legacy ? '2025-11-25' : '2026-07-28'}
      </span>
      <span className="text-xs text-ink-500 dark:text-ink-400">
        {legacy ? 'session' : 'stateless'}
      </span>
    </span>
  );
}

type ClientRowProps = {
  server: string;
  mcpClient: MCPClient;
};

function ClientRow({ server, mcpClient }: ClientRowProps) {
  const { mutate } = useSWRConfig();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clientInfo } = mcpClient;
  const legacy = mcpClient.era === 'legacy';
  const verb = legacy ? 'Close' : 'Forget';

  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].clients[':client'].$delete({
          param: { server, client: mcpClient.id },
        }),
      );
      await mutate(keys.clients(server));
      void mutate(keys.server(server));
      void mutate(keys.servers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRemoving(false);
    }
  };

  return (
    <tr>
      <td className={td}>
        <span className="font-semibold">
          {clientInfo === null
            ? 'Unknown client'
            : `${clientInfo.name} ${clientInfo.version}`}
        </span>
        <span className="block font-mono text-xs text-ink-500 dark:text-ink-400">
          {mcpClient.id}
        </span>
      </td>
      <td className={td}>
        <EraBadge era={mcpClient.era} />
      </td>
      <td className={td}>
        <span className="font-mono text-[13px]">
          {mcpClient.protocolVersion ??
            mcpClient.requestedProtocolVersion ??
            '—'}
        </span>
      </td>
      <td className={td}>
        {mcpClient.oauthClientId === null ? (
          '—'
        ) : (
          <span className="font-mono text-[13px]">
            {mcpClient.oauthClientId}
          </span>
        )}
      </td>
      <td className={td}>{formatDateTime(mcpClient.connectedAt)}</td>
      <td className={td}>{formatRelative(mcpClient.lastSeenAt)}</td>
      <td className={td}>{mcpClient.openStreams}</td>
      <td className={`${td} text-right`}>
        {error !== null && (
          <span
            role="alert"
            className="mr-3 text-[13px] text-red-800 dark:text-red-400"
          >
            {error}
          </span>
        )}
        <span className="inline-flex items-center gap-2">
          <ButtonLink
            size="small"
            to={`../logs?client=${encodeURIComponent(mcpClient.id)}`}
            aria-label={`View logs of ${mcpClient.id}`}
          >
            View logs
          </ButtonLink>
          <Button
            variant="danger"
            size="small"
            onClick={remove}
            disabled={removing}
            aria-label={`${verb} ${legacy ? 'session' : 'client'} ${mcpClient.id}`}
          >
            {removing ? `${verb.slice(0, -1)}ing…` : verb}
          </Button>
        </span>
      </td>
    </tr>
  );
}
