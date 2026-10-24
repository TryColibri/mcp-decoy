import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Switch } from '@base-ui/react/switch';
import { useId, useState } from 'react';
import { useSWRConfig } from 'swr';

import { type ServerSummary } from '@/shared/api';
import { client, keys, unwrap } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';

/** Props of `OAuthSwitch`. */
export type OAuthSwitchProps = {
  /** The server, with its current authentication state. */
  server: ServerSummary;
};

/**
 * A switch that turns OAuth on or off for a server and nothing else. Turning
 * it on generates fresh client credentials. Turning it off asks first, because
 * it deletes them, revokes every token and closes live sessions.
 */
export function OAuthSwitch({ server }: OAuthSwitchProps) {
  const { mutate } = useSWRConfig();
  const labelId = useId();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = server.auth.mode === 'oauth';

  const apply = async (mode: 'none' | 'oauth') => {
    setSaving(true);
    setError(null);
    try {
      const updated = await unwrap(
        client.servers[':server'].$patch({
          param: { server: server.name },
          json: { auth: { mode } },
        }),
      );
      await mutate(keys.server(server.name), updated, { revalidate: false });
      void mutate(keys.servers);
      void mutate(keys.sessions(server.name));
      void mutate(keys.oauthTokens(server.name));
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (next: boolean) => {
    if (next) {
      void apply('oauth');
    } else {
      setError(null);
      setConfirming(true);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {error !== null && !confirming && (
        <span role="alert" className="text-[13px] text-red-800">
          {error}
        </span>
      )}
      <span id={labelId} className="text-sm font-medium text-ink-900">
        {enabled ? 'OAuth enabled' : 'OAuth disabled'}
      </span>
      <Switch.Root
        checked={enabled}
        onCheckedChange={toggle}
        disabled={saving}
        aria-labelledby={labelId}
        className="inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-0 bg-ink-400 p-0.5 transition-colors data-checked:bg-ink-900 data-disabled:cursor-not-allowed data-disabled:opacity-60"
      >
        <Switch.Thumb className="size-5 rounded-full bg-white shadow-sm transition-transform data-checked:translate-x-4" />
      </Switch.Root>
      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 bg-ink-900/30" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-paper-200 bg-white p-6 shadow-xl">
            <AlertDialog.Title className="m-0 text-base font-semibold">
              Turn off OAuth for “{server.name}”?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-sm/relaxed text-ink-600">
              The server becomes open. Its client credentials are deleted, every
              token is revoked and live sessions are closed. Turning OAuth back
              on generates new credentials.
            </AlertDialog.Description>
            {error !== null && (
              <p role="alert" className="m-0 text-[13px] text-red-800">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <AlertDialog.Close
                className={buttonClasses('secondary', 'small')}
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="primary"
                size="small"
                disabled={saving}
                onClick={() => {
                  void apply('none');
                }}
              >
                {saving ? 'Turning off…' : 'Turn off OAuth'}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
