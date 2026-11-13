import { type SubmitEvent, useId, useState } from 'react';
import { useSWRConfig } from 'swr';

import { SUPPORTED_SCOPES } from '@/shared/api';
import { ApiError, client, keys, unwrap } from '@/ui/api';
import { Button } from '@/ui/components/button';

/** Props of `ScopesEditor`. */
export type ScopesEditorProps = {
  /** The server on OAuth. */
  server: string;
  /** The scopes its pre-registered client has now. */
  clientScopes: string[];
};

const parseScopes = (text: string): string[] =>
  text.split(/\s+/).filter((scope) => scope !== '');

/**
 * Edits the scopes of a server's pre-registered client, space-separated.
 * Saving, like any change of a server's authentication, revokes its tokens
 * and closes its live sessions. Remount it with a new `key` when
 * `clientScopes` changes so the text follows the saved value.
 */
export function ScopesEditor({ server, clientScopes }: ScopesEditorProps) {
  const { mutate } = useSWRConfig();
  const scopesId = useId();
  const scopesHintId = useId();
  const [text, setText] = useState(clientScopes.join(' '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseScopes(text);
  const changed = parsed.join(' ') !== clientScopes.join(' ');

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
          json: { auth: { mode: 'oauth', clientScopes: parsed } },
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
    <form onSubmit={save} noValidate className="flex flex-col gap-1.5">
      <p className="m-0 text-xs font-semibold text-ink-500 uppercase dark:text-ink-400">
        <label htmlFor={scopesId}>Pre-registered client scopes</label>{' '}
        <span id={scopesHintId} className="font-normal normal-case">
          Space-separated. Any client may also request{' '}
          {SUPPORTED_SCOPES.join(', ')}.
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
