import { type MiddlewareHandler } from 'hono';

import { type Exchange, type Capture } from '@/server/mcp';
import { type OAuthStore } from '@/server/oauth';
import { attributeExchange } from '@/server/oauth-http';
import { type ServerConfig } from '@/shared/api';

/** Hono environment of the MCP listener's app. */
export type ExchangeLogEnv = {
  Variables: {
    /** The recording of the request's exchange; absent for unknown servers and preflights. */
    exchange?: Exchange;
  };
};

/** Dependencies of the exchange logging middleware. */
export type ExchangeLogDeps = {
  /** Where exchanges are recorded. */
  capture: Capture;
  /** The definition of a server, or `undefined` when it doesn't exist. */
  findServer: (name: string) => ServerConfig | undefined;
  /** Every server, for attributing an OAuth exchange that names none. */
  listServers: () => readonly ServerConfig[];
  /** The OAuth store, to attribute a `/consent/:id` POST before it is resolved. */
  oauth: OAuthStore;
};

const MCP_PATH = /^\/s\/([^/]+)\/mcp$/;

/**
 * Records every HTTP exchange of the MCP listener, from the wire: `/s/{server}/mcp`
 * under its server, any other route (the OAuth ones) under the server or
 * servers `attributeExchange` finds. Preflights are not recorded, nor is an
 * unknown server.
 *
 * Register it before `cors()`, so the recorded response headers include the
 * CORS ones.
 *
 * @param deps - Capture, server lookups and the OAuth store.
 */
export function createExchangeLog({
  capture,
  findServer,
  listServers,
  oauth,
}: ExchangeLogDeps): MiddlewareHandler<ExchangeLogEnv> {
  return async (c, next) => {
    const request = c.req.raw;
    if (request.method === 'OPTIONS') {
      await next();
      return;
    }

    const mcpServer = MCP_PATH.exec(new URL(request.url).pathname)?.[1];
    const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
    // Never `c.req.text()`: it consumes the body of `c.req.raw`, and the SDK
    // would answer every POST with a parse error.
    const text = hasBody ? await request.clone().text() : null;

    if (mcpServer !== undefined) {
      const name = decodeSegment(mcpServer);
      if (findServer(name) === undefined) {
        await next();
        return;
      }
      c.set(
        'exchange',
        capture.begin({
          servers: [name],
          endpoint: 'mcp',
          request,
          body: request.method === 'POST' ? text : null,
        }),
      );
    } else {
      const servers = await attributeExchange({
        request,
        requestText: text ?? '',
        listServers,
        store: oauth,
      });
      c.set(
        'exchange',
        capture.begin({
          servers,
          endpoint: 'oauth',
          request,
          body: text === '' ? null : text,
        }),
      );
    }

    await next();
    const exchange = c.get('exchange');
    if (exchange !== undefined) {
      c.res = await exchange.respond(c.res);
    }
  };
}

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
