import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { type SubmitEvent, useId, useState } from 'react';
import { useSWRConfig } from 'swr';

import { type ScopePolicy, SUPPORTED_SCOPES } from '@/shared/api';
import { ApiError, client, keys, unwrap } from '@/ui/api';
import { Button } from '@/ui/components/button';

/** Props of `ScopesEditor`. */
export type ScopesEditorProps = {
  /** The server on OAuth. */
  server: string;
  /** The scope policy it has now. */
  scopePolicy: ScopePolicy;
  /** The scopes its pre-registered client has now. */
  clientScopes: string[];
};

const parseScopes = (text: string): string[] =>
  text.split(/\s+/).filter((scope) => scope !== '');

const POLICIES: Array<{ value: ScopePolicy; label: string; hint: string }> = [
  {
    value: 'lenient',
    label: 'Lenient',
    hint: `A client may request ${SUPPORTED_SCOPES.join(', ')} even if it registered without a scope, plus any scope it registered with.`,
  },
  {
    value: 'strict',
    label: 'Strict',
    hint: 'A client may request only the scopes it registered with. Anything else gets invalid_scope.',
  },
];

/**
 * Edits which scopes clients may request at `/authorize`: the scope policy
 * and the scopes of the pre-registered client. Saving, like any change of a
 * server's authentication, revokes its tokens and closes its live sessions.
 * Remount it with a new `key` when the saved values change so the form
 * follows them.
 */
export function ScopesEditor({
  server,
  scopePolicy,
  clientScopes,
}: ScopesEditorProps) {
  const { mutate } = useSWRConfig();
  const scopesId = useId();
  const scopesHintId = useId();
  const policyLabelId = useId();
  const [policy, setPolicy] = useState(scopePolicy);
  const [text, setText] = useState(clientScopes.join(' '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseScopes(text);
  const changed =
    policy !== scopePolicy || parsed.join(' ') !== clientScopes.join(' ');

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await unwrap(
        client.servers[':server'].$patch({
          param: { server },
          json: {
            auth: { mode: 'oauth', scopePolicy: policy, clientScopes: parsed },
          },
        }),
      );
      await mutate(keys.server(server));
      void mutate(keys.servers);
      void mutate(keys.sessions(server));
      void mutate(keys.oauthTokens(server));
    } catch (caught) {
      const fieldErrors =
        caught instanceof ApiError ? Object.values(caught.fieldErrors) : [];
      setError(
        fieldErrors.length > 0
          ? fieldErrors.join(' ')
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p
          id={policyLabelId}
          className="m-0 text-xs font-semibold text-ink-500 uppercase dark:text-ink-400"
        >
          Scope policy
        </p>
        <RadioGroup
          value={policy}
          onValueChange={(value: ScopePolicy) => {
            setPolicy(value);
          }}
          aria-labelledby={policyLabelId}
          className="flex flex-col gap-2"
        >
          {POLICIES.map(({ value, label, hint }) => (
            <PolicyOption key={value} value={value} hint={hint}>
              {label}
            </PolicyOption>
          ))}
        </RadioGroup>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-xs font-semibold text-ink-500 uppercase dark:text-ink-400">
          <label htmlFor={scopesId}>Pre-registered client scopes</label>{' '}
          <span id={scopesHintId} className="font-normal normal-case">
            Space-separated, as in the scope parameter.
          </span>
        </p>
        <input
          id={scopesId}
          type="text"
          className="box-border min-h-10 w-full rounded-lg border border-paper-300 bg-white px-3 font-mono text-sm text-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:text-ink-100"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder="mcp"
          spellCheck={false}
          aria-describedby={scopesHintId}
        />
      </div>
      {error !== null && (
        <p
          role="alert"
          className="m-0 text-[13px] text-red-800 dark:text-red-400"
        >
          {error}
        </p>
      )}
      {changed && (
        <p className="m-0 text-[13px]/relaxed text-ink-600 dark:text-ink-300">
          Saving revokes every token and closes live sessions. Clients must
          reconnect and re-authorize.
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          size="small"
          disabled={!changed || saving}
        >
          {saving ? 'Saving…' : 'Save scopes'}
        </Button>
        {changed && (
          <Button
            size="small"
            disabled={saving}
            onClick={() => {
              setPolicy(scopePolicy);
              setText(clientScopes.join(' '));
              setError(null);
            }}
          >
            Reset
          </Button>
        )}
      </div>
    </form>
  );
}

type PolicyOptionProps = {
  value: ScopePolicy;
  hint: string;
  children: string;
};

function PolicyOption({ value, hint, children }: PolicyOptionProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex items-start gap-2">
      <Radio.Root
        id={id}
        value={value}
        aria-describedby={hintId}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-white data-checked:border-ink-900 dark:border-paper-700 dark:bg-paper-900 dark:data-checked:border-ink-100"
      >
        <Radio.Indicator className="size-2 rounded-full bg-ink-900 dark:bg-ink-100" />
      </Radio.Root>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm text-ink-900 dark:text-ink-100">
          {children}
        </label>
        <span
          id={hintId}
          className="text-[13px]/relaxed text-ink-600 dark:text-ink-300"
        >
          {hint}
        </span>
      </div>
    </div>
  );
}
