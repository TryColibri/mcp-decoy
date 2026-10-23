import { type SubmitEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';

import {
  ApiError,
  client,
  keys,
  unwrap,
  useInstance,
  useServers,
} from '@/ui/api';
import { Button, ButtonLink } from '@/ui/components/button';
import { serverEndpoint } from '@/ui/components/endpoint';
import {
  checkServerName,
  ServerFields,
  type ServerFormValues,
} from '@/ui/components/server-fields';

/** `/servers/new`: create a mock server. */
export function NewServerPage() {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const { data: servers } = useServers();
  const { data: instance } = useInstance();

  const [values, setValues] = useState<ServerFormValues>({
    name: '',
    infoName: '',
    version: '',
    instructions: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  const { name, infoName, version, instructions } = values;
  const { valid, error: nameError } = checkServerName(
    name,
    servers?.map((server) => server.name) ?? [],
  );
  const endpoint = serverEndpoint(
    instance?.mcp.urlTemplate,
    name === '' ? 'my-server' : name,
  );

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const serverInfo = {
        ...(infoName.trim() === '' ? {} : { name: infoName }),
        ...(version.trim() === '' ? {} : { version }),
      };
      await unwrap(
        client.servers.$post({
          json: {
            name,
            ...(Object.keys(serverInfo).length === 0 ? {} : { serverInfo }),
            ...(instructions.trim() === '' ? {} : { instructions }),
          },
        }),
      );
      await mutate(keys.servers);
      await navigate(`/servers/${name}/tools`);
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
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-paper-200 bg-white px-6 py-4.5">
        <Link to="/" className="py-1.5 text-sm font-medium no-underline">
          Servers
        </Link>
        <span aria-hidden="true" className="text-ink-400">
          /
        </span>
        <h1 className="m-0 text-xl font-bold tracking-tight">New server</h1>
      </div>

      <form
        onSubmit={submit}
        noValidate
        className="mx-auto box-border flex w-full max-w-190 flex-1 flex-col gap-5 px-6 pt-7 pb-12"
      >
        <section
          aria-labelledby="identity-heading"
          className="flex flex-col gap-4.5 rounded-xl border border-paper-200 bg-white p-5.5"
        >
          <h2 id="identity-heading" className="m-0 text-base font-semibold">
            Identity
          </h2>

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
        </section>

        {formError !== null && (
          <p role="alert" className="m-0 text-[13px] text-red-800">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!valid || submitting}
          >
            {submitting ? 'Creating…' : 'Create server'}
          </Button>
          <ButtonLink to="/">Cancel</ButtonLink>
          <span className="text-[13px] text-ink-600">
            Starts with no tools. Add them next — it’s live as soon as it’s
            created.
          </span>
        </div>
      </form>
    </>
  );
}
