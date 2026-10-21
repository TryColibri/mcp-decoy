import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ConflictError, NotFoundError } from '@/server/errors';
import { type DecoyEvents, type EventBus } from '@/server/events';
import { type ServerConfig } from '@/shared/api';

import { createServerRepository } from './repository';
import { createServersService, type ServersService } from './service';

const NOW = new Date('2026-10-21T12:00:00.000Z');

describe('ServersService', () => {
  let mockPersist: ReturnType<
    typeof vi.fn<(servers: ServerConfig[]) => Promise<void>>
  >;
  let mockEvents: {
    emit: Mock<EventBus<DecoyEvents>['emit']>;
    on: Mock<EventBus<DecoyEvents>['on']>;
  };
  let service: ServersService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPersist = vi.fn(async () => {});
    mockEvents = {
      emit: vi.fn<EventBus<DecoyEvents>['emit']>(),
      on: vi.fn<EventBus<DecoyEvents>['on']>(),
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
    it('applies defaults and persists', async () => {
      const created = await service.create({ name: 'weather' });

      expect(created).toEqual({
        name: 'weather',
        serverInfo: { name: 'decoy/weather', version: '0.1.0' },
        createdAt: NOW.toISOString(),
        mcpUrl: 'http://localhost:6280/s/weather/mcp',
        toolCount: 0,
        publishedToolCount: 0,
        sessionCount: 2,
      });
      expect(mockPersist).toHaveBeenCalledExactlyOnceWith([
        {
          name: 'weather',
          serverInfo: { name: 'decoy/weather', version: '0.1.0' },
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
        serverInfo: { name: 'decoy/echo', version: '2.0.0' },
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

  describe('delete', () => {
    it('removes the server and emits serverDeleted', async () => {
      await service.create({ name: 'weather' });

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
