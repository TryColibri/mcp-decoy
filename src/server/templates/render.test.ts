import { describe, expect, it } from 'vitest';

import { DEFAULT_RESPONSE_TEMPLATE, renderTemplate } from './render';

describe('renderTemplate', () => {
  it('interpolates arguments in strings', () => {
    const result = renderTemplate(
      { content: [{ type: 'text', text: 'Forecast for ${args.city}' }] },
      { args: { city: 'Paris' } },
    );

    expect(result).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'Forecast for Paris' }] },
    });
  });

  it('echoes arguments as JSON with the default template', () => {
    expect(
      renderTemplate(DEFAULT_RESPONSE_TEMPLATE, { args: { a: 1 } }),
    ).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: '{"a":1}' }] },
    });
  });

  it('inserts structures with $eval', () => {
    const result = renderTemplate(
      {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { $eval: 'args' },
      },
      { args: { days: [1, 2] } },
    );

    expect(result).toMatchObject({
      ok: true,
      result: { structuredContent: { days: [1, 2] } },
    });
  });

  it('escapes a literal $ with $$', () => {
    const result = renderTemplate(
      { content: [{ type: 'text', text: 'costs $${price}' }] },
      { args: {} },
    );

    expect(result).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'costs ${price}' }] },
    });
  });

  it('reports interpreter errors with their location', () => {
    const result = renderTemplate(
      { content: [{ type: 'text', text: '${args.city.name}' }] },
      { args: {} },
    );

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: 'content[0].text',
          message: expect.stringContaining('city'),
        },
      ],
    });
  });

  it('reports reserved $ keys', () => {
    const result = renderTemplate({ $foo: 1 }, { args: {} });

    expect(result).toMatchObject({
      ok: false,
      errors: [{ message: expect.stringContaining('reserved') }],
    });
  });

  it('rejects output that is not a CallToolResult', () => {
    const result = renderTemplate({ content: 'nope' }, { args: {} });

    expect(result).toMatchObject({
      ok: false,
      errors: [
        {
          path: 'content',
          message: expect.stringContaining('not a valid CallToolResult'),
        },
      ],
    });
  });

  it('rejects scalar templates', () => {
    expect(renderTemplate(42, { args: {} })).toMatchObject({ ok: false });
  });
});
