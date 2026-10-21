import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ServerSummary, type Tool } from '@/shared/api';

import { ToolEditor } from './tool-editor';

const SERVER: ServerSummary = {
  name: 'weather',
  serverInfo: { name: 'decoy/weather', version: '0.1.0' },
  createdAt: '2026-10-21T12:00:00.000Z',
  mcpUrl: 'http://localhost:6280/s/weather/mcp',
  toolCount: 1,
  publishedToolCount: 1,
  sessionCount: 2,
};

const TOOL: Tool = {
  name: 'get_forecast',
  description: 'Forecast for a city',
  inputSchema: { type: 'object' },
  annotations: {},
  responseTemplate: { content: [{ type: 'text', text: 'ok' }] },
  published: true,
  updatedAt: '2026-10-21T12:00:00.000Z',
  warnings: [],
};

const problem = (status: number, body: object) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

const urlOf = (input: RequestInfo | URL | undefined): string =>
  input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : (input ?? '');

const renderEditor = (tool: Tool = TOOL) => {
  const onSaved = vi.fn(async () => {});
  const onDeleted = vi.fn(async () => {});
  render(
    <ToolEditor
      server={SERVER}
      tool={tool}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />,
  );
  return { onSaved, onDeleted };
};

describe('ToolEditor', () => {
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    mockFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the live notice with the session count', () => {
    renderEditor();

    expect(screen.getByText(/Live, no restart/)).toHaveTextContent(
      'notifies 2 sessions on weather',
    );
  });

  it('offers Publish and Discard for a draft', () => {
    renderEditor({ ...TOOL, published: false });

    expect(screen.getByRole('button', { name: 'Publish tool' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeVisible();
  });

  it('rejects invalid JSON without calling the API', async () => {
    renderEditor();
    const user = userEvent.setup();

    const schema = screen.getByLabelText('Input schema');
    await user.clear(schema);
    await user.type(schema, 'not json');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
    expect(schema).toHaveAttribute('aria-invalid', 'true');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps problem field errors onto fields', async () => {
    mockFetch.mockResolvedValueOnce(
      problem(422, {
        type: 'https://decoy.dev/problems/validation',
        title: 'Validation failed',
        detail: 'Bad schema',
        errors: [{ path: 'inputSchema.type', message: 'Must be "object"' }],
      }),
    );
    renderEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Must be "object"',
    );
    expect(screen.getByLabelText('Input schema')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('shows a conflict under the name', async () => {
    mockFetch.mockResolvedValueOnce(
      problem(409, {
        type: 'https://decoy.dev/problems/conflict',
        title: 'Conflict',
        detail: 'A tool named "echo" already exists on server "weather"',
      }),
    );
    renderEditor();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A tool named "echo" already exists',
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('sends every field on save and reports the saved tool', async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ ...TOOL, title: 'Forecast' }),
    );
    const { onSaved } = renderEditor();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Title'), 'Forecast');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledOnce();
    });
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(urlOf(url)).toContain('/api/v1/servers/weather/tools/get_forecast');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toEqual(
      {
        name: 'get_forecast',
        title: 'Forecast',
        description: 'Forecast for a city',
        inputSchema: { type: 'object' },
        responseTemplate: { content: [{ type: 'text', text: 'ok' }] },
        annotations: {},
        published: true,
      },
    );
  });

  it('shows template warnings from the last save', () => {
    renderEditor({
      ...TOOL,
      warnings: [
        { path: 'content[0].text', message: 'object has no property "city"' },
      ],
    });

    expect(screen.getByText(/object has no property "city"/)).toBeVisible();
  });
});
