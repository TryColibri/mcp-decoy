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

/** The scopes the authorization server advertises in `scopes_supported`. */
export const SUPPORTED_SCOPES: readonly string[] = ['mcp'];

/** Pattern of one OAuth scope token (RFC 6749 §3.3): printable ASCII without spaces, `"` or `\`. */
export const SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

/** Schema for one OAuth scope token. */
export const scopeSchema = z
  .string()
  .regex(
    SCOPE_PATTERN,
    'A scope is printable ASCII without spaces, quotes or backslashes',
  )
  .describe('OAuth scope token (RFC 6749 §3.3).');

/** A server's pre-registered OAuth client, persisted in `servers.json`. */
export type ServerAuthConfig = {
  /** Only mode supported: OAuth 2.1. */
  mode: 'oauth';
  /** Pre-registered client ID. */
  clientId: string;
  /** Pre-registered client secret (`client_secret_post` only). */
  clientSecret: string;
  /** Redirect URIs the pre-registered client may use. */
  redirectUris: string[];
  /** Scopes the pre-registered client is registered with. */
  clientScopes: string[];
};

export const serverAuthConfigSchema: z.ZodType<ServerAuthConfig> =
  z.strictObject({
    mode: z.literal('oauth').describe('Only mode supported: OAuth 2.1.'),
    clientId: z.string().describe('Pre-registered client ID.'),
    clientSecret: z
      .string()
      .describe('Pre-registered client secret (`client_secret_post` only).'),
    redirectUris: z
      .array(z.url())
      .describe('Redirect URIs the pre-registered client may use.'),
    // The default keeps `servers.json` files written before it valid.
    clientScopes: z
      .array(scopeSchema)
      .default(() => [...SUPPORTED_SCOPES])
      .describe('Scopes the pre-registered client is registered with.'),
  });

/** Protocol generations a mock server accepts. */
export type ServerEras = 'both' | 'legacy' | 'modern';

/** Who may cache a 2026-07-28 result. */
export type CacheScope = 'public' | 'private';

/** Protocol behavior of a mock server. */
export type ServerProtocolConfig = {
  /**
   * Protocol generations the server accepts: `legacy` is 2025-11-25 (sessions),
   * `modern` is 2026-07-28 (stateless), `both` serves each client in the
   * generation it speaks.
   */
  eras: ServerEras;
  /** Cache hint stamped on 2026-07-28 `tools/list` and `server/discover` results. */
  cache: {
    /** Cache lifetime in milliseconds. */
    ttlMs: number;
    /** Whether shared caches (`public`) or only the requesting client (`private`) may cache. */
    scope: CacheScope;
  };
};

/** What a server's `protocol` is when `servers.json` or a request says nothing. */
export const DEFAULT_PROTOCOL: ServerProtocolConfig = {
  eras: 'both',
  cache: { ttlMs: 0, scope: 'private' },
};

const erasSchema: z.ZodType<ServerEras> = z
  .enum(['both', 'legacy', 'modern'])
  .describe(
    'Protocol generations the server accepts: `legacy` is 2025-11-25 (sessions), `modern` is 2026-07-28 (stateless), `both` serves each client in the generation it speaks.',
  );

const cacheScopeSchema: z.ZodType<CacheScope> = z
  .enum(['public', 'private'])
  .describe(
    'Whether shared caches (`public`) or only the requesting client (`private`) may cache.',
  );

const ttlMsSchema = z
  .number()
  .int('Cache lifetime must be a whole number of milliseconds')
  .min(0, 'Cache lifetime must not be negative')
  .max(
    Number.MAX_SAFE_INTEGER,
    'Cache lifetime must be a safe integer of milliseconds',
  )
  .describe('Cache lifetime in milliseconds.');

export const serverProtocolConfigSchema: z.ZodType<ServerProtocolConfig> =
  z.strictObject({
    eras: erasSchema.default(DEFAULT_PROTOCOL.eras),
    cache: z
      .strictObject({
        ttlMs: ttlMsSchema.default(DEFAULT_PROTOCOL.cache.ttlMs),
        scope: cacheScopeSchema.default(DEFAULT_PROTOCOL.cache.scope),
      })
      .default(() => ({ ...DEFAULT_PROTOCOL.cache }))
      .describe(
        'Cache hint stamped on 2026-07-28 `tools/list` and `server/discover` results.',
      ),
  });

/** Requested protocol behavior. Omitted fields keep their value, or the default on creation. */
export type ServerProtocolInput = {
  /** Protocol generations the server accepts. */
  eras?: ServerEras;
  /** Cache hint of 2026-07-28 `tools/list` and `server/discover` results, field by field. */
  cache?: {
    /** Cache lifetime in milliseconds. */
    ttlMs?: number;
    /** Whether shared caches (`public`) or only the requesting client (`private`) may cache. */
    scope?: CacheScope;
  };
};

export const serverProtocolInputSchema: z.ZodType<ServerProtocolInput> =
  z.strictObject({
    eras: erasSchema.optional(),
    cache: z
      .strictObject({
        ttlMs: ttlMsSchema.optional(),
        scope: cacheScopeSchema.optional(),
      })
      .optional()
      .describe(
        'Cache hint of 2026-07-28 `tools/list` and `server/discover` results, field by field.',
      ),
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
  /** OAuth protection. Absent means the server is open. */
  auth?: ServerAuthConfig;
  /** Protocol behavior. Absent in `servers.json` means the defaults. */
  protocol: ServerProtocolConfig;
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
  auth: serverAuthConfigSchema
    .optional()
    .describe('OAuth protection. Absent means the server is open.'),
  // The default keeps `servers.json` files written before it valid.
  protocol: serverProtocolConfigSchema
    .default(() => structuredClone(DEFAULT_PROTOCOL))
    .describe(
      'Protocol behavior. Absent in `servers.json` means the defaults.',
    ),
  createdAt: z.iso.datetime().describe('Creation time, ISO 8601.'),
});

/** A server's authentication state, as returned to the UI. */
export type ServerAuthSummary =
  | { mode: 'none' }
  | {
      mode: 'oauth';
      clientId: string;
      clientSecret: string;
      redirectUris: string[];
      clientScopes: string[];
      tokenCount: number;
    };

export const serverAuthSummarySchema: z.ZodType<ServerAuthSummary> =
  z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('none') }),
    z.strictObject({
      mode: z.literal('oauth'),
      clientId: z.string().describe('Pre-registered client ID.'),
      clientSecret: z
        .string()
        .describe('Pre-registered client secret (`client_secret_post` only).'),
      redirectUris: z
        .array(z.url())
        .describe('Redirect URIs the pre-registered client may use.'),
      clientScopes: z
        .array(scopeSchema)
        .describe('Scopes the pre-registered client is registered with.'),
      tokenCount: z
        .number()
        .int()
        .describe('Number of live access and refresh tokens.'),
    }),
  ]);

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
  /** Number of listed MCP clients: open sessions and recently active stateless clients. */
  clientCount: number;
  /** Authentication state. `{ mode: 'none' }` means the server is open. */
  auth: ServerAuthSummary;
  /** Protocol behavior. */
  protocol: ServerProtocolConfig;
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
  clientCount: z
    .number()
    .int()
    .describe(
      'Number of listed MCP clients: open sessions and recently active stateless clients.',
    ),
  auth: serverAuthSummarySchema.describe(
    "Authentication state. `{ mode: 'none' }` means the server is open.",
  ),
  protocol: serverProtocolConfigSchema.describe('Protocol behavior.'),
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

/**
 * Requested authentication state of a server. With no redirect URIs, the
 * pre-registered client can't complete authorization; Dynamic Client
 * Registration still works.
 */
export type ServerAuthInput =
  | { mode: 'none' }
  | {
      mode: 'oauth';
      /** Pre-registered client's redirect URIs. Absent: kept, or none when switching to OAuth. */
      redirectUris?: string[];
      /** Scopes the pre-registered client is registered with. Absent: kept, or `["mcp"]` when switching to OAuth. */
      clientScopes?: string[];
    };

export const serverAuthInputSchema: z.ZodType<ServerAuthInput> =
  z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('none') }),
    z.strictObject({
      mode: z.literal('oauth'),
      redirectUris: z
        .array(z.url('Each redirect URI must be an absolute URL'))
        .optional()
        .describe(
          "Pre-registered client's redirect URIs. Absent: kept, or none when switching to OAuth.",
        ),
      clientScopes: z
        .array(scopeSchema)
        .optional()
        .describe(
          'Scopes the pre-registered client is registered with. Absent: kept, or `["mcp"]` when switching to OAuth.',
        ),
    }),
  ]);

/** Request body of `POST /api/v1/servers`. */
export type CreateServerRequest = {
  /** URL slug of the new server. */
  name: string;
  /** Defaults to `{ name: "mcp-decoy/<name>", version: "0.1.0" }`, field by field. */
  serverInfo?: Partial<ServerInfo>;
  /** Optional `instructions` in the `initialize` result. Empty means none. */
  instructions?: string;
  /** Authentication state. Defaults to `{ mode: 'none' }`. */
  auth?: ServerAuthInput;
  /** Protocol behavior. Defaults to both generations and `{ ttlMs: 0, scope: 'private' }`, field by field. */
  protocol?: ServerProtocolInput;
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
        'Defaults to `{ name: "mcp-decoy/<name>", version: "0.1.0" }`, field by field.',
      ),
    instructions: z
      .string()
      .optional()
      .describe(
        'Optional `instructions` in the `initialize` result. Empty means none.',
      ),
    auth: serverAuthInputSchema
      .optional()
      .describe("Authentication state. Defaults to `{ mode: 'none' }`."),
    protocol: serverProtocolInputSchema
      .optional()
      .describe(
        "Protocol behavior. Defaults to both generations and `{ ttlMs: 0, scope: 'private' }`, field by field.",
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
  /**
   * New authentication state. Switching to OAuth generates fresh
   * credentials unless the server is already on OAuth, in which case they
   * are kept and only the `auth` fields sent are replaced. Switching to
   * `none` drops them and closes live sessions.
   */
  auth?: ServerAuthInput;
  /**
   * New protocol behavior, field by field. Switching `eras` to `modern`
   * closes live sessions, and to `legacy` ends open `subscriptions/listen`
   * streams.
   */
  protocol?: ServerProtocolInput;
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
    auth: serverAuthInputSchema
      .optional()
      .describe('New authentication state.'),
    protocol: serverProtocolInputSchema
      .optional()
      .describe(
        'New protocol behavior, field by field. Switching `eras` to `modern` closes live sessions, and to `legacy` ends open `subscriptions/listen` streams.',
      ),
  });
