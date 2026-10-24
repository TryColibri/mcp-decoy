import { html, raw } from 'hono/html';

import { type ConsentRequest } from '@/server/oauth';

/** Props of `renderConsentPage`. */
export type ConsentPageProps = ConsentRequest & {
  /** Unguessable id of the pending consent request; doubles as the CSRF token. */
  requestId: string;
};

const logoMark = raw(
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
);

const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2316181D' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='12' cy='12' r='9'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Cpath d='M12 3v3M12 18v3M3 12h3M18 12h3'/%3E%3C/svg%3E";

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
        <link rel="icon" href="${favicon}" />
        <title>Authorize ${clientName} — MCP Decoy</title>
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            display: grid;
            place-items: center;
            min-height: 100dvh;
            margin: 0;
            padding: 1.5rem;
            background: #f9faf9;
            color: #16181d;
            font-family:
              'Geist',
              ui-sans-serif,
              system-ui,
              -apple-system,
              sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          main {
            width: 100%;
            max-width: 30rem;
          }
          .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.625rem;
            margin-bottom: 1.25rem;
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: -0.025em;
          }
          .card {
            padding: 1.75rem;
            background: #fff;
            border: 1px solid #e6e6e5;
            border-radius: 0.75rem;
            box-shadow: 0 1px 2px rgb(8 9 12 / 0.05);
          }
          h1 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 600;
            letter-spacing: -0.015em;
          }
          .lead {
            margin: 0.5rem 0 0;
            font-size: 0.875rem;
            line-height: 1.5;
            color: #4c5261;
          }
          .lead strong {
            color: #16181d;
            font-weight: 600;
          }
          dl {
            display: grid;
            gap: 0.875rem;
            margin: 1.5rem 0 0;
            padding: 1rem;
            background: #f3f4f6;
            border-radius: 0.5rem;
          }
          dt {
            margin-bottom: 0.125rem;
            font-size: 0.6875rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #6b7180;
          }
          dd {
            margin: 0;
            font-family:
              'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.8125rem;
            word-break: break-all;
          }
          .actions {
            display: flex;
            gap: 0.75rem;
            margin-top: 1.5rem;
          }
          button {
            flex: 1;
            min-height: 2.75rem;
            padding: 0 1.25rem;
            border-radius: 0.5rem;
            font: inherit;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background-color 0.15s;
          }
          button[value='approve'] {
            background: #16181d;
            border: 0;
            color: #fff;
            font-weight: 600;
          }
          button[value='approve']:hover {
            background: #25272c;
          }
          button[value='deny'] {
            background: #fff;
            border: 1px solid #d5d5d2;
            color: #16181d;
            font-weight: 500;
          }
          button[value='deny']:hover {
            background: #e6e6e5;
          }
          button:focus-visible {
            outline: 2px solid #1d4ed8;
            outline-offset: 2px;
          }
          .note {
            margin: 1rem 0 0;
            text-align: center;
            font-size: 0.75rem;
            color: #6b7180;
          }
        </style>
      </head>
      <body>
        <main>
          <div class="brand">${logoMark} <span>MCP Decoy</span></div>
          <div class="card">
            <h1>Authorize “${clientName}”</h1>
            <p class="lead">
              This client wants to connect to <strong>${server}</strong> on your
              behalf.
            </p>
            <dl>
              <div>
                <dt>Client name</dt>
                <dd>${clientName}</dd>
              </div>
              <div>
                <dt>Client ID</dt>
                <dd>${client.client_id}</dd>
              </div>
              <div>
                <dt>Redirect URI</dt>
                <dd>${redirectUri}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  ${scopes.length === 0 ? '(none requested)' : scopes.join(', ')}
                </dd>
              </div>
              <div>
                <dt>Resource</dt>
                <dd>${resource.href}</dd>
              </div>
            </dl>
            <form method="post" action="/consent/${requestId}">
              <div class="actions">
                <button type="submit" name="decision" value="deny">Deny</button>
                <button type="submit" name="decision" value="approve">
                  Approve
                </button>
              </div>
            </form>
          </div>
          <p class="note">A mock authorization server. Nothing here is real.</p>
        </main>
      </body>
    </html>`;
}
