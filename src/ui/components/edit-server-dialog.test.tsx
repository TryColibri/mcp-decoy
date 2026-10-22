import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ServerSummary } from '@/shared/api';

import { EditServerDialog } from './edit-server-dialog';

const SERVER: ServerSummary = {
  name: 'weather',
  serverInfo: { name: 'decoy/weather', version: '0.1.0' },
  instructions: 'Fake data.',
  createdAt: '2026-10-21T12:00:00.000Z',
  mcpUrl: 'http://localhost:6280/s/weather/mcp',
  toolCount: 0,
  publishedToolCount: 0,
  sessionCount: 0,
};

const OTHER: ServerSummary = { ...SERVER, name: 'echo' };

const json = (status: number, body: object, type = 'application/json') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
  });

const urlOf = (input: RequestInfo | URL | undefined): string =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : (input ?? '');

describe('EditServerDialog', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let patch: ReturnType<typeof vi.fn<(body: unknown) => Response>>;

  const renderDialog = () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <EditServerDialog server={SERVER} onClose={onClose} onSaved={onSaved} />
      </SWRConfig>,
    );
    return { onClose, onSaved };
  };

  beforeEach(() => {
    patch = vi.fn<(body: unknown) => Response>();
    mockFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(urlOf(input), 'http://localhost');
      if (init?.method === 'PATCH' && typeof init.body === 'string') {
        return patch(JSON.parse(init.body));
      }
      if (url.pathname === '/api/v1/servers') {
        return json(200, { items: [SERVER, OTHER] });
      }
      return json(200, {
        mcp: { urlTemplate: 'http://localhost:6280/s/{server}/mcp' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts from the server and has nothing to save yet', () => {
    renderDialog();

    expect(screen.getByLabelText('Name')).toHaveValue('weather');
    expect(screen.getByLabelText('serverInfo.name')).toHaveValue(
      'decoy/weather',
    );
    expect(screen.getByLabelText('serverInfo.version')).toHaveValue('0.1.0');
    expect(screen.getByLabelText('Instructions')).toHaveValue('Fake data.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('sends only what changed and reports the previous name', async () => {
    const updated = { ...SERVER, name: 'forecast' };
    patch.mockReturnValueOnce(json(200, updated));
    const { onClose, onSaved } = renderDialog();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'forecast');
    expect(screen.getByText(/Renaming changes the endpoint URL/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(patch).toHaveBeenCalledExactlyOnceWith({ name: 'forecast' });
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(updated, 'weather');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the endpoint of the new name', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'forecast');

    expect(
      await screen.findByText('http://localhost:6280/s/forecast/mcp'),
    ).toBeVisible();
  });

  it('refuses a name another server has', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'echo');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A server named “echo” already exists.',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('maps field errors from the API onto the fields', async () => {
    patch.mockReturnValueOnce(
      json(
        422,
        {
          type: 'https://decoy.dev/problems/validation',
          title: 'Validation failed',
          status: 422,
          detail: 'Invalid request',
          errors: [
            { path: 'serverInfo.version', message: 'Version is required' },
          ],
        },
        'application/problem+json',
      ),
    );
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText('serverInfo.version'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Version is required',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cancel without calling the API', async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(patch).not.toHaveBeenCalled();
  });
});
