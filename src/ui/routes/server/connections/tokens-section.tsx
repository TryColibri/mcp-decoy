import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useState } from 'react';
import { useSWRConfig } from 'swr';

import { type OAuthToken, type ServerSummary } from '@/shared/api';
import { client, keys, unwrapEmpty, useOAuthTokens } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';
import { CopyButton } from '@/ui/components/copy-button';
import { tw } from '@/ui/tw';

import { formatDateTime } from './format-time';
import { Section } from './section';

/** Props of `TokensSection`. */
export type TokensSectionProps = {
  /** A server on OAuth. */
  server: ServerSummary;
};

const th = tw`border-b border-paper-200 px-3 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-500 uppercase`;
const td = tw`border-b border-paper-100 p-3 align-middle text-sm whitespace-nowrap`;

/** Every live access and refresh token of a server, revocable one by one or all at once. */
export function TokensSection({ server }: TokensSectionProps) {
  const { data: tokens, error } = useOAuthTokens(server.name, true);

  const body =
    error !== undefined ? (
      <p role="alert" className="m-0 text-sm text-red-800">
        Could not load tokens: {error.message}
      </p>
    ) : tokens === undefined ? (
      <p className="m-0 text-sm text-ink-500">Loading…</p>
    ) : tokens.length === 0 ? (
      <p className="m-0 text-sm/relaxed text-ink-600">
        No live tokens. A client gets some once it completes the OAuth flow.
      </p>
    ) : (
      <TokenTable server={server.name} tokens={tokens} />
    );

  return (
    <Section
      title="Tokens"
      actions={<RevokeTokensButton server={server.name} />}
    >
      {body}
    </Section>
  );
}

type TokenTableProps = {
  server: string;
  tokens: OAuthToken[];
};

function TokenTable({ server, tokens }: TokenTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th} scope="col">
              Kind
            </th>
            <th className={th} scope="col">
              Client
            </th>
            <th className={th} scope="col">
              Scopes
            </th>
            <th className={th} scope="col">
              Issued
            </th>
            <th className={th} scope="col">
              Expires
            </th>
            <th className={th} scope="col">
              Token
            </th>
            <th className={th} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <TokenRow key={token.id} server={server} token={token} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TokenRowProps = {
  server: string;
  token: OAuthToken;
};

function TokenRow({ server, token }: TokenRowProps) {
  const { revoking, error, revoke } = useRevokeToken(server, token.id);

  return (
    <tr>
      <td className={td}>{token.kind === 'access' ? 'Access' : 'Refresh'}</td>
      <td className={td}>{token.clientName ?? token.clientId}</td>
      <td className={td}>
        {token.scopes.length === 0 ? '—' : token.scopes.join(' ')}
      </td>
      <td className={td}>{formatDateTime(token.issuedAt)}</td>
      <td className={td}>
        {token.expiresAt === null ? 'Never' : formatDateTime(token.expiresAt)}
      </td>
      <td className={td}>
        <div className="flex items-center gap-1">
          <span className="max-w-40 truncate font-mono text-[13px]">
            {token.value}
          </span>
          <CopyButton
            text={token.value}
            label={`Copy ${token.kind} token`}
            className="size-7 self-center"
          />
        </div>
      </td>
      <td className={`${td} text-right`}>
        {error !== null && (
          <span role="alert" className="mr-3 text-[13px] text-red-800">
            {error}
          </span>
        )}
        <Button
          variant="danger"
          size="small"
          onClick={revoke}
          disabled={revoking}
          aria-label={`Revoke ${token.kind} token`}
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </Button>
      </td>
    </tr>
  );
}

/** Revalidates what a token revocation changes: the lists and the token count. */
function useRevalidateTokens(server: string) {
  const { mutate } = useSWRConfig();
  return async () => {
    await mutate(keys.oauthTokens(server));
    void mutate(keys.server(server));
    void mutate(keys.servers);
  };
}

function useRevokeToken(server: string, id: string) {
  const revalidate = useRevalidateTokens(server);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].oauth.tokens[':token'].$delete({
          param: { server, token: id },
        }),
      );
      await revalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRevoking(false);
    }
  };

  return { revoking, error, revoke };
}

type RevokeTokensButtonProps = {
  server: string;
};

function RevokeTokensButton({ server }: RevokeTokensButtonProps) {
  const revalidate = useRevalidateTokens(server);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await unwrapEmpty(
        client.servers[':server'].oauth.tokens.$delete({ param: { server } }),
      );
      await revalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className={buttonClasses('danger', 'small')}>
        Revoke all
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
              {revoking ? 'Revoking…' : 'Revoke all'}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
