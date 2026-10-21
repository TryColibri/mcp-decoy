import { type ServerConfig } from '@/shared/api';

/** What a repository transaction returns: the new server list and a value for the caller. */
export type Transaction<T> = {
  /** The complete server list after the change. */
  servers: ServerConfig[];
  /** Returned to the caller of `update`. */
  result: T;
};

/** In-memory source of truth for servers, persisted on every change. */
export type ServerRepository = {
  /** Every server, in creation order. */
  list(): readonly ServerConfig[];
  /** The server named `name`, if any. */
  find(name: string): ServerConfig | undefined;
  /**
   * Applies a change. Changes run one at a time: `change` sees the result of
   * the previous one. The new list is persisted before it becomes visible;
   * if `change` throws or persisting fails, nothing changes.
   */
  update<T>(
    change: (servers: readonly ServerConfig[]) => Transaction<T>,
  ): Promise<T>;
};

/** Dependencies of the server repository. */
export type ServerRepositoryDeps = {
  /** Servers loaded at startup. */
  initial: ServerConfig[];
  /** Persists the complete server list. */
  persist: (servers: ServerConfig[]) => Promise<void>;
};

/**
 * Creates a server repository.
 *
 * @param deps - Initial servers and persistence.
 */
export function createServerRepository({
  initial,
  persist,
}: ServerRepositoryDeps): ServerRepository {
  let current: readonly ServerConfig[] = initial;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    list: () => current,
    find: (name) => current.find((server) => server.name === name),
    update(change) {
      const run = queue.then(async () => {
        const { servers, result } = change(current);
        await persist(servers);
        current = servers;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
