import { type ServerConfig } from '@/shared/api';

/**
 * The servers a fresh configuration starts with: `echo`, one server with one
 * published `echo` tool that returns its `message` argument.
 *
 * @param now - Creation time of the server and its tool.
 */
export function createDefaultServers(now: Date): ServerConfig[] {
  const timestamp = now.toISOString();
  return [
    {
      name: 'echo',
      serverInfo: { name: 'mcp-decoy/echo', version: '0.1.0' },
      tools: [
        {
          name: 'echo',
          description: 'Echoes the message back.',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Text to echo back.' },
            },
            required: ['message'],
          },
          annotations: { readOnlyHint: true },
          responseTemplate: {
            content: [{ type: 'text', text: '${args.message}' }],
          },
          published: true,
          updatedAt: timestamp,
        },
      ],
      createdAt: timestamp,
    },
  ];
}
