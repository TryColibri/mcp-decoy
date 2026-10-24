import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import useSWR, { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type OAuthToken,
  type ServerSummary,
  type Session,
} from '@/shared/api';
import { useSessions } from '@/ui/api';

import { ConnectionsPage } from './connections-page';

const mocks = vi.hoisted(() => ({
  closeSession: vi.fn(),
  revokeToken: vi.fn(),
  revokeTokens: vi.fn(),
  patchServer: vi.fn(),
  fetchTokens: vi.fn<(server: string) => Promise<OAuthToken[]>>(),
}));

vi.mock('@/ui/api', () => ({
  keys: {
    servers: 'servers',
    server: (server: string) => `servers/${server}`,
    sessions: (server: string) => `servers/${server}/sessions`,
    oauthTokens: (server: string) => `servers/${server}/oauth/tokens`,
  },
  unwrapEmpty: async (request: Promise<unknown>) => {
    await request;
  },
  useSessions: vi.fn(),
  // A real SWR hook over a controllable fetcher, so revalidation is visible.
  useOAuthTokens: (server: string, enabled: boolean) =>
    useSWR(enabled ? `servers/${server}/oauth/tokens` : null, async () =>
      mocks.fetchTokens(server),
    ),
  ApiError: class extends Error {
    fieldErrors = {};
  },
  unwrap: async (request: Promise<unknown>) => request,
  client: {
    servers: {
      ':server': {
        $patch: mocks.patchServer,
        sessions: { ':session': { $delete: mocks.closeSession } },
        oauth: {
          tokens: {
            $delete: mocks.revokeTokens,
            ':token': { $delete: mocks.revokeToken },
          },
        },
      },
    },
  },
}));

const mockUseSessions = vi.mocked(useSessions);

const OPEN_SERVER: ServerSummary = {
  name: 'weather',
  serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
  createdAt: '2026-10-21T12:00:00.000Z',
  mcpUrl: 'http://localhost:6280/s/weather/mcp',
  toolCount: 0,
  publishedToolCount: 0,
  sessionCount: 0,
  auth: { mode: 'none' },
};

const OAUTH_SERVER: ServerSummary = {
  ...OPEN_SERVER,
  auth: {
    mode: 'oauth',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUris: [],
    tokenCount: 2,
  },
};

const ACCESS_TOKEN: OAuthToken = {
  id: 'token-a',
  kind: 'access',
  value: 'decoy_at_abc',
  clientId: 'client-1',
  clientName: 'Claude',
  scopes: [],
  issuedAt: '2026-10-24T12:00:00.000Z',
  expiresAt: '2026-10-24T13:00:00.000Z',
};

const REFRESH_TOKEN: OAuthToken = {
  ...ACCESS_TOKEN,
  id: 'token-r',
  kind: 'refresh',
  value: 'decoy_rt_def',
  expiresAt: null,
};

const SESSION: Session = {
  id: 'session-1',
  clientInfo: { name: 'inspector', version: '1.0.0' },
  requestedProtocolVersion: '2025-06-18',
  protocolVersion: '2025-06-18',
  capabilities: {},
  connectedAt: '2026-10-24T12:00:00.000Z',
  lastSeenAt: '2026-10-24T12:00:00.000Z',
};

const sessionsResult = (data: Session[]) =>
  ({ data, error: undefined }) as ReturnType<typeof useSessions>;

const renderPage = (server: ServerSummary) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>
        <Routes>
          <Route element={<Outlet context={{ server }} />}>
            <Route index element={<ConnectionsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  );

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessions.mockReturnValue(sessionsResult([]));
    mocks.fetchTokens.mockResolvedValue([ACCESS_TOKEN, REFRESH_TOKEN]);
    mocks.revokeToken.mockResolvedValue(new Response(null, { status: 204 }));
    mocks.closeSession.mockResolvedValue(new Response(null, { status: 204 }));
  });

  describe('on an open server', () => {
    it('has OAuth switched off and shows no tokens section', () => {
      renderPage(OPEN_SERVER);

      expect(
        screen.getByRole('switch', { name: 'OAuth disabled' }),
      ).not.toBeChecked();
      expect(screen.queryByRole('heading', { name: 'Tokens' })).toBeNull();
      expect(mocks.fetchTokens).not.toHaveBeenCalled();
    });

    it('explains how to open a session when there is none', () => {
      renderPage(OPEN_SERVER);

      expect(screen.getByText(/No live sessions/)).toBeVisible();
    });
  });

  describe('the OAuth switch', () => {
    it('turns OAuth on right away', async () => {
      mocks.patchServer.mockResolvedValue({});
      renderPage(OPEN_SERVER);

      await userEvent.click(
        screen.getByRole('switch', { name: 'OAuth disabled' }),
      );

      expect(mocks.patchServer).toHaveBeenCalledExactlyOnceWith({
        param: { server: 'weather' },
        json: { auth: { mode: 'oauth' } },
      });
    });

    it('asks before turning OAuth off', async () => {
      mocks.patchServer.mockResolvedValue({});
      renderPage(OAUTH_SERVER);
      const user = userEvent.setup();

      await user.click(screen.getByRole('switch', { name: 'OAuth enabled' }));
      expect(mocks.patchServer).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Turn off OAuth' }));

      expect(mocks.patchServer).toHaveBeenCalledExactlyOnceWith({
        param: { server: 'weather' },
        json: { auth: { mode: 'none' } },
      });
    });

    it('leaves OAuth on when the confirmation is cancelled', async () => {
      renderPage(OAUTH_SERVER);
      const user = userEvent.setup();

      await user.click(screen.getByRole('switch', { name: 'OAuth enabled' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mocks.patchServer).not.toHaveBeenCalled();
      expect(
        screen.getByRole('switch', { name: 'OAuth enabled' }),
      ).toBeChecked();
    });

    it('shows the error when turning OAuth on fails', async () => {
      mocks.patchServer.mockRejectedValue(new Error('Server is down'));
      renderPage(OPEN_SERVER);

      await userEvent.click(
        screen.getByRole('switch', { name: 'OAuth disabled' }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Server is down',
      );
    });
  });

  describe('sessions', () => {
    it('lists a session and closes it', async () => {
      mockUseSessions.mockReturnValue(sessionsResult([SESSION]));
      renderPage(OPEN_SERVER);

      expect(screen.getByText('inspector 1.0.0')).toBeVisible();
      await userEvent.click(
        screen.getByRole('button', { name: 'Close session session-1' }),
      );

      expect(mocks.closeSession).toHaveBeenCalledExactlyOnceWith({
        param: { server: 'weather', session: 'session-1' },
      });
    });
  });

  describe('redirect URIs', () => {
    const withURIs: ServerSummary = {
      ...OAUTH_SERVER,
      auth: {
        mode: 'oauth',
        clientId: 'client-1',
        clientSecret: 'secret-1',
        redirectUris: ['http://localhost:9999/cb'],
        tokenCount: 0,
      },
    };

    it('starts from the current URIs and has nothing to save yet', () => {
      renderPage(withURIs);

      expect(screen.getByLabelText('Redirect URIs')).toHaveValue(
        'http://localhost:9999/cb',
      );
      expect(
        screen.getByRole('button', { name: 'Save redirect URIs' }),
      ).toBeDisabled();
    });

    it('saves the edited list through the PATCH', async () => {
      mocks.patchServer.mockResolvedValue({});
      renderPage(withURIs);
      const user = userEvent.setup();

      await user.type(
        screen.getByLabelText('Redirect URIs'),
        '{Enter}http://localhost:8888/cb',
      );
      expect(screen.getByText(/Saving revokes every token/)).toBeVisible();
      await user.click(
        screen.getByRole('button', { name: 'Save redirect URIs' }),
      );

      expect(mocks.patchServer).toHaveBeenCalledExactlyOnceWith({
        param: { server: 'weather' },
        json: {
          auth: {
            mode: 'oauth',
            redirectUris: [
              'http://localhost:9999/cb',
              'http://localhost:8888/cb',
            ],
          },
        },
      });
    });

    it('shows the error when saving fails', async () => {
      mocks.patchServer.mockRejectedValue(new Error('Server is down'));
      renderPage(withURIs);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Redirect URIs'), 'x');
      await user.click(
        screen.getByRole('button', { name: 'Save redirect URIs' }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Server is down',
      );
    });
  });

  describe('on an OAuth server', () => {
    it('shows the credentials and lists every token', async () => {
      renderPage(OAUTH_SERVER);

      expect(screen.getByText('client-1')).toBeVisible();
      expect(screen.getByText('secret-1')).toBeVisible();
      expect(
        screen.getByRole('switch', { name: 'OAuth enabled' }),
      ).toBeChecked();
      const rows = await screen.findAllByRole('row');
      expect(rows).toHaveLength(3);
      expect(within(rows[1]).getByText('Access')).toBeVisible();
      expect(within(rows[1]).getByText('Claude')).toBeVisible();
      expect(within(rows[2]).getByText('Refresh')).toBeVisible();
      expect(within(rows[2]).getByText('Never')).toBeVisible();
    });

    it('revokes one token and revalidates the list', async () => {
      renderPage(OAUTH_SERVER);
      await screen.findByText('decoy_at_abc');
      mocks.fetchTokens.mockResolvedValue([REFRESH_TOKEN]);

      await userEvent.click(
        screen.getByRole('button', { name: 'Revoke access token' }),
      );

      expect(mocks.revokeToken).toHaveBeenCalledExactlyOnceWith({
        param: { server: 'weather', token: 'token-a' },
      });
      await waitFor(() => {
        expect(screen.queryByText('decoy_at_abc')).toBeNull();
      });
      expect(screen.getByText('decoy_rt_def')).toBeVisible();
    });
  });
});
