import { describe, expect, it } from 'vitest';

import { renderTemplate } from '@/server/templates';
import { serverConfigSchema } from '@/shared/api';

import { createDefaultServers } from './default-servers';

describe('createDefaultServers', () => {
  const now = new Date('2026-10-23T09:00:00.000Z');

  it('returns one valid server named echo', () => {
    const servers = createDefaultServers(now);

    expect(servers).toHaveLength(1);
    expect(serverConfigSchema.parse(servers[0])).toMatchObject({
      name: 'echo',
      createdAt: '2026-10-23T09:00:00.000Z',
    });
  });

  it('has one published echo tool', () => {
    const [server] = createDefaultServers(now);

    expect(server.tools).toMatchObject([
      { name: 'echo', published: true, updatedAt: '2026-10-23T09:00:00.000Z' },
    ]);
  });

  it('renders the message argument as text', () => {
    const [tool] = createDefaultServers(now)[0].tools;

    expect(
      renderTemplate(tool.responseTemplate, { args: { message: 'hi' } }),
    ).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'hi' }] },
    });
  });
});
