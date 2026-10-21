import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type MiddlewareHandler } from 'hono';

import { type ApiV1, problemResponse } from '@/server/api';
import { PROBLEM_TYPES } from '@/shared/api';

/** Origin of the Vite dev server, allowed by the CSRF check in dev mode. */
export const VITE_DEV_PORT = 5173;

/** Options of the UI listener's app. */
export type UIAppOptions = {
  /** The `/api/v1` app. */
  api: ApiV1;
  /** Port the UI listener is bound to, for the Host and Origin checks. Read per request. */
  port: () => number;
  /**
   * Absolute path of the built SPA (`dist/ui`). `null` in dev mode, where
   * Vite serves the SPA and nothing static is served here.
   */
  staticRoot: string | null;
  /** Dev mode: also allow the Vite dev server's origin. */
  dev: boolean;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Creates the UI listener's app: the REST API under `/api/v1`, then the
 * built SPA with an `index.html` fallback for client-side routes.
 *
 * @param options - API, port, static root and dev flag.
 */
export function createUIApp({ api, port, staticRoot, dev }: UIAppOptions) {
  const allowedHosts = () => [`localhost:${port()}`, `127.0.0.1:${port()}`];
  const allowedOrigins = () => [
    ...allowedHosts().map((host) => `http://${host}`),
    ...(dev
      ? [
          `http://localhost:${VITE_DEV_PORT}`,
          `http://127.0.0.1:${VITE_DEV_PORT}`,
        ]
      : []),
  ];

  const app = new Hono();
  app.use(hostCheck(allowedHosts));
  app.use('/api/*', csrfCheck(allowedOrigins));
  app.route('/api/v1', api);
  app.all('/api/*', (c) =>
    problemResponse({
      type: PROBLEM_TYPES.notFound,
      title: 'Not found',
      status: 404,
      detail: `No route for ${c.req.method} ${c.req.path}`,
    }),
  );

  if (staticRoot !== null) {
    app.use(
      '/assets/*',
      async (c, next) => {
        await next();
        if (c.res.ok) {
          c.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
      serveStatic({ root: staticRoot }),
    );
    app.use(serveStatic({ root: staticRoot }));
    const indexPath = join(staticRoot, 'index.html');
    app.get('*', async (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(await readFile(indexPath, 'utf8'));
    });
  }

  return app;
}

/** Rejects requests whose `Host` isn't the UI listener itself (DNS rebinding). */
function hostCheck(allowedHosts: () => string[]): MiddlewareHandler {
  return async (c, next) => {
    const hosts = allowedHosts();
    if (!hosts.includes(c.req.header('host') ?? '')) {
      return problemResponse({
        type: PROBLEM_TYPES.forbidden,
        title: 'Forbidden',
        status: 403,
        detail: `Host "${c.req.header('host') ?? ''}" is not allowed. Open the UI at ${hosts.map((host) => `http://${host}`).join(' or ')}.`,
      });
    }
    await next();
  };
}

/**
 * CSRF protection for mutating API requests: a JSON body (so browsers must
 * preflight cross-origin requests) and, when present, an allowed `Origin`.
 * DELETE has no body and always needs a preflight cross-origin, so only its
 * Origin is checked.
 */
function csrfCheck(allowedOrigins: () => string[]): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method)) {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !allowedOrigins().includes(origin)) {
      return problemResponse({
        type: PROBLEM_TYPES.forbidden,
        title: 'Forbidden',
        status: 403,
        detail: `Origin "${origin}" is not allowed.`,
      });
    }
    const contentType = c.req.header('content-type') ?? '';
    if (
      BODY_METHODS.has(c.req.method) &&
      !/^application\/json\s*(;|$)/i.test(contentType)
    ) {
      return problemResponse({
        type: PROBLEM_TYPES.unsupportedMediaType,
        title: 'Unsupported media type',
        status: 415,
        detail:
          'Send the request body as JSON with Content-Type: application/json.',
      });
    }
    await next();
  };
}
