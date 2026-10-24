import { type ServerSummary } from '@/shared/api';
import { CopyButton } from '@/ui/components/copy-button';

import { OAuthSwitch } from './oauth-switch';
import { RedirectURIsEditor } from './redirect-uris-editor';
import { Section } from './section';

/** Props of `OAuthSection`. */
export type OAuthSectionProps = {
  /** The server, with its current authentication state. */
  server: ServerSummary;
};

/**
 * A server's OAuth settings: the pre-registered client's credentials and the
 * protected-resource metadata URL (read-only), and its redirect URIs
 * (editable here). A switch in the heading turns OAuth on or off.
 */
export function OAuthSection({ server }: OAuthSectionProps) {
  const { auth } = server;

  if (auth.mode === 'none') {
    return (
      <Section title="OAuth" actions={<OAuthSwitch server={server} />}>
        <p className="m-0 text-sm/relaxed text-ink-600">
          This server is open: any client can connect without authenticating.
          Turn on OAuth to require it.
        </p>
      </Section>
    );
  }

  const { clientId, clientSecret, redirectUris } = auth;

  return (
    <Section title="OAuth" actions={<OAuthSwitch server={server} />}>
      <p className="m-0 text-sm/relaxed text-ink-600">
        The pre-registered client authenticates with{' '}
        <code className="font-mono">client_secret_post</code>. Dynamic Client
        Registration is also available.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client ID" value={clientId} />
        <Field label="Client secret" value={clientSecret} />
      </div>
      <Field
        label="Protected-resource metadata"
        value={protectedResourceMetadataUrl(server.mcpUrl)}
      />
      <RedirectURIsEditor
        key={redirectUris.join('\n')}
        server={server.name}
        uris={redirectUris}
      />
    </Section>
  );
}

type FieldLabelProps = {
  children: string;
};

function FieldLabel({ children }: FieldLabelProps) {
  return (
    <span className="text-xs font-semibold text-ink-500 uppercase">
      {children}
    </span>
  );
}

type FieldProps = {
  label: string;
  value: string;
};

function Field({ label, value }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
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

/**
 * The URL of a server's protected-resource metadata, from its MCP endpoint.
 *
 * @param mcpUrl - The server's Streamable HTTP endpoint.
 */
function protectedResourceMetadataUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
