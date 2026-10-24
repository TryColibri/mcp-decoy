import { html } from 'hono/html';

import { type ConsentRequest } from '@/server/oauth';

/** Props of `renderConsentPage`. */
export type ConsentPageProps = ConsentRequest & {
  /** Unguessable id of the pending consent request; doubles as the CSRF token. */
  requestId: string;
};

/**
 * Renders Decoy's consent page: the server, the client's name and ID, the
 * redirect URI, the requested scope and the resource, with Approve and Deny
 * buttons posting to `/consent/:requestId`.
 *
 * @param props - The pending consent request.
 */
export function renderConsentPage({
  requestId,
  client,
  server,
  redirectUri,
  resource,
  scopes,
}: ConsentPageProps) {
  const clientName = client.client_name ?? client.client_id;
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Authorize ${clientName} — MCP Decoy</title>
        <style>
          body {
            font-family:
              system-ui,
              -apple-system,
              sans-serif;
            max-width: 32rem;
            margin: 4rem auto;
            padding: 0 1.5rem;
            color: #15181d;
          }
          h1 {
            font-size: 1.25rem;
          }
          dl {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 0.5rem 1rem;
            font-size: 0.875rem;
          }
          dt {
            font-weight: 600;
            color: #5c6370;
          }
          dd {
            margin: 0;
            word-break: break-all;
            font-family: ui-monospace, monospace;
          }
          .actions {
            display: flex;
            gap: 0.75rem;
            margin-top: 2rem;
          }
          button {
            font: inherit;
            padding: 0.5rem 1.25rem;
            border-radius: 0.5rem;
            cursor: pointer;
          }
          button[value='approve'] {
            background: #15181d;
            color: #fff;
            border: 0;
          }
          button[value='deny'] {
            background: #fff;
            border: 1px solid #d6dbe1;
            color: #15181d;
          }
        </style>
      </head>
      <body>
        <h1>Authorize “${clientName}”</h1>
        <p>
          This client wants to connect to <strong>${server}</strong> on your
          behalf.
        </p>
        <dl>
          <dt>Client name</dt>
          <dd>${clientName}</dd>
          <dt>Client ID</dt>
          <dd>${client.client_id}</dd>
          <dt>Redirect URI</dt>
          <dd>${redirectUri}</dd>
          <dt>Scope</dt>
          <dd>
            ${scopes.length === 0 ? '(none requested)' : scopes.join(', ')}
          </dd>
          <dt>Resource</dt>
          <dd>${resource.href}</dd>
        </dl>
        <form method="post" action="/consent/${requestId}">
          <div class="actions">
            <button type="submit" name="decision" value="approve">
              Approve
            </button>
            <button type="submit" name="decision" value="deny">Deny</button>
          </div>
        </form>
      </body>
    </html>`;
}
