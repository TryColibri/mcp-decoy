import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ConflictError, NotFoundError } from '@/server/errors';
import { type MCPDecoyEvents, type EventBus } from '@/server/events';
import { type ServerConfig } from '@/shared/api';

import { createServerRepository } from './repository';
import { createServersService, type ServersService } from './service';

const NOW = new Date('2026-10-21T12:00:00.000Z');

describe('ServersService', () => {
  let mockPersist: ReturnType<
    typeof vi.fn<(servers: ServerConfig[]) => Promise<void>>
  >;
  let mockEvents: {
    emit: Mock<EventBus<MCPDecoyEvents>['emit']>;
    on: Mock<EventBus<MCPDecoyEvents>['on']>;
  };
  let service: ServersService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersist = vi.fn(async () => {});
    mockEvents = {
      emit: vi.fn<EventBus<MCPDecoyEvents>['emit']>(),
      on: vi.fn<EventBus<MCPDecoyEvents>['on']>(),
    };
    service = createServersService({
      repository: createServerRepository({ initial: [], persist: mockPersist }),
      events: mockEvents,
      sessionCount: (server) => (server === 'weather' ? 2 : 0),
      mcpUrl: (server) => `http://localhost:6280/s/${server}/mcp`,
      now: () => NOW,
    });
  });

  describe('create', () => {
    it('emits serverCreated', async () => {
      await service.create({ name: 'weather' });

      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('serverCreated', {
        server: 'weather',
      });
    });

    it('applies defaults and persists', async () => {
      const created = await service.create({ name: 'weather' });

      expect(created).toEqual({
        name: 'weather',
        serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
        createdAt: NOW.toISOString(),
        mcpUrl: 'http://localhost:6280/s/weather/mcp',
        toolCount: 0,
        publishedToolCount: 0,
        sessionCount: 2,
      });
      expect(mockPersist).toHaveBeenCalledExactlyOnceWith([
        {
          name: 'weather',
          serverInfo: { name: 'mcp-decoy/weather', version: '0.1.0' },
          tools: [],
          createdAt: NOW.toISOString(),
        },
      ]);
    });

    it('keeps the given serverInfo and instructions', async () => {
      const created = await service.create({
        name: 'echo',
        serverInfo: { version: '2.0.0' },
        instructions: 'Hi',
      });

      expect(created).toMatchObject({
        serverInfo: { name: 'mcp-decoy/echo', version: '2.0.0' },
        instructions: 'Hi',
      });
    });

    it('throws ConflictError for a duplicate name', async () => {
      await service.create({ name: 'weather' });

      await expect(service.create({ name: 'weather' })).rejects.toThrow(
        ConflictError,
      );
      expect(mockPersist).toHaveBeenCalledTimes(1);
    });

    it('changes nothing when persisting fails', async () => {
      mockPersist.mockRejectedValueOnce(new Error('disk full'));

      await expect(service.create({ name: 'weather' })).rejects.toThrow(
        'disk full',
      );
      expect(service.list()).toEqual([]);
    });
  });

  describe('get', () => {
    it('throws NotFoundError for an unknown server', () => {
      expect(() => service.get('nope')).toThrow(NotFoundError);
    });
  });

  describe('update', () => {
    it('merges serverInfo field by field and keeps the rest', async () => {
      await service.create({ name: 'weather', instructions: 'Hi' });
      mockEvents.emit.mockClear();

      const updated = await service.update('weather', {
        serverInfo: { version: '2.0.0' },
      });

      expect(updated).toMatchObject({
        name: 'weather',
        serverInfo: { name: 'mcp-decoy/weather', version: '2.0.0' },
        instructions: 'Hi',
        createdAt: NOW.toISOString(),
      });
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('removes the instructions when given an empty string', async () => {
      await service.create({ name: 'weather', instructions: 'Hi' });
      mockEvents.emit.mockClear();

      const updated = await service.update('weather', { instructions: '' });

      expect(updated.instructions).toBeUndefined();
      expect(service.get('weather').instructions).toBeUndefined();
    });

    it('renames in place, keeps tools and emits serverRenamed', async () => {
      await service.create({ name: 'first' });
      await service.create({ name: 'weather' });
      mockEvents.emit.mockClear();

      const updated = await service.update('weather', { name: 'forecast' });

      expect(updated.name).toBe('forecast');
      expect(updated.mcpUrl).toBe('http://localhost:6280/s/forecast/mcp');
      expect(service.names()).toEqual(['first', 'forecast']);
      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('serverRenamed', {
        from: 'weather',
        to: 'forecast',
      });
    });

    it('is not a rename when the name is unchanged', async () => {
      await service.create({ name: 'weather' });
      mockEvents.emit.mockClear();

      await service.update('weather', { name: 'weather' });

      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('throws ConflictError when renaming onto an existing server', async () => {
      await service.create({ name: 'a' });
      await service.create({ name: 'b' });
      mockEvents.emit.mockClear();

      await expect(service.update('a', { name: 'b' })).rejects.toThrow(
        ConflictError,
      );
      expect(service.names()).toEqual(['a', 'b']);
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundError for an unknown server', async () => {
      await expect(service.update('nope', {})).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('removes the server and emits serverDeleted', async () => {
      await service.create({ name: 'weather' });
      mockEvents.emit.mockClear();

      await service.delete('weather');

      expect(service.list()).toEqual([]);
      expect(mockEvents.emit).toHaveBeenCalledExactlyOnceWith('serverDeleted', {
        server: 'weather',
      });
    });

    it('throws NotFoundError for an unknown server', async () => {
      await expect(service.delete('nope')).rejects.toThrow(NotFoundError);
      expect(mockEvents.emit).not.toHaveBeenCalled();
    });
  });
});
