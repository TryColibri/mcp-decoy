import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { type ComponentProps, useId } from 'react';
import { twMerge } from 'tailwind-merge';

import {
  type CacheScope,
  DEFAULT_PROTOCOL,
  type ServerAuthInput,
  type ServerEras,
  type ServerProtocolInput,
  serverNameSchema,
} from '@/shared/api';
import { CopyButton } from '@/ui/components/copy-button';
import { tw } from '@/ui/tw';

const control = tw`box-border min-h-10 w-full rounded-lg border bg-white px-3 font-mono text-sm font-medium text-ink-900 dark:bg-paper-900 dark:text-ink-100`;

/** What the server form edits. Empty strings mean "not set". */
export type ServerFormValues = {
  /** URL slug. */
  name: string;
  /** `serverInfo.name`. */
  infoName: string;
  /** `serverInfo.version`. */
  version: string;
  /** `instructions`. */
  instructions: string;
  /** Authentication mode. */
  authMode: 'none' | 'oauth';
  /** Protocol generations the server accepts. */
  eras: ServerEras;
  /** Cache lifetime of 2026-07-28 results in milliseconds, as typed. */
  ttlMs: string;
  /** Who may cache 2026-07-28 results. */
  cacheScope: CacheScope;
};

/** The protocol fields of a form that has not been touched. */
export const DEFAULT_PROTOCOL_VALUES: Pick<
  ServerFormValues,
  'eras' | 'ttlMs' | 'cacheScope'
> = {
  eras: DEFAULT_PROTOCOL.eras,
  ttlMs: String(DEFAULT_PROTOCOL.cache.ttlMs),
  cacheScope: DEFAULT_PROTOCOL.cache.scope,
};

/**
 * Validates the cache lifetime as the user types it.
 *
 * @param ttlMs - The text of the field.
 * @returns What to tell the user, or `null` when it is a valid number of milliseconds.
 */
export function checkTTL(ttlMs: string): string | null {
  const trimmed = ttlMs.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return 'Use a whole number of milliseconds, 0 or more.';
  }
  return null;
}

/**
 * Builds the `protocol` request field from the form, with only what differs
 * from `from`. `undefined` when nothing does.
 *
 * @param values - The form's protocol fields.
 * @param from - What the server has now, or the defaults for a new server.
 */
export function protocolInputOf(
  {
    eras,
    ttlMs,
    cacheScope,
  }: Pick<ServerFormValues, 'eras' | 'ttlMs' | 'cacheScope'>,
  from: Pick<
    ServerFormValues,
    'eras' | 'ttlMs' | 'cacheScope'
  > = DEFAULT_PROTOCOL_VALUES,
): ServerProtocolInput | undefined {
  const cache = {
    ...(Number(ttlMs) === Number(from.ttlMs) ? {} : { ttlMs: Number(ttlMs) }),
    ...(cacheScope === from.cacheScope ? {} : { scope: cacheScope }),
  };
  const protocol: ServerProtocolInput = {
    ...(eras === from.eras ? {} : { eras }),
    ...(Object.keys(cache).length === 0 ? {} : { cache }),
  };
  return Object.keys(protocol).length === 0 ? undefined : protocol;
}

/** Result of `checkServerName`. */
export type ServerNameCheck = {
  /** Whether the name can be submitted. */
  valid: boolean;
  /** What to tell the user, or `null` when the name is empty or fine. */
  error: string | null;
};

/**
 * Validates a server name as the user types it.
 *
 * @param name - The name being typed.
 * @param taken - Names of the other servers.
 */
export function checkServerName(
  name: string,
  taken: readonly string[],
): ServerNameCheck {
  const parsed = serverNameSchema.safeParse(name);
  if (taken.includes(name)) {
    return { valid: false, error: `A server named “${name}” already exists.` };
  }
  if (parsed.success) {
    return { valid: true, error: null };
  }
  return {
    valid: false,
    error:
      name === ''
        ? null
        : (parsed.error.issues.at(0)?.message ?? 'Invalid name'),
  };
}

/**
 * Builds the `auth` request field from the form's authentication mode. A new
 * OAuth server has no redirect URIs; they are added from the Connections tab.
 *
 * @param values - `authMode` of the form.
 */
export function authInputOf({
  authMode,
}: Pick<ServerFormValues, 'authMode'>): ServerAuthInput {
  return { mode: authMode };
}

/** Props of `ServerFields`. */
export type ServerFieldsProps = Omit<
  ComponentProps<'div'>,
  'children' | 'onChange'
> & {
  /** Current values. */
  values: ServerFormValues;
  /** Called with the new values on every edit. */
  onChange: (values: ServerFormValues) => void;
  /** Problem with the name, shown under it. */
  nameError: string | null;
  /** Errors returned by the API, keyed by dotted path. */
  fieldErrors: Partial<Record<string, string>>;
  /** Endpoint clients will connect to, for the current name. */
  endpoint: string;
};

/**
 * The fields of a server: name, endpoint preview, `serverInfo` and
 * instructions. Shared by the new server page and the edit dialog.
 * `className` is merged over the layout styles; `ref` is the wrapping `<div>`.
 */
export function ServerFields({
  values,
  onChange,
  nameError,
  fieldErrors,
  endpoint,
  className,
  ...props
}: ServerFieldsProps) {
  const ids = {
    name: useId(),
    nameHint: useId(),
    nameError: useId(),
    infoName: useId(),
    infoVersion: useId(),
    instructions: useId(),
    instructionsHint: useId(),
    authNone: useId(),
    authOAuth: useId(),
    ttlMs: useId(),
    ttlMsError: useId(),
    cacheScope: useId(),
  };
  const ttlError = checkTTL(values.ttlMs);
  const shownTTLError = ttlError ?? fieldErrors['protocol.cache.ttlMs'] ?? null;
  const slug = values.name === '' ? 'my-server' : values.name;
  const nameInvalid = nameError !== null || fieldErrors.name !== undefined;
  const shownNameError = nameError ?? fieldErrors.name ?? null;

  return (
    <div {...props} className={twMerge('flex flex-col gap-4.5', className)}>
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13px] font-semibold text-ink-700 dark:text-ink-200">
          <label htmlFor={ids.name}>Name</label>{' '}
          <span
            id={ids.nameHint}
            className="text-xs font-normal text-ink-500 dark:text-ink-400"
          >
            Lowercase letters, digits and dashes. Becomes part of the URL.
          </span>
        </p>
        <input
          id={ids.name}
          className={twMerge(
            control,
            nameInvalid
              ? 'border-red-700 dark:border-red-500'
              : 'border-paper-300 dark:border-paper-700',
          )}
          value={values.name}
          onChange={(event) => {
            onChange({ ...values, name: event.target.value });
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="my-server"
          aria-describedby={
            nameInvalid ? `${ids.nameHint} ${ids.nameError}` : ids.nameHint
          }
          aria-invalid={nameInvalid}
          required
        />
        {shownNameError !== null && (
          <span
            id={ids.nameError}
            role="alert"
            className="text-[13px] text-red-800 dark:text-red-400"
          >
            {shownNameError}
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-paper-100 py-1.5 pr-1.5 pl-3.5 dark:bg-paper-800">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
          <span className="text-[13px] text-ink-600 dark:text-ink-300">
            Endpoint
          </span>
          <span className="font-mono text-[13px] wrap-anywhere text-ink-900 dark:text-ink-100">
            {endpoint}
          </span>
        </div>
        <CopyButton
          text={endpoint}
          label="Copy endpoint URL"
          className="size-7"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={ids.infoName}
            className="text-[13px] font-semibold text-ink-700 dark:text-ink-200"
          >
            serverInfo.name
          </label>
          <input
            id={ids.infoName}
            className={twMerge(
              control,
              'border-paper-300 dark:border-paper-700',
            )}
            value={values.infoName}
            onChange={(event) => {
              onChange({ ...values, infoName: event.target.value });
            }}
            placeholder={`mcp-decoy/${slug}`}
            autoComplete="off"
            spellCheck={false}
          />
          {fieldErrors['serverInfo.name'] !== undefined && (
            <span
              role="alert"
              className="text-[13px] text-red-800 dark:text-red-400"
            >
              {fieldErrors['serverInfo.name']}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={ids.infoVersion}
            className="text-[13px] font-semibold text-ink-700 dark:text-ink-200"
          >
            serverInfo.version
          </label>
          <input
            id={ids.infoVersion}
            className={twMerge(
              control,
              'border-paper-300 dark:border-paper-700',
            )}
            value={values.version}
            onChange={(event) => {
              onChange({ ...values, version: event.target.value });
            }}
            placeholder="0.1.0"
            autoComplete="off"
            spellCheck={false}
          />
          {fieldErrors['serverInfo.version'] !== undefined && (
            <span
              role="alert"
              className="text-[13px] text-red-800 dark:text-red-400"
            >
              {fieldErrors['serverInfo.version']}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13px] font-semibold text-ink-700 dark:text-ink-200">
          <label htmlFor={ids.instructions}>Instructions</label>{' '}
          <span
            id={ids.instructionsHint}
            className="text-xs font-normal text-ink-500 dark:text-ink-400"
          >
            Optional. Returned to the client in the initialize result.
          </span>
        </p>
        <textarea
          id={ids.instructions}
          rows={3}
          className="box-border min-h-20 w-full resize-y rounded-lg border border-paper-300 bg-white px-3 py-2.5 text-sm text-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:text-ink-100"
          value={values.instructions}
          onChange={(event) => {
            onChange({ ...values, instructions: event.target.value });
          }}
          aria-describedby={ids.instructionsHint}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13px] font-semibold text-ink-700 dark:text-ink-200">
          Authentication
        </p>
        <RadioGroup
          value={values.authMode}
          onValueChange={(authMode: ServerFormValues['authMode']) => {
            onChange({ ...values, authMode });
          }}
          className="flex flex-col gap-2"
        >
          <label
            htmlFor={ids.authNone}
            className="flex items-center gap-2 text-sm text-ink-900 dark:text-ink-100"
          >
            <Radio.Root
              id={ids.authNone}
              value="none"
              className="flex size-4 items-center justify-center rounded-full border border-paper-300 bg-white data-checked:border-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:data-checked:border-ink-100"
            >
              <Radio.Indicator className="size-2 rounded-full bg-ink-900 dark:bg-ink-100" />
            </Radio.Root>
            None
          </label>
          <label
            htmlFor={ids.authOAuth}
            className="flex items-center gap-2 text-sm text-ink-900 dark:text-ink-100"
          >
            <Radio.Root
              id={ids.authOAuth}
              value="oauth"
              className="flex size-4 items-center justify-center rounded-full border border-paper-300 bg-white data-checked:border-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:data-checked:border-ink-100"
            >
              <Radio.Indicator className="size-2 rounded-full bg-ink-900 dark:bg-ink-100" />
            </Radio.Root>
            OAuth 2.1
          </label>
        </RadioGroup>
      </div>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[13px] font-semibold text-ink-700 dark:text-ink-200">
          Protocol{' '}
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            Which MCP generations this server speaks.
          </span>
        </legend>
        <RadioGroup
          aria-label="Protocol generations"
          value={values.eras}
          onValueChange={(eras: ServerFormValues['eras']) => {
            onChange({ ...values, eras });
          }}
          className="flex flex-col gap-2"
        >
          {ERA_OPTIONS.map(({ value, label }) => (
            <label
              key={value}
              className="flex items-center gap-2 text-sm text-ink-900 dark:text-ink-100"
            >
              <Radio.Root
                value={value}
                className="flex size-4 items-center justify-center rounded-full border border-paper-300 bg-white data-checked:border-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:data-checked:border-ink-100"
              >
                <Radio.Indicator className="size-2 rounded-full bg-ink-900 dark:bg-ink-100" />
              </Radio.Root>
              {label}
            </label>
          ))}
        </RadioGroup>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ids.ttlMs}
              className="text-[13px] font-semibold text-ink-700 dark:text-ink-200"
            >
              ttlMs
            </label>
            <input
              id={ids.ttlMs}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className={twMerge(
                control,
                shownTTLError === null
                  ? 'border-paper-300 dark:border-paper-700'
                  : 'border-red-700 dark:border-red-500',
              )}
              value={values.ttlMs}
              onChange={(event) => {
                onChange({ ...values, ttlMs: event.target.value });
              }}
              aria-invalid={shownTTLError !== null}
              aria-describedby={
                shownTTLError === null ? undefined : ids.ttlMsError
              }
            />
            {shownTTLError !== null && (
              <span
                id={ids.ttlMsError}
                role="alert"
                className="text-[13px] text-red-800 dark:text-red-400"
              >
                {shownTTLError}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ids.cacheScope}
              className="text-[13px] font-semibold text-ink-700 dark:text-ink-200"
            >
              cacheScope
            </label>
            <select
              id={ids.cacheScope}
              className={twMerge(
                control,
                'border-paper-300 dark:border-paper-700',
              )}
              value={values.cacheScope}
              onChange={(event) => {
                onChange({
                  ...values,
                  cacheScope:
                    event.target.value === 'public' ? 'public' : 'private',
                });
              }}
            >
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </div>
        </div>
        <p className="m-0 text-xs text-ink-500 dark:text-ink-400">
          The cache hint goes on 2026-07-28{' '}
          <span className="font-mono">tools/list</span> and{' '}
          <span className="font-mono">server/discover</span> results.
        </p>
      </fieldset>
    </div>
  );
}

const ERA_OPTIONS: ReadonlyArray<{ value: ServerEras; label: string }> = [
  { value: 'both', label: 'Both generations' },
  { value: 'legacy', label: '2025-11-25 only (sessions)' },
  { value: 'modern', label: '2026-07-28 only (stateless)' },
];
