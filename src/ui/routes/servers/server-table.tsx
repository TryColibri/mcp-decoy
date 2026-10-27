import { Tooltip } from '@base-ui/react/tooltip';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { twMerge } from 'tailwind-merge';

import { type ServerSummary } from '@/shared/api';
import { EditServerDialog } from '@/ui/components/edit-server-dialog';
import { EndpointPill } from '@/ui/components/endpoint-pill';
import { SessionsPill, StatusDot } from '@/ui/components/sessions-pill';
import { tw } from '@/ui/tw';

/** Props of `ServerTable`. */
export type ServerTableProps = {
  /** Servers to list, in display order. */
  servers: ServerSummary[];
};

const th = tw`border-b border-paper-200 px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-500 uppercase dark:border-paper-800 dark:text-ink-400`;
const td = tw`border-b border-paper-100 px-4 py-3.5 align-middle text-sm whitespace-nowrap dark:border-paper-800`;

/** The servers table: name, endpoint, exposed tools, sessions, links. */
export function ServerTable({ servers }: ServerTableProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const editedServer = servers.find((server) => server.name === editing);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th} scope="col">
              Name
            </th>
            <th className={th} scope="col">
              Endpoint
            </th>
            <th className={th} scope="col">
              Exposes
            </th>
            <th className={th} scope="col">
              Sessions
            </th>
            <th className={th} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <ServerRow
              key={server.name}
              server={server}
              onEdit={() => {
                setEditing(server.name);
              }}
            />
          ))}
        </tbody>
      </table>
      {editedServer !== undefined && (
        <EditServerDialog
          key={editedServer.name}
          server={editedServer}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

type ServerRowProps = {
  server: ServerSummary;
  onEdit: () => void;
};

function ServerRow({ server, onEdit }: ServerRowProps) {
  const base = `/servers/${server.name}`;
  return (
    <tr>
      <td className={td}>
        <div className="flex items-center gap-2.5">
          <StatusDot live={server.sessionCount > 0} />
          <Link
            to={`${base}/logs`}
            className="font-semibold text-ink-900 dark:text-ink-100"
          >
            {server.name}
          </Link>
          {server.auth.mode === 'oauth' && (
            <OAuthLockHint tokenCount={server.auth.tokenCount} />
          )}
        </div>
      </td>
      <td className={td}>
        <EndpointPill url={server.mcpUrl} />
      </td>
      <td className={twMerge(td, 'text-ink-700 dark:text-ink-200')}>
        {describeTools(server)}
      </td>
      <td className={td}>
        <SessionsPill count={server.sessionCount} />
      </td>
      <td className={twMerge(td, 'text-right')}>
        <div className="inline-flex gap-2">
          <Link
            to={`${base}/logs`}
            className="px-2.5 py-2 text-[13px] font-medium no-underline"
          >
            Logs
          </Link>
          <Link
            to={`${base}/tools`}
            className="px-2.5 py-2 text-[13px] font-medium no-underline"
          >
            Tools
          </Link>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${server.name}`}
            className="cursor-pointer border-0 bg-transparent px-2.5 py-2 font-sans text-[13px] font-medium text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Edit
          </button>
        </div>
      </td>
    </tr>
  );
}

type OAuthLockHintProps = {
  tokenCount: number;
};

function OAuthLockHint({ tokenCount }: OAuthLockHintProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <span className="inline-flex items-center text-ink-500 dark:text-ink-400" />
        }
      >
        <LockSimpleIcon
          className="size-3.25"
          weight="bold"
          aria-hidden="true"
        />
        <span className="sr-only">Protected by OAuth</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6}>
          <Tooltip.Popup className="max-w-72 rounded-lg bg-ink-900 px-3 py-2 text-xs/normal text-white shadow-lg dark:bg-ink-100 dark:text-ink-900">
            OAuth · {tokenCount} {tokenCount === 1 ? 'token' : 'tokens'}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const describeTools = ({
  publishedToolCount: published,
  toolCount,
}: ServerSummary): string => {
  const drafts = toolCount - published;
  const tools =
    published === 0
      ? 'No tools'
      : `${published} ${published === 1 ? 'tool' : 'tools'}`;
  return drafts === 0
    ? tools
    : `${tools} · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
};
