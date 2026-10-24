import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Popover } from '@base-ui/react/popover';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { twMerge } from 'tailwind-merge';

import { type ServerSummary } from '@/shared/api';
import { client, keys, unwrapEmpty } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';
import { CopyButton } from '@/ui/components/copy-button';

/** Props of `OAuthPopover`. */
export type OAuthPopoverProps = {
  /** The server, with its current authentication state. */
  server: ServerSummary;
};

/**
 * A lock pill showing a server's OAuth state, "OAuth · N tokens". Its popover
 * lists the pre-registered client's ID and secret, the `client_secret_post`
 * auth method, the protected-resource metadata URL and a "Revoke tokens"
 * button. Renders nothing for an open server.
 */
export function OAuthPopover({ server }: OAuthPopoverProps) {
  if (server.auth.mode === 'none') {
    return null;
  }
  const { clientId, clientSecret, tokenCount } = server.auth;
  const metadataUrl = protectedResourceMetadataUrl(server.mcpUrl);

  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 bg-paper-100 px-2.5 py-0.5 font-sans text-[13px] font-medium text-ink-700 hover:bg-paper-200">
        <LockSimpleIcon size={13} weight="bold" aria-hidden="true" />
        OAuth · {tokenCount} {tokenCount === 1 ? 'token' : 'tokens'}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup
            aria-label="OAuth"
            className="flex w-110 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-paper-200 bg-white p-5 shadow-xl"
          >
            <Popover.Description className="m-0 text-[13px] leading-normal text-ink-600">
              The pre-registered client authenticates with{' '}
              <code className="font-mono">client_secret_post</code>. Dynamic
              Client Registration is also available.
            </Popover.Description>
            <Field label="Client ID" value={clientId} />
            <Field label="Client secret" value={clientSecret} />
            <Field label="Protected-resource metadata" value={metadataUrl} />
            <RevokeTokensButton server={server.name} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

type FieldProps = {
  label: string;
  value: string;
};

function Field({ label, value }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-ink-500 uppercase">
        {label}
      </span>
      <div className="flex items-start gap-2 rounded-lg bg-paper-100 py-1.5 pr-1.5 pl-3">
        <span className="min-w-0 flex-1 py-0.5 font-mono text-[13px] wrap-anywhere text-ink-900">
          {value}
        </span>
        <CopyButton
          text={value}
          label={`Copy ${label.toLowerCase()}`}
          className="size-7"
        />
      </div>
    </div>
  );
}

type RevokeTokensButtonProps = {
  server: string;
};

function RevokeTokensButton({ server }: RevokeTokensButtonProps) {
  const { mutate } = useSWRConfig();
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].oauth.tokens.$delete({ param: { server } }),
      );
      await mutate(keys.server(server));
      void mutate(keys.servers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className={twMerge(buttonClasses('danger', 'small'), 'self-start')}
      >
        Revoke tokens
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-ink-900/30" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-paper-200 bg-white p-6 shadow-xl">
          <AlertDialog.Title className="m-0 text-base font-semibold">
            Revoke every token?
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-sm/relaxed text-ink-600">
            Every access and refresh token of “{server}” is invalidated.
            Connected clients get 401 on their next request and must
            re-authorize. This can’t be undone.
          </AlertDialog.Description>
          {error !== null && (
            <p role="alert" className="m-0 text-[13px] text-red-800">
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
              onClick={revoke}
              disabled={revoking}
            >
              {revoking ? 'Revoking…' : 'Revoke tokens'}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * The URL of a server's protected-resource metadata, from its MCP endpoint.
 *
 * @param mcpUrl - The server's Streamable HTTP endpoint.
 */
function protectedResourceMetadataUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
