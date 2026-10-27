import { type JSONPath } from 'jsonc-parser';

import {
  type InputSchema,
  inputSchemaSchema,
  type Tool,
  type ToolAnnotations,
  toolNameSchema,
  type UpdateToolRequest,
} from '@/shared/api';

import { checkTemplateStructure } from './json-e';
import { checkJSONSchema } from './json-schema';

/** Editable state of the tool editor. JSON fields are kept as text. */
export type ToolFormState = {
  /** Tool name. */
  name: string;
  /** Display title; empty means none. */
  title: string;
  /** Description sent to clients. */
  description: string;
  /** Input schema as JSON text. */
  inputSchema: string;
  /** Response template as JSON text. */
  responseTemplate: string;
  /** Behavior hints. */
  annotations: Required<ToolAnnotations>;
};

/** Field-level errors of the form, keyed by field. */
export type ToolFormErrors = Partial<
  Record<keyof ToolFormState | 'form', string>
>;

/** Why a JSON field is invalid. */
export type FieldIssue = {
  /** What is wrong, as shown under the field. */
  message: string;
  /** The node it is about; absent when it is about the text as a whole. */
  path?: JSONPath;
};

/** Result of validating the form. */
export type ParsedToolForm =
  | {
      /** The form is valid. */
      ok: true;
      /** Every field, ready to send as a PATCH body. */
      patch: Required<Omit<UpdateToolRequest, 'published'>>;
    }
  | {
      /** The form has errors. */
      ok: false;
      /** One message per invalid field. */
      errors: ToolFormErrors;
    };

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Builds the editor state of a saved tool.
 *
 * @param tool - The tool as returned by the API.
 */
export function toFormState(tool: Tool): ToolFormState {
  return {
    name: tool.name,
    title: tool.title ?? '',
    description: tool.description,
    inputSchema: json(tool.inputSchema),
    responseTemplate: json(tool.responseTemplate),
    annotations: {
      readOnlyHint: tool.annotations.readOnlyHint ?? false,
      destructiveHint: tool.annotations.destructiveHint ?? false,
      openWorldHint: tool.annotations.openWorldHint ?? false,
    },
  };
}

/**
 * Whether the form differs from the saved tool.
 *
 * @param state - The editor state.
 * @param tool - The saved tool the form was built from.
 */
export function isToolFormDirty(state: ToolFormState, tool: Tool): boolean {
  const saved = toFormState(tool);
  return (
    state.name !== saved.name ||
    state.title !== saved.title ||
    state.description !== saved.description ||
    state.inputSchema !== saved.inputSchema ||
    state.responseTemplate !== saved.responseTemplate ||
    state.annotations.readOnlyHint !== saved.annotations.readOnlyHint ||
    state.annotations.destructiveHint !== saved.annotations.destructiveHint ||
    state.annotations.openWorldHint !== saved.annotations.openWorldHint
  );
}

/**
 * Validates the form on the client: the name, and both JSON fields.
 *
 * @param state - The editor state.
 */
export function parseToolForm(state: ToolFormState): ParsedToolForm {
  const errors: ToolFormErrors = {};

  const name = toolNameSchema.safeParse(state.name);
  if (!name.success) {
    errors.name = name.error.issues.at(0)?.message ?? 'Invalid name';
  }

  const inputSchema = parseInputSchema(state.inputSchema);
  if (!inputSchema.ok) {
    errors.inputSchema = inputSchema.error.message;
  }

  const template = parseJSON(state.responseTemplate);
  const templateIssue = checkResponseTemplate(state.responseTemplate);
  if (templateIssue !== undefined) {
    errors.responseTemplate = templateIssue.message;
  }

  if (Object.keys(errors).length > 0 || !inputSchema.ok || !template.ok) {
    return { ok: false, errors };
  }

  const { readOnlyHint, destructiveHint, openWorldHint } = state.annotations;
  const annotations: ToolAnnotations = {
    ...(readOnlyHint ? { readOnlyHint } : {}),
    ...(destructiveHint ? { destructiveHint } : {}),
    ...(openWorldHint ? { openWorldHint } : {}),
  };

  return {
    ok: true,
    patch: {
      name: state.name,
      title: state.title.trim() === '' ? null : state.title,
      description: state.description,
      inputSchema: inputSchema.value,
      responseTemplate: template.value,
      annotations,
    },
  };
}

/**
 * Checks the input schema text: it must be a valid JSON Schema, an object
 * with `"type": "object"`.
 *
 * @param text - The input schema field.
 * @returns The error to show, or `undefined` when the text is valid.
 */
export function checkInputSchema(text: string): FieldIssue | undefined {
  const parsed = parseInputSchema(text);
  return parsed.ok ? undefined : parsed.error;
}

/**
 * Checks the response template text: it must be JSON, and json-e must not
 * find structural errors in it, see `checkTemplateStructure`.
 *
 * @param text - The response template field.
 * @returns The error to show, or `undefined` when the text is valid.
 */
export function checkResponseTemplate(text: string): FieldIssue | undefined {
  const parsed = parseJSON(text);
  return parsed.ok
    ? checkTemplateStructure(parsed.value)
    : { message: parsed.error };
}

/**
 * Maps API field errors (dotted paths) onto form fields.
 *
 * @param fieldErrors - `ApiError.fieldErrors`.
 */
export function toFormErrors(
  fieldErrors: Partial<Record<string, string>>,
): ToolFormErrors {
  const errors: ToolFormErrors = {};
  const fields: Array<keyof ToolFormState> = [
    'name',
    'title',
    'description',
    'inputSchema',
    'responseTemplate',
    'annotations',
  ];
  for (const [path, message] of Object.entries(fieldErrors)) {
    const field = fields.find(
      (candidate) => path === candidate || path.startsWith(`${candidate}.`),
    );
    errors[field ?? 'form'] ??= message;
  }
  return errors;
}

type JSONParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

type InputSchemaParseResult =
  | { ok: true; value: InputSchema }
  | { ok: false; error: FieldIssue };

const parseInputSchema = (text: string): InputSchemaParseResult => {
  const json = parseJSON(text);
  if (!json.ok) {
    return { ok: false, error: { message: json.error } };
  }
  const parsed = inputSchemaSchema.safeParse(json.value);
  if (parsed.success) {
    const invalid = checkJSONSchema(parsed.data);
    return invalid === undefined
      ? { ok: true, value: parsed.data }
      : { ok: false, error: invalid };
  }
  const object =
    typeof json.value === 'object' &&
    json.value !== null &&
    !Array.isArray(json.value);
  return {
    ok: false,
    error: {
      message: object
        ? 'Input schema must have "type": "object"'
        : 'Input schema must be a JSON object',
      path: [],
    },
  };
};

const parseJSON = (text: string): JSONParseResult => {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
