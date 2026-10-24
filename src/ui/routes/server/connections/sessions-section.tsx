import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { type ServerSummary, type Session } from '@/shared/api';
import { client, keys, unwrapEmpty, useSessions } from '@/ui/api';
import { Button } from '@/ui/components/button';
import { tw } from '@/ui/tw';

import { formatDateTime, formatRelative } from './format-time';
import { Section } from './section';

/** Props of `SessionsSection`. */
export type SessionsSectionProps = {
  /** The server whose sessions are listed. */
  server: ServerSummary;
};

const th = tw`border-b border-paper-200 px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-500 uppercase`;
const td = tw`border-b border-paper-100 px-4 py-3 align-middle text-sm whitespace-nowrap`;

/** Live MCP sessions of a server, each with a Close button. */
export function SessionsSection({ server }: SessionsSectionProps) {
  const { data: sessions, error } = useSessions(server.name);

  const body =
    error !== undefined ? (
      <p role="alert" className="m-0 text-sm text-red-800">
        Could not load sessions: {error.message}
      </p>
    ) : sessions === undefined ? (
      <p className="m-0 text-sm text-ink-500">Loading…</p>
    ) : sessions.length === 0 ? (
      <p className="m-0 text-sm/relaxed text-ink-600">
        No live sessions. Connect a client to the endpoint at the top of this
        page to open one.
      </p>
    ) : (
      <SessionTable server={server.name} sessions={sessions} />
    );

  return <Section title="Sessions">{body}</Section>;
}

type SessionTableProps = {
  server: string;
  sessions: Session[];
};

function SessionTable({ server, sessions }: SessionTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th} scope="col">
              Client
            </th>
            <th className={th} scope="col">
              Protocol
            </th>
            <th className={th} scope="col">
              Connected
            </th>
            <th className={th} scope="col">
              Last seen
            </th>
            <th className={th} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <SessionRow key={session.id} server={server} session={session} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SessionRowProps = {
  server: string;
  session: Session;
};

function SessionRow({ server, session }: SessionRowProps) {
  const { mutate } = useSWRConfig();
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clientInfo } = session;

  const close = async () => {
    setClosing(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].sessions[':session'].$delete({
          param: { server, session: session.id },
        }),
      );
      await mutate(keys.sessions(server));
      void mutate(keys.server(server));
      void mutate(keys.servers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setClosing(false);
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
        <span className="block font-mono text-xs text-ink-500">
          {session.id}
        </span>
      </td>
      <td className={td}>
        <span className="font-mono text-[13px]">
          {session.protocolVersion ?? session.requestedProtocolVersion ?? '—'}
        </span>
      </td>
      <td className={td}>{formatDateTime(session.connectedAt)}</td>
      <td className={td}>{formatRelative(session.lastSeenAt)}</td>
      <td className={`${td} text-right`}>
        {error !== null && (
          <span role="alert" className="mr-3 text-[13px] text-red-800">
            {error}
          </span>
        )}
        <Button
          variant="danger"
          size="small"
          onClick={close}
          disabled={closing}
          aria-label={`Close session ${session.id}`}
        >
          {closing ? 'Closing…' : 'Close'}
        </Button>
      </td>
    </tr>
  );
}
