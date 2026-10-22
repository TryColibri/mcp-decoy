import { AlertDialog } from '@base-ui/react/alert-dialog';
import { PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { useSWRConfig } from 'swr';
import { twMerge } from 'tailwind-merge';

import { type ServerSummary } from '@/shared/api';
import { client, keys, unwrapEmpty, useServer } from '@/ui/api';
import { Button, ButtonLink, buttonClasses } from '@/ui/components/button';
import { EditServerDialog } from '@/ui/components/edit-server-dialog';
import { EndpointPill } from '@/ui/components/endpoint-pill';
import { SessionsPill } from '@/ui/components/sessions-pill';

/** What the server layout hands to its tabs. */
export type ServerOutletContext = {
  /** The server shown by the layout, kept fresh by polling. */
  server: ServerSummary;
};

/** The server of the current `/servers/:server/*` route. */
export function useServerContext(): ServerOutletContext {
  return useOutletContext<ServerOutletContext>();
}

/** `/servers/:server/*`: header, edit and delete actions and the Logs | Tools tabs. */
export function ServerLayout() {
  const { server: name = '' } = useParams();
  const { data: server, error } = useServer(name);

  if (error?.status === 404) {
    return <ServerNotFound name={name} />;
  }
  if (error !== undefined) {
    return (
      <p role="alert" className="m-0 p-6 text-sm text-error">
        Could not load server “{name}”: {error.message}
      </p>
    );
  }
  if (server === undefined) {
    return <p className="m-0 p-6 text-sm text-ink-4">Loading…</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line bg-surface px-6 pt-4.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link to="/" className="py-1.5 text-sm font-medium no-underline">
            Servers
          </Link>
          <span aria-hidden="true" className="text-ink-faint">
            /
          </span>
          <h1 className="m-0 text-xl font-bold tracking-tight">
            {server.name}
          </h1>
          <EndpointPill url={server.mcpUrl} />
          <SessionsPill count={server.sessionCount} long />
          <div className="ml-auto flex gap-3">
            <EditServerButton server={server} />
            <DeleteServerButton name={server.name} />
          </div>
        </div>
        <nav aria-label="Server" className="flex gap-5">
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
  children: string;
};

function Tab({ to, children }: TabProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        twMerge(
          'inline-flex min-h-10.5 items-center border-b-2 px-1 text-sm font-medium no-underline',
          isActive
            ? 'border-ink text-ink hover:text-ink'
            : 'border-transparent text-ink-3 hover:text-ink',
        )
      }
    >
      {children}
    </NavLink>
  );
}

type EditServerButtonProps = {
  server: ServerSummary;
};

function EditServerButton({ server }: EditServerButtonProps) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [editing, setEditing] = useState(false);

  // A rename moves every tab of the server to the new URL.
  const follow = (updated: ServerSummary, previousName: string) => {
    if (updated.name !== previousName) {
      const prefix = `/servers/${previousName}`;
      void navigate(
        `/servers/${updated.name}${pathname.slice(prefix.length)}${search}`,
        { replace: true },
      );
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        onClick={() => {
          setEditing(true);
        }}
      >
        <PencilSimpleIcon size={14} aria-hidden="true" />
        Edit server
      </Button>
      {editing && (
        <EditServerDialog
          server={server}
          onSaved={follow}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </>
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
        <TrashIcon size={14} aria-hidden="true" />
        Delete server
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-ink/30" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-xl">
          <AlertDialog.Title className="m-0 text-base font-semibold">
            Delete “{name}”?
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-sm/relaxed text-ink-3">
            Its tools are deleted and its live sessions are closed. Clients get
            404 on their next request. This can’t be undone.
          </AlertDialog.Description>
          {error !== null && (
            <p role="alert" className="m-0 text-[13px] text-error">
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
      <p className="m-0 text-[15px] text-ink-3">
        There is no server named <span className="font-mono">{name}</span>. It
        may have been deleted.
      </p>
      <ButtonLink to="/" variant="primary">
        Back to servers
      </ButtonLink>
    </main>
  );
}
