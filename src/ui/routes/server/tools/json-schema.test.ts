import { describe, expect, it } from 'vitest';

import { checkJSONSchema } from './json-schema';

describe('checkJSONSchema', () => {
  it('accepts a valid schema', () => {
    expect(
      checkJSONSchema({
        type: 'object',
        properties: { city: { type: 'string', minLength: 1 } },
        required: ['city'],
      }),
    ).toBeUndefined();
  });

  it('accepts unknown keywords and formats', () => {
    expect(
      checkJSONSchema({
        type: 'object',
        'x-note': 1,
        properties: { a: { type: 'string', format: 'made-up' } },
      }),
    ).toBeUndefined();
  });

  it('accepts a draft-07 schema', () => {
    expect(
      checkJSONSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
      }),
    ).toBeUndefined();
  });

  it('accepts a 2019-09 schema', () => {
    expect(
      checkJSONSchema({
        $schema: 'https://json-schema.org/draft/2019-09/schema',
        type: 'object',
      }),
    ).toBeUndefined();
  });

  it('accepts the same $id twice', () => {
    const schema = { $id: 'https://example.com/args', type: 'object' };

    expect(checkJSONSchema(schema)).toBeUndefined();
    expect(checkJSONSchema(schema)).toBeUndefined();
  });

  it('rejects an unknown type, naming where', () => {
    expect(
      checkJSONSchema({
        type: 'object',
        properties: { a: { type: 'strng' } },
      }),
    ).toEqual({
      message: expect.stringContaining(
        'Not a valid JSON Schema at /properties/a/type',
      ),
      path: ['properties', 'a', 'type'],
    });
  });

  it('puts array indexes in the path as numbers', () => {
    expect(
      checkJSONSchema({ type: 'object', allOf: [{ type: 'strng' }] })?.path,
    ).toEqual(['allOf', 0, 'type']);
  });

  it('unescapes the path segments', () => {
    expect(
      checkJSONSchema({
        type: 'object',
        properties: { 'a/b~c': { type: 'strng' } },
      })?.path,
    ).toEqual(['properties', 'a/b~c', 'type']);
  });

  it('rejects a keyword with the wrong shape', () => {
    expect(checkJSONSchema({ type: 'object', required: 'a' })).toEqual({
      message: 'Not a valid JSON Schema at /required: must be array',
      path: ['required'],
    });
  });

  it('rejects an unresolvable $ref', () => {
    expect(
      checkJSONSchema({
        type: 'object',
        properties: { a: { $ref: '#/$defs/missing' } },
      }),
    ).toEqual({
      message: expect.stringContaining('#/$defs/missing'),
      path: [],
    });
  });

  it('rejects an unknown $schema dialect', () => {
    expect(
      checkJSONSchema({
        $schema: 'https://example.com/dialect',
        type: 'object',
      }),
    ).toEqual({
      message: expect.stringContaining('Not a valid JSON Schema'),
      path: [],
    });
  });
});
