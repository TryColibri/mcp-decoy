import {
  inputSchemaSchema,
  type Tool,
  type ToolAnnotations,
  toolNameSchema,
  type UpdateToolRequest,
} from '@/shared/api';

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

  const inputSchema = parseJSON(state.inputSchema);
  let schema: Record<string, unknown> = {};
  if (!inputSchema.ok) {
    errors.inputSchema = inputSchema.error;
  } else {
    const parsed = inputSchemaSchema.safeParse(inputSchema.value);
    if (parsed.success) {
      schema = parsed.data;
    } else {
      errors.inputSchema =
        typeof inputSchema.value === 'object' &&
        inputSchema.value !== null &&
        !Array.isArray(inputSchema.value)
          ? 'Input schema must have "type": "object"'
          : 'Input schema must be a JSON object';
    }
  }

  const template = parseJSON(state.responseTemplate);
  if (!template.ok) {
    errors.responseTemplate = template.error;
  }

  if (Object.keys(errors).length > 0 || !template.ok) {
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
      inputSchema: schema,
      responseTemplate: template.value,
      annotations,
    },
  };
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
