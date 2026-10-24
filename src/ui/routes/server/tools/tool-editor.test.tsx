import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ServerSummary, type Tool } from '@/shared/api';

import { ToolEditor } from './tool-editor';

const SERVER: ServerSummary = {
  name: 'weather',
  serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
  createdAt: '2026-10-21T12:00:00.000Z',
  mcpUrl: 'http://localhost:6280/s/weather/mcp',
  toolCount: 1,
  publishedToolCount: 1,
  sessionCount: 2,
  auth: { mode: 'none' },
};

const TOOL: Tool = {
  name: 'get_forecast',
  description: 'Forecast for a city',
  inputSchema: { type: 'object' },
  annotations: {},
  responseTemplate: { content: [{ type: 'text', text: 'ok' }] },
  published: true,
  updatedAt: '2026-10-21T12:00:00.000Z',
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
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <>
          <Link to="/elsewhere">Leave</Link>
          <ToolEditor
            server={SERVER}
            tool={tool}
            onSaved={onSaved}
            onDeleted={onDeleted}
          />
        </>
      ),
    },
    { path: '/elsewhere', element: <p>Elsewhere</p> },
  ]);
  render(<RouterProvider router={router} />);
  return { onSaved, onDeleted, router };
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
        type: 'https://mcp-decoy.dev/problems/validation',
        title: 'Validation failed',
        detail: 'Bad schema',
        errors: [{ path: 'inputSchema.type', message: 'Must be "object"' }],
      }),
    );
    renderEditor();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Title'), 'x');
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
        type: 'https://mcp-decoy.dev/problems/conflict',
        title: 'Conflict',
        detail: 'A tool named "echo" already exists on server "weather"',
      }),
    );
    renderEditor();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Title'), 'x');
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

  describe('Save changes', () => {
    it('is disabled until the form has changes', async () => {
      renderEditor();
      const user = userEvent.setup();
      const save = screen.getByRole('button', { name: 'Save changes' });

      expect(save).toBeDisabled();
      await user.type(screen.getByLabelText('Title'), 'x');
      expect(save).toBeEnabled();
      await user.clear(screen.getByLabelText('Title'));
      expect(save).toBeDisabled();
    });

    it('disables Save draft the same way on a draft', async () => {
      renderEditor({ ...TOOL, published: false });
      const user = userEvent.setup();
      const save = screen.getByRole('button', { name: 'Save draft' });

      expect(save).toBeDisabled();
      await user.type(screen.getByLabelText('Title'), 'x');
      expect(save).toBeEnabled();
    });

    it('leaves Publish tool enabled on an unchanged draft', () => {
      renderEditor({ ...TOOL, published: false });

      expect(
        screen.getByRole('button', { name: 'Publish tool' }),
      ).toBeEnabled();
    });
  });

  describe('unsaved changes', () => {
    it('lets a clean editor navigate away', async () => {
      const { router } = renderEditor();
      const user = userEvent.setup();

      await user.click(screen.getByRole('link', { name: 'Leave' }));

      expect(router.state.location.pathname).toBe('/elsewhere');
    });

    it('asks before navigating away with edits, and stays on Keep editing', async () => {
      const { router } = renderEditor();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Title'), 'Forecast');
      await user.click(screen.getByRole('link', { name: 'Leave' }));
      expect(
        await screen.findByRole('alertdialog', {
          name: 'Discard unsaved changes?',
        }),
      ).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Keep editing' }));

      expect(router.state.location.pathname).toBe('/');
      expect(screen.getByLabelText('Title')).toHaveValue('Forecast');
    });

    it('navigates away on Discard changes', async () => {
      const { router } = renderEditor();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Title'), 'Forecast');
      await user.click(screen.getByRole('link', { name: 'Leave' }));
      await user.click(
        await screen.findByRole('button', { name: 'Discard changes' }),
      );

      expect(router.state.location.pathname).toBe('/elsewhere');
    });

    it('does not ask once the edits are reverted', async () => {
      const { router } = renderEditor();
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Title'), 'x');
      await user.clear(screen.getByLabelText('Title'));
      await user.click(screen.getByRole('link', { name: 'Leave' }));

      expect(router.state.location.pathname).toBe('/elsewhere');
    });

    it('warns before the page unloads, only with edits', async () => {
      renderEditor();
      const user = userEvent.setup();
      const unload = () => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(unload()).toBe(false);
      await user.type(screen.getByLabelText('Title'), 'Forecast');
      expect(unload()).toBe(true);
    });

    it('does not ask when the save itself navigates away', async () => {
      mockFetch.mockResolvedValueOnce(
        Response.json({ ...TOOL, title: 'Forecast' }),
      );
      const { onSaved, router } = renderEditor();
      onSaved.mockImplementationOnce(async () => {
        await router.navigate('/elsewhere');
      });
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Title'), 'Forecast');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await vi.waitFor(() => {
        expect(router.state.location.pathname).toBe('/elsewhere');
      });
    });
  });

  describe('live validation', () => {
    const edit = (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    };

    it('reports invalid JSON on the first edit, without saving', () => {
      renderEditor();

      edit('Input schema', '{');

      expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
      expect(screen.getByLabelText('Input schema')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports a schema without type object', () => {
      renderEditor();

      edit('Input schema', '{"type":"string"}');

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Input schema must have "type": "object"',
      );
    });

    it('reports a schema that is not a valid JSON Schema', () => {
      renderEditor();

      edit(
        'Input schema',
        '{"type":"object","properties":{"a":{"type":"strng"}}}',
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Not a valid JSON Schema at /properties/a/type',
      );
    });

    it('reports a template that is not JSON without calling the API', () => {
      renderEditor();

      edit('Response template', 'oops');

      expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reports a json-e template that is structurally wrong', () => {
      renderEditor();

      edit('Response template', '{"$map":[1],"each":"x"}');

      expect(screen.getByRole('alert')).toHaveTextContent(
        '$map has undefined properties: each',
      );
    });

    it('does not report a template that needs arguments', () => {
      renderEditor();

      edit(
        'Response template',
        '{"content":[{"type":"text","text":"${args.city}"}]}',
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    describe('grace period', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('holds later edits and validates the latest when it ends', () => {
        renderEditor();

        edit('Input schema', '{');
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');

        edit('Input schema', '{"type":"string"}');
        act(() => {
          vi.advanceTimersByTime(399);
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');

        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Input schema must have "type": "object"',
        );
      });

      it('validates at once again after a quiet grace period', () => {
        renderEditor();

        edit('Input schema', '{');
        act(() => {
          vi.advanceTimersByTime(400);
        });
        edit('Input schema', '{"type":"object"}');

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });
});
