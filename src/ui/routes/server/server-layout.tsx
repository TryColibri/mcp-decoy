import { AlertDialog } from '@base-ui/react/alert-dialog';
import { TrashIcon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { useSWRConfig } from 'swr';
import { twMerge } from 'tailwind-merge';

import { type ServerSummary } from '@/shared/api';
import { client, keys, unwrapEmpty, useServer } from '@/ui/api';
import { Button, ButtonLink, buttonClasses } from '@/ui/components/button';
import { EndpointPill } from '@/ui/components/endpoint-pill';

import { EditServerButton } from './edit-server-button';

/** What the server layout hands to its tabs. */
export type ServerOutletContext = {
  /** The server shown by the layout, kept fresh by polling. */
  server: ServerSummary;
};

/** The server of the current `/servers/:server/*` route. */
export function useServerContext(): ServerOutletContext {
  return useOutletContext<ServerOutletContext>();
}

/** `/servers/:server/*`: header, edit and delete actions and the Logs | Tools | Connections tabs. */
export function ServerLayout() {
  const { server: name = '' } = useParams();
  const { data: server, error } = useServer(name);

  if (error?.status === 404) {
    return <ServerNotFound name={name} />;
  }
  if (error !== undefined) {
    return (
      <p
        role="alert"
        className="m-0 p-6 text-sm text-red-800 dark:text-red-400"
      >
        Could not load server “{name}”: {error.message}
      </p>
    );
  }
  if (server === undefined) {
    return (
      <p className="m-0 p-6 text-sm text-ink-500 dark:text-ink-400">Loading…</p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-paper-200 bg-white px-6 pt-4.5 dark:border-paper-800 dark:bg-paper-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link to="/" className="py-1.5 text-sm font-medium no-underline">
            Servers
          </Link>
          <span aria-hidden="true" className="text-ink-400 dark:text-ink-500">
            /
          </span>
          <h1 className="m-0 text-xl font-bold tracking-tight">
            {server.name}
          </h1>
          <EndpointPill url={server.mcpUrl} />
          <div className="ml-auto flex gap-3">
            <EditServerButton server={server}>Edit server</EditServerButton>
            <DeleteServerButton name={server.name} />
          </div>
        </div>
        <nav aria-label="Server" className="flex gap-5">
          <Tab to="connections">
            Connections
            <SessionCount count={server.sessionCount} />
          </Tab>
          <Tab to="logs">Logs</Tab>
          <Tab to="tools">Tools</Tab>
        </nav>
      </div>
      <Outlet context={{ server } satisfies ServerOutletContext} />
    </div>
  );
}

type TabProps = {
  to: string;
  children: ReactNode;
};

function Tab({ to, children }: TabProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        twMerge(
          'inline-flex min-h-10.5 items-center border-b-2 px-1 text-sm font-medium no-underline',
          isActive
            ? 'border-ink-900 text-ink-900 hover:text-ink-900 dark:border-ink-100 dark:text-ink-100 dark:hover:text-ink-100'
            : 'border-transparent text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100',
        )
      }
    >
      {children}
    </NavLink>
  );
}

type SessionCountProps = {
  count: number;
};

/** The live-session count in the Connections tab, hidden when there is none. */
function SessionCount({ count }: SessionCountProps) {
  if (count === 0) {
    return null;
  }
  return (
    <span className="ml-1.5 rounded-full bg-paper-100 px-1.5 text-xs font-medium text-ink-600 dark:bg-paper-800 dark:text-ink-300">
      <span className="sr-only">Live sessions: </span>
      {count}
    </span>
  );
}

type DeleteServerButtonProps = {
  name: string;
};

function DeleteServerButton({ name }: DeleteServerButtonProps) {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].$delete({ param: { server: name } }),
      );
      await mutate(keys.servers);
      await navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setDeleting(false);
    }
  };

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className={buttonClasses('danger', 'small')}>
        <TrashIcon className="size-3.5" aria-hidden="true" />
        Delete server
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-ink-900/30 dark:bg-black/60" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-paper-200 bg-white p-6 shadow-xl dark:border-paper-800 dark:bg-paper-900">
          <AlertDialog.Title className="m-0 text-base font-semibold">
            Delete “{name}”?
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-sm/relaxed text-ink-600 dark:text-ink-300">
            Its tools are deleted and its live sessions are closed. Clients get
            404 on their next request. This can’t be undone.
          </AlertDialog.Description>
          {error !== null && (
            <p
              role="alert"
              className="m-0 text-[13px] text-red-800 dark:text-red-400"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <AlertDialog.Close className={buttonClasses('secondary', 'small')}>
              Cancel
            </AlertDialog.Close>
            <Button
              variant="primary"
              size="small"
              onClick={remove}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete server'}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type ServerNotFoundProps = {
  name: string;
};

function ServerNotFound({ name }: ServerNotFoundProps) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-6 py-16">
      <h1 className="m-0 text-[28px] font-bold tracking-tight">
        Server not found
      </h1>
      <p className="m-0 text-[15px] text-ink-600 dark:text-ink-300">
        There is no server named <span className="font-mono">{name}</span>. It
        may have been deleted.
      </p>
      <ButtonLink to="/" variant="primary">
        Back to servers
      </ButtonLink>
    </main>
  );
}
