import {
  type CallToolResult,
  ProtocolError,
  ProtocolErrorCode,
  Server,
  type Tool,
} from '@modelcontextprotocol/server';

import { renderTemplate } from '@/server/templates';
import { type ServerConfig, type ToolConfig } from '@/shared/api';

/** What a session's SDK `Server` needs to answer requests. */
export type SessionServerDeps = {
  /** The mock server's definition at session creation (identity, instructions). */
  config: ServerConfig;
  /** Published tools, read fresh on every request so live edits show up. */
  listPublishedTools: () => ToolConfig[];
};

/**
 * Creates the low-level SDK `Server` of one session. It advertises only
 * `tools: { listChanged: true }`.
 *
 * @param deps - Server definition and live tool lookup.
 */
// The low-level Server is deprecated in favor of McpServer, but McpServer
// can't serve tools that are redefined at runtime from templates.
export function createSessionServer({
  config,
  listPublishedTools,
  // oxlint-disable-next-line typescript/no-deprecated
}: SessionServerDeps): Server {
  // oxlint-disable-next-line typescript/no-deprecated
  const server = new Server(config.serverInfo, {
    capabilities: { tools: { listChanged: true } },
    ...(config.instructions === undefined
      ? {}
      : { instructions: config.instructions }),
  });

  server.setRequestHandler('tools/list', () => ({
    tools: listPublishedTools().map(toMCPTool),
  }));

  server.setRequestHandler('tools/call', (request) => {
    const { name, arguments: args } = request.params;
    const tool = listPublishedTools().find(
      (candidate) => candidate.name === name,
    );
    if (tool === undefined) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown tool: ${name}`,
      );
    }
    const rendered = renderTemplate(tool.responseTemplate, {
      args: args ?? {},
    });
    return rendered.ok ? rendered.result : templateFailure(rendered.errors);
  });

  return server;
}

const toMCPTool = (tool: ToolConfig): Tool => ({
  name: tool.name,
  ...(tool.title === undefined ? {} : { title: tool.title }),
  description: tool.description,
  inputSchema: { ...tool.inputSchema, type: 'object' },
  ...(Object.keys(tool.annotations).length === 0
    ? {}
    : { annotations: tool.annotations }),
});

const templateFailure = (
  errors: { path: string; message: string }[],
): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: [
        'MCP Decoy: the response template of this tool failed to render.',
        ...errors.map(({ path, message }) =>
          path === '' ? message : `${path}: ${message}`,
        ),
      ].join('\n'),
    },
  ],
  isError: true,
});
