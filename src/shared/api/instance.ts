import { z } from 'zod';

/** Response body of `GET /api/v1`: what this MCP Decoy instance is and where it listens. */
export type InstanceInfo = {
  /** MCP Decoy version. */
  version: string;
  /** The MCP listener. */
  mcp: {
    /** Bind address of the MCP listener. */
    host: string;
    /** Port of the MCP listener. */
    port: number;
    /** Endpoint pattern; replace `{server}` with a server name. */
    urlTemplate: string;
  };
  /** The UI and API listener. */
  ui: {
    /** Port of the UI listener (always bound to 127.0.0.1). */
    port: number;
  };
  /** Absolute path of the file servers are stored in. */
  configFile: string;
  /** Links to the API's collections. */
  links: {
    /** The servers collection. */
    servers: string;
  };
};

export const instanceInfoSchema: z.ZodType<InstanceInfo> = z.strictObject({
  version: z.string().describe('MCP Decoy version.'),
  mcp: z
    .strictObject({
      host: z.string().describe('Bind address of the MCP listener.'),
      port: z.number().int().describe('Port of the MCP listener.'),
      urlTemplate: z
        .string()
        .describe('Endpoint pattern; replace `{server}` with a server name.'),
    })
    .describe('The MCP listener.'),
  ui: z
    .strictObject({
      port: z
        .number()
        .int()
        .describe('Port of the UI listener (always bound to 127.0.0.1).'),
    })
    .describe('The UI and API listener.'),
  configFile: z
    .string()
    .describe('Absolute path of the file servers are stored in.'),
  links: z
    .strictObject({
      servers: z.string().describe('The servers collection.'),
    })
    .describe("Links to the API's collections."),
});
