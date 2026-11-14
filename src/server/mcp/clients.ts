import { type ClientInfo, type MCPClient } from '@/shared/api';

/** A listed client with no open stream goes unlisted after this long without a request. */
export const IDLE_MS = 5 * 60 * 1000;

/** Most clients remembered per server. */
export const MAX_CLIENTS_PER_SERVER = 100;

/** What a 2026-07-28 request says about its sender. */
export type ClientIdentity = {
  /** Server the request is addressed to. */
  server: string;
  /** OAuth client the request's verified token was issued to, if the server uses OAuth. */
  oauthClientId: string | null;
  /** `clientInfo` of the request's `_meta` envelope, if valid. */
  clientInfo: ClientInfo | null;
  /** `protocolVersion` of the envelope. */
  protocolVersion: string | null;
  /** `clientCapabilities` of the envelope. */
  capabilities: Record<string, unknown>;
};

/** Registry of the stateless (2026-07-28) clients seen on each server. */
export type ClientRegistry = {
  /**
   * Records a request and returns the key of the client that sent it:
   * `oauth:<client_id>` when it carries a verified token, otherwise
   * `info:<name>/<version>` from its `_meta`, or `info:unknown`.
   *
   * @param identity - What the request says about its sender.
   */
  touch(identity: ClientIdentity): string;
  /**
   * Registers an open `subscriptions/listen` stream of a client.
   *
   * @param server - The server the stream is on.
   * @param id - The client's key.
   * @param close - Ends the stream.
   * @returns A function that unregisters it.
   */
  openSubscription(server: string, id: string, close: () => void): () => void;
  /** Listed clients of a server, oldest first. */
  list(server: string): MCPClient[];
  /** Number of listed clients of a server. */
  count(server: string): number;
  /**
   * Closes a client's streams and removes it.
   * @returns Whether the client was listed.
   */
  forget(server: string, id: string): boolean;
  /** Closes every client's streams and removes them, on `server`. */
  clear(server: string): void;
};

type ClientRecord = {
  id: string;
  clientInfo: ClientInfo | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown>;
  oauthClientId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  subscriptions: Set<() => void>;
};

/**
 * Creates the registry of stateless clients.
 *
 * @param now - Current time; injectable for tests.
 */
export function createClientRegistry(
  now: () => Date = () => new Date(),
): ClientRegistry {
  // server → client key → record, in first-seen order.
  const servers = new Map<string, Map<string, ClientRecord>>();

  const closeStreams = (record: ClientRecord) => {
    for (const close of record.subscriptions) {
      close();
    }
    record.subscriptions.clear();
  };

  const idle = (record: ClientRecord) =>
    record.subscriptions.size === 0 &&
    now().getTime() - record.lastSeenAt.getTime() > IDLE_MS;

  const prune = (server: string) => {
    const records = servers.get(server);
    for (const [id, record] of records ?? []) {
      if (idle(record)) {
        records?.delete(id);
      }
    }
    return records;
  };

  const evictOldest = (records: Map<string, ClientRecord>) => {
    const candidates = [...records.values()];
    const victim =
      candidates.find((record) => record.subscriptions.size === 0) ??
      candidates.at(0);
    if (victim !== undefined) {
      closeStreams(victim);
      records.delete(victim.id);
    }
  };

  return {
    touch({
      server,
      oauthClientId,
      clientInfo,
      protocolVersion,
      capabilities,
    }) {
      const id =
        oauthClientId === null
          ? `info:${clientInfo === null ? 'unknown' : `${clientInfo.name}/${clientInfo.version}`}`
          : `oauth:${oauthClientId}`;
      const records = prune(server) ?? new Map<string, ClientRecord>();
      servers.set(server, records);
      const timestamp = now();
      const known = records.get(id);
      if (known === undefined) {
        if (records.size >= MAX_CLIENTS_PER_SERVER) {
          evictOldest(records);
        }
        records.set(id, {
          id,
          clientInfo,
          protocolVersion,
          capabilities,
          oauthClientId,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          subscriptions: new Set(),
        });
      } else {
        // Latest request wins: a client may upgrade or change what it declares.
        known.clientInfo = clientInfo ?? known.clientInfo;
        known.protocolVersion = protocolVersion ?? known.protocolVersion;
        known.capabilities = capabilities;
        known.lastSeenAt = timestamp;
      }
      return id;
    },

    openSubscription(server, id, close) {
      const record = servers.get(server)?.get(id);
      if (record === undefined) {
        // Forgotten while the request was being served: end the stream.
        close();
        return () => {};
      }
      record.subscriptions.add(close);
      return () => {
        record.subscriptions.delete(close);
        record.lastSeenAt = now();
      };
    },

    list(server) {
      return [...(prune(server)?.values() ?? [])].map((record) => ({
        id: record.id,
        era: 'modern',
        clientInfo: record.clientInfo,
        requestedProtocolVersion: record.protocolVersion,
        protocolVersion: record.protocolVersion,
        capabilities: record.capabilities,
        oauthClientId: record.oauthClientId,
        connectedAt: record.firstSeenAt.toISOString(),
        lastSeenAt: record.lastSeenAt.toISOString(),
        openStreams: record.subscriptions.size,
      }));
    },

    count: (server) => prune(server)?.size ?? 0,

    forget(server, id) {
      const records = prune(server);
      const record = records?.get(id);
      if (record === undefined) {
        return false;
      }
      closeStreams(record);
      records?.delete(id);
      return true;
    },

    clear(server) {
      for (const record of servers.get(server)?.values() ?? []) {
        closeStreams(record);
      }
      servers.delete(server);
    },
  };
}
