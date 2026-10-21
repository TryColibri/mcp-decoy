import { z } from 'zod';

/** Name and version a client reported in `initialize`. */
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

/** A live MCP session, as returned by `GET /api/v1/servers/{server}/sessions`. */
export type Session = {
  /** The `Mcp-Session-Id` assigned by decoy. */
  id: string;
  /** What the client reported in `initialize`, if it was valid. */
  clientInfo: ClientInfo | null;
  /** Protocol version the client asked for. */
  requestedProtocolVersion: string | null;
  /** Protocol version the server agreed to. */
  protocolVersion: string | null;
  /** Capabilities the client declared in `initialize`. */
  capabilities: Record<string, unknown>;
  /** When the session was created, ISO 8601. */
  connectedAt: string;
  /** When the client last sent a message, ISO 8601. */
  lastSeenAt: string;
};

export const sessionSchema: z.ZodType<Session> = z.strictObject({
  id: z.string().describe('The `Mcp-Session-Id` assigned by decoy.'),
  clientInfo: clientInfoSchema
    .nullable()
    .describe('What the client reported in `initialize`, if it was valid.'),
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
    .describe('Capabilities the client declared in `initialize`.'),
  connectedAt: z.iso
    .datetime()
    .describe('When the session was created, ISO 8601.'),
  lastSeenAt: z.iso
    .datetime()
    .describe('When the client last sent a message, ISO 8601.'),
});

/** Response body of `GET /api/v1/servers/{server}/sessions`. */
export type SessionList = {
  /** Live sessions, oldest first. */
  items: Session[];
};

export const sessionListSchema: z.ZodType<SessionList> = z.strictObject({
  items: z.array(sessionSchema).describe('Live sessions, oldest first.'),
});
