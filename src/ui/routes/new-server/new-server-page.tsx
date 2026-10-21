import { type SubmitEvent, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';

import { serverNameSchema } from '@/shared/api';
import {
  ApiError,
  client,
  keys,
  unwrap,
  useInstance,
  useServers,
} from '@/ui/api';
import { Button, ButtonLink } from '@/ui/components/button';
import { displayEndpoint } from '@/ui/components/endpoint';

const DEFAULT_VERSION = '0.1.0';

const control =
  'box-border min-h-10 w-full rounded-lg border bg-surface px-3 text-sm font-medium text-ink';

/** `/servers/new`: create a mock server. */
export function NewServerPage() {
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const { data: servers } = useServers();
  const { data: instance } = useInstance();
  const ids = {
    name: useId(),
    nameHint: useId(),
    nameError: useId(),
    infoName: useId(),
    infoVersion: useId(),
    instructions: useId(),
    instructionsHint: useId(),
  };

  const [name, setName] = useState('');
  const [infoName, setInfoName] = useState<string | null>(null);
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  const slug = name === '' ? 'my-server' : name;
  const parsed = serverNameSchema.safeParse(name);
  const taken = servers?.some((server) => server.name === name) ?? false;
  const nameError =
    name === ''
      ? null
      : taken
        ? `A server named “${name}” already exists.`
        : parsed.success
          ? (serverErrors.name ?? null)
          : (parsed.error.issues.at(0)?.message ?? 'Invalid name');
  const effectiveInfoName = infoName ?? `decoy/${slug}`;
  const valid =
    parsed.success && !taken && effectiveInfoName !== '' && version !== '';

  const endpoint =
    instance === undefined
      ? `localhost:6280/s/${slug}/mcp`
      : displayEndpoint(instance.mcp.urlTemplate.replace('{server}', slug));

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || submitting) {
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await unwrap(
        client.servers.$post({
          json: {
            name,
            serverInfo: { name: effectiveInfoName, version },
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-6 py-[18px]">
        <Link to="/" className="py-1.5 text-sm font-medium no-underline">
          Servers
        </Link>
        <span aria-hidden="true" className="text-ink-faint">
          /
        </span>
        <h1 className="m-0 text-xl font-bold tracking-tight">New server</h1>
      </div>

      <form
        onSubmit={submit}
        noValidate
        className="mx-auto box-border flex w-full max-w-[760px] flex-1 flex-col gap-5 px-6 pt-7 pb-12"
      >
        <section
          aria-labelledby="identity-heading"
          className="flex flex-col gap-[18px] rounded-xl border border-line bg-surface p-[22px]"
        >
          <h2 id="identity-heading" className="m-0 text-base font-semibold">
            Identity
          </h2>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ids.name}
              className="text-[13px] font-semibold text-ink-2"
            >
              Name{' '}
              <span
                id={ids.nameHint}
                className="text-xs font-normal text-ink-4"
              >
                Lowercase letters, digits and dashes. Becomes part of the URL.
              </span>
            </label>
            <input
              id={ids.name}
              className={`${control} font-mono ${
                nameError === null ? 'border-control' : 'border-error-line'
              }`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setServerErrors({});
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder="weather"
              aria-describedby={`${ids.nameHint} ${nameError === null ? '' : ids.nameError}`}
              aria-invalid={nameError !== null}
              required
            />
            {nameError !== null && (
              <span
                id={ids.nameError}
                role="alert"
                className="text-[13px] text-error"
              >
                {nameError}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3.5 py-3">
            <span className="text-[13px] text-ink-3">Endpoint</span>
            <span className="font-mono text-[13px] [overflow-wrap:anywhere] text-ink">
              {endpoint}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={ids.infoName}
                className="text-[13px] font-semibold text-ink-2"
              >
                serverInfo.name
              </label>
              <input
                id={ids.infoName}
                className={`${control} border-control font-mono`}
                value={effectiveInfoName}
                onChange={(event) => {
                  setInfoName(event.target.value);
                }}
                spellCheck={false}
                aria-invalid={effectiveInfoName === ''}
              />
              {serverErrors['serverInfo.name'] !== undefined && (
                <span role="alert" className="text-[13px] text-error">
                  {serverErrors['serverInfo.name']}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={ids.infoVersion}
                className="text-[13px] font-semibold text-ink-2"
              >
                serverInfo.version
              </label>
              <input
                id={ids.infoVersion}
                className={`${control} border-control font-mono`}
                value={version}
                onChange={(event) => {
                  setVersion(event.target.value);
                }}
                spellCheck={false}
                aria-invalid={version === ''}
              />
              {serverErrors['serverInfo.version'] !== undefined && (
                <span role="alert" className="text-[13px] text-error">
                  {serverErrors['serverInfo.version']}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ids.instructions}
              className="text-[13px] font-semibold text-ink-2"
            >
              Instructions{' '}
              <span
                id={ids.instructionsHint}
                className="text-xs font-normal text-ink-4"
              >
                Optional. Returned to the client in the initialize result.
              </span>
            </label>
            <textarea
              id={ids.instructions}
              rows={3}
              className="box-border min-h-20 w-full resize-y rounded-lg border border-control bg-surface px-3 py-2.5 text-sm text-ink"
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
              }}
              aria-describedby={ids.instructionsHint}
            />
          </div>
        </section>

        {formError !== null && (
          <p role="alert" className="m-0 text-[13px] text-error">
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
          <span className="text-[13px] text-ink-3">
            Starts with no tools. Add them next — it’s live as soon as it’s
            created.
          </span>
        </div>
      </form>
    </>
  );
}
