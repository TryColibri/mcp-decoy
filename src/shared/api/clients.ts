import { z } from 'zod';

/** Name and version a client reported in `initialize` or in a request's `_meta`. */
export type ClientInfo = {
  /** Client implementation name. */
  name: string;
  /** Client implementation version. */
  version: string;
};

export const clientInfoSchema: z.ZodType<ClientInfo> = z.strictObject({
  name: z.string().describe('Client implementation name.'),
  version: z.string().describe('Client implementation version.'),
});

/** Protocol generation a client speaks. */
export type ClientEra = 'legacy' | 'modern';

/** A client of a mock server, as returned by `GET /api/v1/servers/{server}/clients`. */
export type MCPClient = {
  /** The `Mcp-Session-Id` (2025-11-25) or the key derived from the client's identity (2026-07-28). */
  id: string;
  /** Protocol generation the client speaks: `legacy` is 2025-11-25 (session), `modern` is 2026-07-28 (stateless). */
  era: ClientEra;
  /** What the client reported in `initialize`, or in the `_meta` of its requests, if it was valid. */
  clientInfo: ClientInfo | null;
  /** Protocol version the client asked for. */
  requestedProtocolVersion: string | null;
  /** Protocol version the server agreed to. */
  protocolVersion: string | null;
  /** Capabilities the client declared, extensions included. */
  capabilities: Record<string, unknown>;
  /** OAuth client the client's token was issued to, when the server uses OAuth. */
  oauthClientId: string | null;
  /** When the session was created, or the client was first seen, ISO 8601. */
  connectedAt: string;
  /** When the client last sent a message, ISO 8601. */
  lastSeenAt: string;
  /** Open `subscriptions/listen` streams (modern) or standalone GET streams (legacy). */
  openStreams: number;
};

export const mcpClientSchema: z.ZodType<MCPClient> = z.strictObject({
  id: z
    .string()
    .describe(
      "The `Mcp-Session-Id` (2025-11-25) or the key derived from the client's identity (2026-07-28).",
    ),
  era: z
    .enum(['legacy', 'modern'])
    .describe(
      'Protocol generation the client speaks: `legacy` is 2025-11-25 (session), `modern` is 2026-07-28 (stateless).',
    ),
  clientInfo: clientInfoSchema
    .nullable()
    .describe(
      'What the client reported in `initialize`, or in the `_meta` of its requests, if it was valid.',
    ),
  requestedProtocolVersion: z
    .string()
    .nullable()
    .describe('Protocol version the client asked for.'),
  protocolVersion: z
    .string()
    .nullable()
    .describe('Protocol version the server agreed to.'),
  capabilities: z
    .record(z.string(), z.unknown())
    .describe('Capabilities the client declared, extensions included.'),
  oauthClientId: z
    .string()
    .nullable()
    .describe(
      "OAuth client the client's token was issued to, when the server uses OAuth.",
    ),
  connectedAt: z.iso
    .datetime()
    .describe(
      'When the session was created, or the client was first seen, ISO 8601.',
    ),
  lastSeenAt: z.iso
    .datetime()
    .describe('When the client last sent a message, ISO 8601.'),
  openStreams: z
    .number()
    .int()
    .describe(
      'Open `subscriptions/listen` streams (modern) or standalone GET streams (legacy).',
    ),
});

/** Response body of `GET /api/v1/servers/{server}/clients`. */
export type MCPClientList = {
  /** Listed clients, oldest first. */
  items: MCPClient[];
};

export const mcpClientListSchema: z.ZodType<MCPClientList> = z.strictObject({
  items: z.array(mcpClientSchema).describe('Listed clients, oldest first.'),
});
