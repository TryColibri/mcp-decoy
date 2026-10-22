import { describe, expect, it } from 'vitest';

import { checkTemplateStructure } from './json-e';

describe('checkTemplateStructure', () => {
  it('accepts a template that renders', () => {
    expect(
      checkTemplateStructure({ content: [{ type: 'text', text: 'ok' }] }),
    ).toBeUndefined();
  });

  it('ignores errors caused by missing arguments', () => {
    expect(
      checkTemplateStructure({
        content: [{ type: 'text', text: 'Forecast for ${args.city}' }],
      }),
    ).toBeUndefined();
  });

  it('accepts scalars, which json-e does not render', () => {
    expect(checkTemplateStructure(42)).toBeUndefined();
    expect(checkTemplateStructure(null)).toBeUndefined();
  });

  it('reports a misused operator, with its location', () => {
    expect(
      checkTemplateStructure({ content: [{ $map: [1], each: 'x' }] }),
    ).toBe(
      'TemplateError at template.content[0]: $map has undefined properties: each',
    );
  });

  it('reports a reserved $ key', () => {
    expect(checkTemplateStructure({ $nope: 1 })).toContain('TemplateError');
  });

  it('reports a malformed expression', () => {
    expect(checkTemplateStructure({ $eval: '(1' })).toContain('SyntaxError');
  });
});
