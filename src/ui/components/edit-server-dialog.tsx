import { Dialog } from '@base-ui/react/dialog';
import { type SubmitEvent, useState } from 'react';
import { useSWRConfig } from 'swr';

import { type ServerSummary, type UpdateServerRequest } from '@/shared/api';
import {
  ApiError,
  client,
  keys,
  unwrap,
  useInstance,
  useServers,
} from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';
import { serverEndpoint } from '@/ui/components/endpoint';
import {
  checkServerName,
  ServerFields,
  type ServerFormValues,
} from '@/ui/components/server-fields';

/** Props of `EditServerDialog`. */
export type EditServerDialogProps = {
  /** The server to edit. The form starts from its current values. */
  server: ServerSummary;
  /** Called when the dialog should close: cancelled, dismissed or saved. */
  onClose: () => void;
  /**
   * Called after a successful save, before `onClose`.
   *
   * @param updated - The server as saved.
   * @param previousName - Its name before the edit; differs from `updated.name` after a rename.
   */
  onSaved?: (updated: ServerSummary, previousName: string) => void;
};

const valuesOf = (server: ServerSummary): ServerFormValues => ({
  name: server.name,
  infoName: server.serverInfo.name,
  version: server.serverInfo.version,
  instructions: server.instructions ?? '',
});

/** The fields that differ from `server`, as an update request. */
const changesOf = (
  server: ServerSummary,
  values: ServerFormValues,
): UpdateServerRequest => {
  const before = valuesOf(server);
  const serverInfo = {
    ...(values.infoName === before.infoName ? {} : { name: values.infoName }),
    ...(values.version === before.version ? {} : { version: values.version }),
  };
  return {
    ...(values.name === before.name ? {} : { name: values.name }),
    ...(Object.keys(serverInfo).length === 0 ? {} : { serverInfo }),
    ...(values.instructions === before.instructions
      ? {}
      : { instructions: values.instructions }),
  };
};

/**
 * A modal form to edit a server's name, `serverInfo` and instructions. Mount
 * it to open it; it closes through `onClose`. Renaming changes the endpoint
 * URL, closes live sessions and keeps the logs.
 */
export function EditServerDialog({
  server,
  onClose,
  onSaved,
}: EditServerDialogProps) {
  const { mutate } = useSWRConfig();
  const { data: servers } = useServers();
  const { data: instance } = useInstance();

  const [values, setValues] = useState(() => valuesOf(server));
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  const changes = changesOf(server, values);
  const changed = Object.keys(changes).length > 0;
  const renaming = changes.name !== undefined;
  const { valid, error: nameError } = checkServerName(
    values.name,
    servers
      ?.map((other) => other.name)
      .filter((other) => other !== server.name) ?? [],
  );
  const endpoint = serverEndpoint(instance?.mcp.urlTemplate, values.name);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || !changed || submitting) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const updated = await unwrap(
        client.servers[':server'].$patch({
          param: { server: server.name },
          json: changes,
        }),
      );
      await mutate(keys.server(updated.name), updated, { revalidate: false });
      void mutate(keys.servers);
      onSaved?.(updated, server.name);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setServerErrors(error.fieldErrors);
        setFormError(error.problem.errors === undefined ? error.message : null);
      } else {
        setFormError(String(error));
      }
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-ink-900/30" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-160 max-w-[calc(100vw-2rem)] -translate-1/2 overflow-y-auto rounded-xl border border-paper-200 bg-white p-6 shadow-xl">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4.5">
            <Dialog.Title className="m-0 text-base font-semibold">
              Edit “{server.name}”
            </Dialog.Title>
            <ServerFields
              values={values}
              onChange={(next) => {
                setValues(next);
                setServerErrors({});
              }}
              nameError={nameError}
              fieldErrors={serverErrors}
              endpoint={endpoint}
            />
            {renaming && (
              <Dialog.Description className="m-0 text-[13px]/relaxed text-ink-600">
                Renaming changes the endpoint URL. Live sessions are closed and
                clients must reconnect to the new URL. Logs are kept.
              </Dialog.Description>
            )}
            {formError !== null && (
              <p role="alert" className="m-0 text-[13px] text-red-800">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Dialog.Close className={buttonClasses('secondary', 'small')}>
                Cancel
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                size="small"
                disabled={!valid || !changed || submitting}
              >
                {submitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
