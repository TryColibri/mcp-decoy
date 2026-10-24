import { type SubmitEvent, useId, useState } from 'react';
import { useSWRConfig } from 'swr';

import { ApiError, client, keys, unwrap } from '@/ui/api';
import { Button } from '@/ui/components/button';

/** Props of `RedirectURIsEditor`. */
export type RedirectURIsEditorProps = {
  /** The server on OAuth. */
  server: string;
  /** The redirect URIs it has now. */
  uris: string[];
};

const parseURIs = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * Edits the redirect URIs of a server's pre-registered client, one per line.
 * Saving replaces the list and, like any change of a server's authentication,
 * revokes its tokens and closes its live sessions. Remount it with a new `key`
 * when `uris` changes so the text follows the saved value.
 */
export function RedirectURIsEditor({ server, uris }: RedirectURIsEditorProps) {
  const { mutate } = useSWRConfig();
  const id = useId();
  const hintId = useId();
  const [text, setText] = useState(uris.join('\n'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseURIs(text);
  const changed = parsed.join('\n') !== uris.join('\n');

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
          json: { auth: { mode: 'oauth', redirectUris: parsed } },
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
      <p className="m-0 text-xs font-semibold text-ink-500 uppercase">
        <label htmlFor={id}>Redirect URIs</label>{' '}
        <span id={hintId} className="font-normal normal-case">
          One per line. Leave empty to only allow Dynamic Client Registration.
        </span>
      </p>
      <textarea
        id={id}
        rows={Math.max(2, parsed.length)}
        className="box-border min-h-16 w-full resize-y rounded-lg border border-paper-300 bg-white px-3 py-2.5 font-mono text-sm text-ink-900"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        placeholder="http://localhost:33418/callback"
        spellCheck={false}
        aria-describedby={hintId}
      />
      {error !== null && (
        <p role="alert" className="m-0 text-[13px] text-red-800">
          {error}
        </p>
      )}
      {changed && (
        <p className="m-0 text-[13px]/relaxed text-ink-600">
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
          {saving ? 'Saving…' : 'Save redirect URIs'}
        </Button>
        {changed && (
          <Button
            size="small"
            disabled={saving}
            onClick={() => {
              setText(uris.join('\n'));
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
