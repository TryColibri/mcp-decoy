import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';

import { createErrorHandler, toProblem } from './problems';

describe('toProblem', () => {
  it('maps NotFoundError to 404', () => {
    expect(toProblem(new NotFoundError('gone'))).toEqual({
      type: 'https://decoy.dev/problems/not-found',
      title: 'Not found',
      status: 404,
      detail: 'gone',
    });
  });

  it('maps ConflictError to 409', () => {
    expect(toProblem(new ConflictError('taken'))).toMatchObject({
      type: 'https://decoy.dev/problems/conflict',
      status: 409,
      detail: 'taken',
    });
  });

  it('maps ValidationError to 422 with field errors', () => {
    const errors = [{ path: 'name', message: 'Required' }];

    expect(toProblem(new ValidationError(errors))).toEqual({
      type: 'https://decoy.dev/problems/validation',
      title: 'Validation failed',
      status: 422,
      detail: 'Required',
      errors,
    });
  });

  it('maps a 400 HTTPException to a malformed-request problem', () => {
    expect(
      toProblem(new HTTPException(400, { message: 'Malformed JSON' })),
    ).toMatchObject({
      type: 'https://decoy.dev/problems/malformed-json',
      status: 400,
    });
  });

  it('maps anything else to 500 without leaking the message', () => {
    expect(toProblem(new Error('secret'))).toMatchObject({
      type: 'https://decoy.dev/problems/internal',
      status: 500,
      detail: expect.not.stringContaining('secret'),
    });
  });
});

describe('createErrorHandler', () => {
  it('reports unexpected errors once and answers problem+json', async () => {
    const onUnexpected = vi.fn();
    const handler = createErrorHandler(onUnexpected);
    const error = new Error('boom');

    // The handler ignores its context argument.
    const response = await handler(error, undefined as never);

    expect(onUnexpected).toHaveBeenCalledExactlyOnceWith(error);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
  });

  it('does not report domain errors', async () => {
    const onUnexpected = vi.fn();

    await createErrorHandler(onUnexpected)(
      new NotFoundError('gone'),
      undefined as never,
    );

    expect(onUnexpected).not.toHaveBeenCalled();
  });
});
