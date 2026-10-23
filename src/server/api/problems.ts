import { type Context, type ErrorHandler, type NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type z } from 'zod';

import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import {
  type FieldError,
  type Problem,
  PROBLEM_TYPES,
  problemSchema,
} from '@/shared/api';

/**
 * Builds an `application/problem+json` response.
 *
 * @param problem - The problem details.
 */
export function problemResponse(problem: Problem): Response {
  return new Response(JSON.stringify(problemSchema.parse(problem)), {
    status: problem.status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * Maps an error to problem details: domain errors to 404/409/422, HTTP
 * exceptions to their status, anything else to 500.
 *
 * @param error - What was thrown.
 */
export function toProblem(error: unknown): Problem {
  if (error instanceof NotFoundError) {
    return {
      type: PROBLEM_TYPES.notFound,
      title: 'Not found',
      status: 404,
      detail: error.message,
    };
  }
  if (error instanceof ConflictError) {
    return {
      type: PROBLEM_TYPES.conflict,
      title: 'Conflict',
      status: 409,
      detail: error.message,
    };
  }
  if (error instanceof ValidationError) {
    return {
      type: PROBLEM_TYPES.validation,
      title: 'Validation failed',
      status: 422,
      detail: error.message,
      errors: error.errors,
    };
  }
  if (error instanceof HTTPException && error.status === 400) {
    return {
      type: PROBLEM_TYPES.malformedJSON,
      title: 'Malformed request',
      status: 400,
      detail: error.message,
    };
  }
  if (error instanceof HTTPException) {
    return {
      type: PROBLEM_TYPES.internal,
      title: 'HTTP error',
      status: error.status,
      detail: error.message,
    };
  }
  return {
    type: PROBLEM_TYPES.internal,
    title: 'Internal server error',
    status: 500,
    detail:
      'An unexpected error occurred. See the MCP Decoy terminal for details.',
  };
}

/**
 * Creates the API's error handler. Unexpected errors are reported once
 * through `onUnexpected` and answered with a 500 problem.
 *
 * @param onUnexpected - Called with errors that aren't domain or HTTP errors.
 */
export function createErrorHandler(
  onUnexpected: (error: unknown) => void,
): ErrorHandler {
  return (error) => {
    const problem = toProblem(error);
    if (problem.status === 500) {
      onUnexpected(error);
    }
    return problemResponse(problem);
  };
}

/** Answers unknown API routes with a 404 problem. */
export const notFoundHandler: NotFoundHandler = (c) =>
  problemResponse({
    type: PROBLEM_TYPES.notFound,
    title: 'Not found',
    status: 404,
    detail: `No route for ${c.req.method} ${c.req.path}`,
  });

/**
 * `@hono/zod-validator` hook that turns validation failures into a
 * `ValidationError`, so they get the same problem shape as service errors.
 */
export const validationHook = (
  result: { success: true } | { success: false; error: z.core.$ZodError },
  _c: Context,
): void => {
  if (!result.success) {
    throw new ValidationError(result.error.issues.map(toFieldError));
  }
};

const toFieldError = (issue: z.core.$ZodIssue): FieldError => ({
  path: issue.path.map(String).join('.'),
  message: issue.message,
});
