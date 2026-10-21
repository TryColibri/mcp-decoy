import { z } from 'zod';

/** Base URI of every problem `type` returned by the API. */
export const PROBLEM_TYPE_BASE = 'https://decoy.dev/problems/';

/** Stable problem type URIs, one per error kind. Clients switch on these. */
export const PROBLEM_TYPES = {
  /** The addressed resource or route does not exist. */
  notFound: `${PROBLEM_TYPE_BASE}not-found`,
  /** The request conflicts with existing state, e.g. a duplicate name. */
  conflict: `${PROBLEM_TYPE_BASE}conflict`,
  /** The request body or query failed validation. */
  validation: `${PROBLEM_TYPE_BASE}validation`,
  /** The request body is not valid JSON. */
  malformedJSON: `${PROBLEM_TYPE_BASE}malformed-json`,
  /** A mutating request without `Content-Type: application/json`. */
  unsupportedMediaType: `${PROBLEM_TYPE_BASE}unsupported-media-type`,
  /** The request was refused by the Host or Origin checks. */
  forbidden: `${PROBLEM_TYPE_BASE}forbidden`,
  /** An unexpected server error. */
  internal: `${PROBLEM_TYPE_BASE}internal`,
} as const;

/** One field-level error inside a problem. */
export type FieldError = {
  /** Dotted path of the offending field, e.g. `inputSchema.type`. Empty for the whole body. */
  path: string;
  /** Human-readable explanation. */
  message: string;
};

export const fieldErrorSchema: z.ZodType<FieldError> = z.strictObject({
  path: z
    .string()
    .describe(
      'Dotted path of the offending field, e.g. `inputSchema.type`. Empty for the whole body.',
    ),
  message: z.string().describe('Human-readable explanation.'),
});

/** An RFC 9457 problem details body (`application/problem+json`). */
export type Problem = {
  /** Stable URI identifying the error kind (see `PROBLEM_TYPES`). */
  type: string;
  /** Short summary of the error kind. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Explanation specific to this occurrence. */
  detail: string;
  /** Field-level errors, for validation problems. */
  errors?: FieldError[];
};

export const problemSchema: z.ZodType<Problem> = z.strictObject({
  type: z
    .string()
    .describe('Stable URI identifying the error kind (see `PROBLEM_TYPES`).'),
  title: z.string().describe('Short summary of the error kind.'),
  status: z.number().int().describe('HTTP status code.'),
  detail: z.string().describe('Explanation specific to this occurrence.'),
  errors: z
    .array(fieldErrorSchema)
    .optional()
    .describe('Field-level errors, for validation problems.'),
});
