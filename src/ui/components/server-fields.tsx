import { type ComponentProps, useId } from 'react';
import { twMerge } from 'tailwind-merge';

import { serverNameSchema } from '@/shared/api';
import { CopyButton } from '@/ui/components/copy-button';
import { tw } from '@/ui/tw';

const control = tw`box-border min-h-10 w-full rounded-lg border bg-white px-3 font-mono text-sm font-medium text-ink-900`;

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
};

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
  };
  const slug = values.name === '' ? 'my-server' : values.name;
  const nameInvalid = nameError !== null || fieldErrors.name !== undefined;
  const shownNameError = nameError ?? fieldErrors.name ?? null;

  return (
    <div {...props} className={twMerge('flex flex-col gap-4.5', className)}>
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13px] font-semibold text-ink-700">
          <label htmlFor={ids.name}>Name</label>{' '}
          <span id={ids.nameHint} className="text-xs font-normal text-ink-500">
            Lowercase letters, digits and dashes. Becomes part of the URL.
          </span>
        </p>
        <input
          id={ids.name}
          className={twMerge(
            control,
            nameInvalid ? 'border-red-700' : 'border-paper-300',
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
            className="text-[13px] text-red-800"
          >
            {shownNameError}
          </span>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-paper-100 py-1.5 pr-1.5 pl-3.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
          <span className="text-[13px] text-ink-600">Endpoint</span>
          <span className="font-mono text-[13px] wrap-anywhere text-ink-900">
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
            className="text-[13px] font-semibold text-ink-700"
          >
            serverInfo.name
          </label>
          <input
            id={ids.infoName}
            className={twMerge(control, 'border-paper-300')}
            value={values.infoName}
            onChange={(event) => {
              onChange({ ...values, infoName: event.target.value });
            }}
            placeholder={`mcp-decoy/${slug}`}
            autoComplete="off"
            spellCheck={false}
          />
          {fieldErrors['serverInfo.name'] !== undefined && (
            <span role="alert" className="text-[13px] text-red-800">
              {fieldErrors['serverInfo.name']}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={ids.infoVersion}
            className="text-[13px] font-semibold text-ink-700"
          >
            serverInfo.version
          </label>
          <input
            id={ids.infoVersion}
            className={twMerge(control, 'border-paper-300')}
            value={values.version}
            onChange={(event) => {
              onChange({ ...values, version: event.target.value });
            }}
            placeholder="0.1.0"
            autoComplete="off"
            spellCheck={false}
          />
          {fieldErrors['serverInfo.version'] !== undefined && (
            <span role="alert" className="text-[13px] text-red-800">
              {fieldErrors['serverInfo.version']}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[13px] font-semibold text-ink-700">
          <label htmlFor={ids.instructions}>Instructions</label>{' '}
          <span
            id={ids.instructionsHint}
            className="text-xs font-normal text-ink-500"
          >
            Optional. Returned to the client in the initialize result.
          </span>
        </p>
        <textarea
          id={ids.instructions}
          rows={3}
          className="box-border min-h-20 w-full resize-y rounded-lg border border-paper-300 bg-white px-3 py-2.5 text-sm text-ink-900"
          value={values.instructions}
          onChange={(event) => {
            onChange({ ...values, instructions: event.target.value });
          }}
          aria-describedby={ids.instructionsHint}
        />
      </div>
    </div>
  );
}
