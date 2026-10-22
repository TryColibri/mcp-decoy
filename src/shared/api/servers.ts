import { z } from 'zod';

import { type ToolConfig, toolConfigSchema } from './tools';

/** Pattern every server name must match: lowercase slug segments joined by dashes. */
export const SERVER_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximum length of a server name. */
export const SERVER_NAME_MAX_LENGTH = 64;

/** Schema for a server name (URL slug). */
export const serverNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(
    SERVER_NAME_MAX_LENGTH,
    `Name must be at most ${SERVER_NAME_MAX_LENGTH} characters`,
  )
  .regex(
    SERVER_NAME_PATTERN,
    'Use lowercase letters, digits and single dashes, e.g. weather-v2',
  )
  .describe('URL slug: lowercase letters, digits and dashes, 1–64 chars.');

/** Identity sent as `serverInfo` in the `initialize` result. */
export type ServerInfo = {
  /** Implementation name. */
  name: string;
  /** Implementation version. */
  version: string;
};

export const serverInfoSchema: z.ZodType<ServerInfo> = z.strictObject({
  name: z.string().min(1, 'Name is required').describe('Implementation name.'),
  version: z
    .string()
    .min(1, 'Version is required')
    .describe('Implementation version.'),
});

/** A persisted mock MCP server. */
export type ServerConfig = {
  /** URL slug, unique: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 1–64 chars. */
  name: string;
  /** Sent as `serverInfo` in the `initialize` result. */
  serverInfo: ServerInfo;
  /** Optional `instructions` in the `initialize` result. */
  instructions?: string;
  /** Tool definitions, drafts included. */
  tools: ToolConfig[];
  /** Creation time, ISO 8601. */
  createdAt: string;
};

export const serverConfigSchema: z.ZodType<ServerConfig> = z.strictObject({
  name: serverNameSchema,
  serverInfo: serverInfoSchema.describe(
    'Sent as `serverInfo` in the `initialize` result.',
  ),
  instructions: z
    .string()
    .optional()
    .describe('Optional `instructions` in the `initialize` result.'),
  tools: z
    .array(toolConfigSchema)
    .describe('Tool definitions, drafts included.'),
  createdAt: z.iso.datetime().describe('Creation time, ISO 8601.'),
});

/** A server as returned by `GET /api/v1/servers` and `GET /api/v1/servers/{server}`. */
export type ServerSummary = {
  /** URL slug of the server. */
  name: string;
  /** Sent as `serverInfo` in the `initialize` result. */
  serverInfo: ServerInfo;
  /** Optional `instructions` in the `initialize` result. */
  instructions?: string;
  /** Creation time, ISO 8601. */
  createdAt: string;
  /** Streamable HTTP endpoint clients connect to. */
  mcpUrl: string;
  /** Number of tools, drafts included. */
  toolCount: number;
  /** Number of published tools, the ones clients see. */
  publishedToolCount: number;
  /** Number of live MCP sessions. */
  sessionCount: number;
};

export const serverSummarySchema: z.ZodType<ServerSummary> = z.strictObject({
  name: serverNameSchema.describe('URL slug of the server.'),
  serverInfo: serverInfoSchema.describe(
    'Sent as `serverInfo` in the `initialize` result.',
  ),
  instructions: z
    .string()
    .optional()
    .describe('Optional `instructions` in the `initialize` result.'),
  createdAt: z.iso.datetime().describe('Creation time, ISO 8601.'),
  mcpUrl: z.string().describe('Streamable HTTP endpoint clients connect to.'),
  toolCount: z.number().int().describe('Number of tools, drafts included.'),
  publishedToolCount: z
    .number()
    .int()
    .describe('Number of published tools, the ones clients see.'),
  sessionCount: z.number().int().describe('Number of live MCP sessions.'),
});

/** Response body of `GET /api/v1/servers`. */
export type ServerList = {
  /** Every server, in creation order. */
  items: ServerSummary[];
};

export const serverListSchema: z.ZodType<ServerList> = z.strictObject({
  items: z
    .array(serverSummarySchema)
    .describe('Every server, in creation order.'),
});

/** Request body of `POST /api/v1/servers`. */
export type CreateServerRequest = {
  /** URL slug of the new server. */
  name: string;
  /** Defaults to `{ name: "decoy/<name>", version: "0.1.0" }`, field by field. */
  serverInfo?: Partial<ServerInfo>;
  /** Optional `instructions` in the `initialize` result. Empty means none. */
  instructions?: string;
};

export const createServerRequestSchema: z.ZodType<CreateServerRequest> =
  z.strictObject({
    name: serverNameSchema.describe('URL slug of the new server.'),
    serverInfo: z
      .strictObject({
        name: z.string().min(1, 'Name is required').optional(),
        version: z.string().min(1, 'Version is required').optional(),
      })
      .optional()
      .describe(
        'Defaults to `{ name: "decoy/<name>", version: "0.1.0" }`, field by field.',
      ),
    instructions: z
      .string()
      .optional()
      .describe(
        'Optional `instructions` in the `initialize` result. Empty means none.',
      ),
  });

/** Request body of `PATCH /api/v1/servers/{server}`. Omitted fields keep their value. */
export type UpdateServerRequest = {
  /**
   * New URL slug. Renaming moves the server: its endpoint URL changes, its
   * live sessions are closed and its logs follow it.
   */
  name?: string;
  /** New `serverInfo` fields, field by field. */
  serverInfo?: Partial<ServerInfo>;
  /** New `instructions` in the `initialize` result. Empty removes them. */
  instructions?: string;
};

export const updateServerRequestSchema: z.ZodType<UpdateServerRequest> =
  z.strictObject({
    name: serverNameSchema
      .optional()
      .describe(
        'New URL slug. Renaming moves the server: its endpoint URL changes, its live sessions are closed and its logs follow it.',
      ),
    serverInfo: z
      .strictObject({
        name: z.string().min(1, 'Name is required').optional(),
        version: z.string().min(1, 'Version is required').optional(),
      })
      .optional()
      .describe('New `serverInfo` fields, field by field.'),
    instructions: z
      .string()
      .optional()
      .describe(
        'New `instructions` in the `initialize` result. Empty removes them.',
      ),
  });
