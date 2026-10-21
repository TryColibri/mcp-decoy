import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ConflictError, NotFoundError } from '@/server/errors';
import { type DecoyEvents, type EventBus } from '@/server/events';
import { createServerRepository } from '@/server/servers';
import { type ServerConfig } from '@/shared/api';

import { createToolsService, type ToolsService } from './service';

const NOW = new Date('2026-10-21T12:00:00.000Z');

const server = (): ServerConfig => ({
  name: 'weather',
  serverInfo: { name: 'decoy/weather', version: '0.1.0' },
  tools: [],
  createdAt: NOW.toISOString(),
});

describe('ToolsService', () => {
  let mockPersist: ReturnType<
    typeof vi.fn<(servers: ServerConfig[]) => Promise<void>>
  >;
  let mockEvents: {
    emit: Mock<EventBus<DecoyEvents>['emit']>;
    on: Mock<EventBus<DecoyEvents>['on']>;
  };
  let service: ToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersist = vi.fn(async () => {});
    mockEvents = {
      emit: vi.fn<EventBus<DecoyEvents>['emit']>(),
      on: vi.fn<EventBus<DecoyEvents>['on']>(),
    };
    service = createToolsService({
      repository: createServerRepository({
        initial: [server()],
        persist: mockPersist,
      }),
      events: mockEvents,
      now: () => NOW,
    });
  });

  describe('create', () => {
    it('creates a draft with defaults without notifying clients', async () => {
      const tool = await service.create('weather', { name: 'echo' });

      expect(tool).toEqual({
        name: 'echo',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        annotations: {},
        responseTemplate: {
          content: [{ type: 'text', text: { $json: { $eval: 'args' } } }],
        },
        published: false,
        updatedAt: NOW.toISOString(),
        warnings: [],
      });
      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('notifies clients when created published', async () => {
      await service.create('weather', { name: 'echo', published: true });

      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('toolsChanged', {
        server: 'weather',
      });
    });

    it('throws ConflictError for a duplicate name', async () => {
      await service.create('weather', { name: 'echo' });

      await expect(service.create('weather', { name: 'echo' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('throws NotFoundError for an unknown server', async () => {
      await expect(service.create('nope', { name: 'echo' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('returns template warnings without blocking', async () => {
      const tool = await service.create('weather', {
        name: 'needs_args',
        responseTemplate: { content: [{ type: 'text', text: '${args.a.b}' }] },
      });

      expect(tool.warnings).toHaveLength(1);
      expect(service.list('weather')).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('publishes a draft and notifies clients', async () => {
      await service.create('weather', { name: 'echo' });

      const tool = await service.update('weather', 'echo', { published: true });

      expect(tool.published).toBe(true);
      expect(service.listPublished('weather').map((t) => t.name)).toEqual([
        'echo',
      ]);
      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('toolsChanged', {
        server: 'weather',
      });
    });

    it('notifies clients when unpublishing', async () => {
      await service.create('weather', { name: 'echo', published: true });
      mockEvents.emit.mockClear();

      await service.update('weather', 'echo', { published: false });

      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('toolsChanged', {
        server: 'weather',
      });
    });

    it('does not notify clients when editing a draft', async () => {
      await service.create('weather', { name: 'echo' });

      await service.update('weather', 'echo', { description: 'Echo' });

      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('renames a tool and removes the title with null', async () => {
      await service.create('weather', { name: 'echo', title: 'Echo' });

      const tool = await service.update('weather', 'echo', {
        name: 'echo2',
        title: null,
      });

      expect(tool.name).toBe('echo2');
      expect(tool).not.toHaveProperty('title');
      expect(() => service.get('weather', 'echo')).toThrow(NotFoundError);
    });

    it('throws ConflictError when renaming onto another tool', async () => {
      await service.create('weather', { name: 'a' });
      await service.create('weather', { name: 'b' });

      await expect(
        service.update('weather', 'a', { name: 'b' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('delete', () => {
    it('removes a published tool and notifies clients', async () => {
      await service.create('weather', { name: 'echo', published: true });
      mockEvents.emit.mockClear();

      await service.delete('weather', 'echo');

      expect(service.list('weather')).toEqual([]);
      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('toolsChanged', {
        server: 'weather',
      });
    });

    it('throws NotFoundError for an unknown tool', async () => {
      await expect(service.delete('weather', 'nope')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('listPublished', () => {
    it('returns an empty list for an unknown server', () => {
      expect(service.listPublished('nope')).toEqual([]);
    });
  });
});
