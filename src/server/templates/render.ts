import {
  type CallToolResult,
  specTypeSchemas,
} from '@modelcontextprotocol/server';
import jsone from 'json-e';

import { type FieldError } from '@/shared/api';

/**
 * Values a response template can reference. More keys (session, clientInfo,
 * …) can be added later without breaking existing templates.
 */
export type TemplateContext = {
  /** The `arguments` of the `tools/call` request. */
  args: Record<string, unknown>;
};

/** Outcome of rendering a response template. */
export type RenderResult =
  | {
      /** The template rendered to a valid `CallToolResult`. */
      ok: true;
      /** The rendered result. */
      result: CallToolResult;
    }
  | {
      /** Rendering failed, or the output isn't a valid `CallToolResult`. */
      ok: false;
      /** Field-level problems; paths are relative to the rendered result or template. */
      errors: FieldError[];
    };

/** Template for new tools: echoes the call's arguments back as JSON text. */
export const DEFAULT_RESPONSE_TEMPLATE = {
  content: [{ type: 'text', text: { $json: { $eval: 'args' } } }],
};

/**
 * Renders a json-e template and validates the output as a `CallToolResult`.
 * Never throws: every failure is reported in the result.
 *
 * @param template - A JSON value; keys starting with `$` are json-e operators.
 * @param context - Values the template can reference.
 */
export function renderTemplate(
  template: unknown,
  context: TemplateContext,
): RenderResult {
  let output: unknown;
  try {
    output = render(template, context);
  } catch (error) {
    return { ok: false, errors: [describeRenderError(error)] };
  }

  const validation =
    specTypeSchemas.CallToolResult['~standard'].validate(output);
  if (validation.issues !== undefined) {
    return {
      ok: false,
      errors: validation.issues.map((issue) => ({
        path: formatPath(issue.path ?? []),
        message: `Rendered result is not a valid CallToolResult: ${issue.message}`,
      })),
    };
  }
  return { ok: true, result: validation.value };
}

const render = (template: unknown, context: TemplateContext): unknown => {
  // json-e only accepts objects, arrays and strings at the root; anything
  // else renders to itself.
  if (
    (typeof template === 'object' && template !== null) ||
    typeof template === 'string'
  ) {
    const output: unknown = jsone(template, context);
    return output;
  }
  return template;
};

const describeRenderError = (error: unknown): FieldError => {
  if (!(error instanceof Error)) {
    return { path: '', message: `Template error: ${String(error)}` };
  }
  const location =
    'location' in error && Array.isArray(error.location)
      ? error.location.join('')
      : '';
  const kind = error.name === 'Error' ? 'Template error' : error.name;
  return {
    path: location.replace(/^\./, ''),
    message: `${kind}: ${error.message}`,
  };
};

const formatPath = (
  path: ReadonlyArray<PropertyKey | { key: PropertyKey }>,
): string =>
  path
    .map((segment) =>
      typeof segment === 'object' ? String(segment.key) : String(segment),
    )
    .join('.');
