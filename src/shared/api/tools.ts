import { z } from 'zod';

import { type FieldError, fieldErrorSchema } from './problems';

/** Pattern every tool name must match (MCP tool naming rules). */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Schema for a tool name. */
export const toolNameSchema = z
  .string()
  .min(1, 'Name is required')
  .regex(
    TOOL_NAME_PATTERN,
    'Use 1–128 letters, digits, underscores, dashes or dots',
  )
  .describe('MCP tool name, unique per server.');

/** JSON Schema of a tool's arguments. Must have `type: "object"`. */
export type InputSchema = Record<string, unknown>;

export const inputSchemaSchema: z.ZodType<InputSchema> = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === 'object', {
    message: 'Input schema must have "type": "object"',
    path: ['type'],
  })
  .describe('JSON Schema of the arguments. Must have `type: "object"`.');

/** Behavior hints shown to clients. All optional. */
export type ToolAnnotations = {
  /** The tool does not modify its environment. */
  readOnlyHint?: boolean;
  /** The tool may perform destructive updates. */
  destructiveHint?: boolean;
  /** The tool interacts with an open world of external entities. */
  openWorldHint?: boolean;
};

export const toolAnnotationsSchema: z.ZodType<ToolAnnotations> = z.strictObject(
  {
    readOnlyHint: z
      .boolean()
      .optional()
      .describe('The tool does not modify its environment.'),
    destructiveHint: z
      .boolean()
      .optional()
      .describe('The tool may perform destructive updates.'),
    openWorldHint: z
      .boolean()
      .optional()
      .describe('The tool interacts with an open world of external entities.'),
  },
);

/** A persisted tool definition. Only published tools are visible to clients. */
export type ToolConfig = {
  /** MCP tool name, unique per server. */
  name: string;
  /** Optional display title. */
  title?: string;
  /** Description sent to clients. */
  description: string;
  /** JSON Schema of the arguments. Must have `type: "object"`. */
  inputSchema: InputSchema;
  /** Behavior hints shown to clients. */
  annotations: ToolAnnotations;
  /** json-e template; the rendered result must be a valid `CallToolResult`. */
  responseTemplate: unknown;
  /** Whether clients can see and call the tool. */
  published: boolean;
  /** Last modification time, ISO 8601. */
  updatedAt: string;
};

export const toolConfigSchema: z.ZodType<ToolConfig> = z.strictObject({
  name: toolNameSchema,
  title: z.string().optional().describe('Optional display title.'),
  description: z.string().describe('Description sent to clients.'),
  inputSchema: inputSchemaSchema,
  annotations: toolAnnotationsSchema.describe(
    'Behavior hints shown to clients.',
  ),
  responseTemplate: z
    .json()
    .describe(
      'json-e template; the rendered result must be a valid `CallToolResult`.',
    ),
  published: z.boolean().describe('Whether clients can see and call the tool.'),
  updatedAt: z.iso.datetime().describe('Last modification time, ISO 8601.'),
});

/** A tool as returned by the API: its definition plus template warnings. */
export type Tool = ToolConfig & {
  /** Problems found by a trial render of the template with empty `args`. Not blocking. */
  warnings: FieldError[];
};

export const toolSchema: z.ZodType<Tool> = z.strictObject({
  name: toolNameSchema,
  title: z.string().optional().describe('Optional display title.'),
  description: z.string().describe('Description sent to clients.'),
  inputSchema: inputSchemaSchema,
  annotations: toolAnnotationsSchema.describe(
    'Behavior hints shown to clients.',
  ),
  responseTemplate: z
    .json()
    .describe(
      'json-e template; the rendered result must be a valid `CallToolResult`.',
    ),
  published: z.boolean().describe('Whether clients can see and call the tool.'),
  updatedAt: z.iso.datetime().describe('Last modification time, ISO 8601.'),
  warnings: z
    .array(fieldErrorSchema)
    .describe(
      'Problems found by a trial render of the template with empty `args`. Not blocking.',
    ),
});

/** Response body of `GET /api/v1/servers/{server}/tools`. */
export type ToolList = {
  /** Every tool of the server, drafts included, in creation order. */
  items: Tool[];
};

export const toolListSchema: z.ZodType<ToolList> = z.strictObject({
  items: z
    .array(toolSchema)
    .describe('Every tool of the server, drafts included, in creation order.'),
});

/** Request body of `POST /api/v1/servers/{server}/tools`. Omitted fields take defaults. */
export type CreateToolRequest = {
  /** MCP tool name, unique per server. */
  name: string;
  /** Optional display title. */
  title?: string;
  /** Description sent to clients. Default: empty. */
  description?: string;
  /** JSON Schema of the arguments. Default: `{ "type": "object", "properties": {} }`. */
  inputSchema?: InputSchema;
  /** Behavior hints shown to clients. Default: none. */
  annotations?: ToolAnnotations;
  /** json-e template. Default: echoes the arguments back as JSON text. */
  responseTemplate?: unknown;
  /** Whether clients can see and call the tool. Default: `false`. */
  published?: boolean;
};

export const createToolRequestSchema: z.ZodType<CreateToolRequest> =
  z.strictObject({
    name: toolNameSchema,
    title: z.string().optional().describe('Optional display title.'),
    description: z
      .string()
      .optional()
      .describe('Description sent to clients. Default: empty.'),
    inputSchema: inputSchemaSchema
      .optional()
      .describe(
        'JSON Schema of the arguments. Default: `{ "type": "object", "properties": {} }`.',
      ),
    annotations: toolAnnotationsSchema
      .optional()
      .describe('Behavior hints shown to clients. Default: none.'),
    responseTemplate: z
      .json()
      .optional()
      .describe(
        'json-e template. Default: echoes the arguments back as JSON text.',
      ),
    published: z
      .boolean()
      .optional()
      .describe('Whether clients can see and call the tool. Default: `false`.'),
  });

/** Request body of `PATCH /api/v1/servers/{server}/tools/{tool}`. Every field is optional. */
export type UpdateToolRequest = {
  /** New name. Renaming moves the resource (see the `Location` header). */
  name?: string;
  /** Display title. `null` removes it. */
  title?: string | null;
  /** Description sent to clients. */
  description?: string;
  /** JSON Schema of the arguments. */
  inputSchema?: InputSchema;
  /** Behavior hints shown to clients. Replaces the whole object. */
  annotations?: ToolAnnotations;
  /** json-e template. */
  responseTemplate?: unknown;
  /** Publish (`true`) or unpublish (`false`) the tool. */
  published?: boolean;
};

export const updateToolRequestSchema: z.ZodType<UpdateToolRequest> =
  z.strictObject({
    name: toolNameSchema
      .optional()
      .describe(
        'New name. Renaming moves the resource (see the `Location` header).',
      ),
    title: z
      .string()
      .nullable()
      .optional()
      .describe('Display title. `null` removes it.'),
    description: z.string().optional().describe('Description sent to clients.'),
    inputSchema: inputSchemaSchema
      .optional()
      .describe('JSON Schema of the arguments.'),
    annotations: toolAnnotationsSchema
      .optional()
      .describe('Behavior hints shown to clients. Replaces the whole object.'),
    responseTemplate: z.json().optional().describe('json-e template.'),
    published: z
      .boolean()
      .optional()
      .describe('Publish (`true`) or unpublish (`false`) the tool.'),
  });
