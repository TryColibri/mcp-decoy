import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  type ClientIdentity,
  type ClientRegistry,
  createClientRegistry,
  IDLE_MS,
  MAX_CLIENTS_PER_SERVER,
} from './clients';

const identity = (fields: Partial<ClientIdentity> = {}): ClientIdentity => ({
  server: 'weather',
  oauthClientId: null,
  clientInfo: { name: 'demo', version: '1.0.0' },
  protocolVersion: '2026-07-28',
  capabilities: {},
  ...fields,
});

describe('createClientRegistry', () => {
  let registry: ClientRegistry;

  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
    registry = createClientRegistry();
  });

  describe('touch', () => {
    it('keys a client by its name and version', () => {
      expect(registry.touch(identity())).toBe('info:demo/1.0.0');
    });

    it('keys a client with no identity as unknown', () => {
      expect(registry.touch(identity({ clientInfo: null }))).toBe(
        'info:unknown',
      );
    });

    it('keys a client with a verified token by the OAuth client, whatever it calls itself', () => {
      expect(registry.touch(identity({ oauthClientId: 'abc' }))).toBe(
        'oauth:abc',
      );
    });

    it('lists one record per key and tracks first and last seen', () => {
      registry.touch(identity());
      vi.advanceTimersByTime(1000);
      registry.touch(identity({ capabilities: { extensions: {} } }));

      expect(registry.list('weather')).toEqual([
        {
          id: 'info:demo/1.0.0',
          era: 'modern',
          clientInfo: { name: 'demo', version: '1.0.0' },
          requestedProtocolVersion: '2026-07-28',
          protocolVersion: '2026-07-28',
          capabilities: { extensions: {} },
          oauthClientId: null,
          connectedAt: '2026-10-21T12:00:00.000Z',
          lastSeenAt: '2026-10-21T12:00:01.000Z',
          openStreams: 0,
        },
      ]);
    });

    it('keeps servers apart', () => {
      registry.touch(identity());

      expect(registry.count('weather')).toBe(1);
      expect(registry.count('echo')).toBe(0);
    });
  });

  describe('idle pruning', () => {
    it('unlists a client that has been quiet for longer than the idle time', () => {
      registry.touch(identity());

      vi.advanceTimersByTime(IDLE_MS + 1);

      expect(registry.list('weather')).toEqual([]);
      expect(registry.count('weather')).toBe(0);
    });

    it('keeps a client that sent a request recently', () => {
      registry.touch(identity());
      vi.advanceTimersByTime(IDLE_MS - 1);

      expect(registry.count('weather')).toBe(1);
    });

    it('keeps a client with an open stream however long it is quiet', () => {
      const id = registry.touch(identity());
      registry.openSubscription('weather', id, vi.fn());

      vi.advanceTimersByTime(IDLE_MS * 10);

      expect(registry.list('weather')).toMatchObject([{ id, openStreams: 1 }]);
    });

    it('starts the idle time again when the last stream closes', () => {
      const id = registry.touch(identity());
      const unregister = registry.openSubscription('weather', id, vi.fn());
      vi.advanceTimersByTime(IDLE_MS * 10);

      unregister();
      vi.advanceTimersByTime(IDLE_MS - 1);

      expect(registry.count('weather')).toBe(1);
    });
  });

  describe('cap', () => {
    it('drops the oldest client without a stream beyond the per-server cap', () => {
      const first = registry.touch(identity({ oauthClientId: 'first' }));
      registry.openSubscription('weather', first, vi.fn());
      registry.touch(identity({ oauthClientId: 'second' }));
      for (let index = 0; index < MAX_CLIENTS_PER_SERVER - 2; index++) {
        registry.touch(identity({ oauthClientId: `client-${index}` }));
      }
      expect(registry.count('weather')).toBe(MAX_CLIENTS_PER_SERVER);

      registry.touch(identity({ oauthClientId: 'newest' }));

      const ids = registry.list('weather').map((client) => client.id);
      expect(ids).toHaveLength(MAX_CLIENTS_PER_SERVER);
      expect(ids).toContain('oauth:first');
      expect(ids).not.toContain('oauth:second');
      expect(ids).toContain('oauth:newest');
    });
  });

  describe('forget', () => {
    it('closes the streams of the client and removes it', () => {
      const id = registry.touch(identity());
      const close = vi.fn();
      registry.openSubscription('weather', id, close);

      expect(registry.forget('weather', id)).toBe(true);

      expect(close).toHaveBeenCalledTimes(1);
      expect(registry.count('weather')).toBe(0);
    });

    it('answers false for a client that is not listed', () => {
      expect(registry.forget('weather', 'info:nobody/1')).toBe(false);
    });
  });

  describe('openSubscription', () => {
    it('ends a stream of a client that was forgotten meanwhile', () => {
      const close = vi.fn();

      registry.openSubscription('weather', 'info:gone/1', close);

      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('closes every stream and removes every client of the server', () => {
      const first = registry.touch(identity());
      const close = vi.fn();
      registry.openSubscription('weather', first, close);
      registry.touch(identity({ server: 'echo' }));

      registry.clear('weather');

      expect(close).toHaveBeenCalledTimes(1);
      expect(registry.count('weather')).toBe(0);
      expect(registry.count('echo')).toBe(1);
    });
  });
});
