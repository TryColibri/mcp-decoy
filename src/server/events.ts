/** Events emitted by services after a successful mutation. */
export type MCPDecoyEvents = {
  /** `server` was created. */
  serverCreated: { server: string };
  /** The set of tools clients can see on `server` changed. */
  toolsChanged: { server: string };
  /** `server` was deleted. */
  serverDeleted: { server: string };
  /** The server named `from` is now named `to`. */
  serverRenamed: { from: string; to: string };
  /** `server`'s authentication state changed. */
  serverAuthChanged: { server: string };
};

type Listener<T> = (payload: T) => void;

/** A small synchronous, typed event bus. */
export type EventBus<Events extends Record<string, unknown>> = {
  /**
   * Calls every listener of `event`, in subscription order. A throwing
   * listener does not prevent the others from running.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
  /** Subscribes to `event`. Returns a function that unsubscribes. */
  on<K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>,
  ): () => void;
};

/**
 * Creates an event bus.
 *
 * @param onListenerError - Called when a listener throws.
 */
export function createEventBus<Events extends Record<string, unknown>>(
  onListenerError: (error: unknown) => void = () => {},
): EventBus<Events> {
  const listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  return {
    emit(event, payload) {
      for (const listener of listeners[event] ?? []) {
        try {
          listener(payload);
        } catch (error) {
          onListenerError(error);
        }
      }
    },
    on(event, listener) {
      const set = listeners[event] ?? new Set();
      listeners[event] = set;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
}
