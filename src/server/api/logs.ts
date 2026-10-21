import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ValidationError } from '@/server/errors';
import { type LogEvent, type LogsService } from '@/server/logs';
import {
  LOG_PAGE_DEFAULT_LIMIT,
  LOG_STREAM_EVENTS,
  type LogEntry,
  logEntrySchema,
  logPageQuerySchema,
  logPageSchema,
  logStreamQuerySchema,
} from '@/shared/api';

import { decodeCursor, encodeCursor } from './cursor';
import { validationHook } from './problems';

/** Interval between SSE heartbeat comments. */
const HEARTBEAT_MS = 15_000;

/**
 * `/api/v1/servers/{server}/logs`, `…/logs/stream` and `…/logs/export`.
 *
 * @param logs - The logs service.
 */
export function createLogsRoutes(logs: LogsService) {
  return new Hono()
    .get(
      '/:server/logs',
      zValidator('query', logPageQuerySchema, validationHook),
      (c) => {
        const {
          q,
          cursor,
          limit = LOG_PAGE_DEFAULT_LIMIT,
        } = c.req.valid('query');
        let beforeId: number | undefined;
        if (cursor !== undefined) {
          const decoded = decodeCursor(cursor);
          if (decoded === null) {
            throw new ValidationError([
              { path: 'cursor', message: 'Invalid cursor' },
            ]);
          }
          beforeId = decoded;
        }
        const page = logs.page(c.req.param('server'), {
          text: q,
          beforeId,
          limit,
        });
        const last = page.items.at(-1);
        return c.json(
          logPageSchema.parse({
            items: page.items,
            nextCursor:
              page.more && last !== undefined ? encodeCursor(last.id) : null,
          }),
          200,
        );
      },
    )
    .delete('/:server/logs', (c) => {
      logs.clear(c.req.param('server'));
      return c.body(null, 204);
    })
    .get(
      '/:server/logs/stream',
      zValidator('query', logStreamQuerySchema, validationHook),
      (c) => {
        const server = c.req.param('server');
        const lastEventID = Number.parseInt(
          c.req.header('last-event-id') ?? '',
          10,
        );
        const afterId = Number.isSafeInteger(lastEventID)
          ? lastEventID
          : (c.req.valid('query').after ?? 0);

        // Subscribe and read the backlog in the same tick, so nothing is
        // missed or sent twice.
        const queue: LogEvent[] = [];
        let wake: (() => void) | undefined;
        const unsubscribe = logs.subscribe(server, (event) => {
          queue.push(event);
          wake?.();
        });
        const backlog = logs.after(server, afterId);

        return streamSSE(c, async (stream) => {
          stream.onAbort(() => {
            unsubscribe();
            wake?.();
          });

          const writeEntry = async (entry: LogEntry) =>
            stream.writeSSE({
              event: LOG_STREAM_EVENTS.entry,
              id: String(entry.id),
              data: JSON.stringify(logEntrySchema.parse(entry)),
            });

          const heartbeat = setInterval(() => {
            void stream.write(': heartbeat\n\n');
          }, HEARTBEAT_MS);

          try {
            for (const entry of backlog) {
              await writeEntry(entry);
            }
            while (!stream.aborted) {
              const event = queue.shift();
              if (event === undefined) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = undefined;
              } else if (event.type === 'entry') {
                await writeEntry(event.entry);
              } else {
                await stream.writeSSE({
                  event: LOG_STREAM_EVENTS.cleared,
                  data: '{}',
                });
              }
            }
          } finally {
            clearInterval(heartbeat);
            unsubscribe();
          }
        });
      },
    )
    .get('/:server/logs/export', (c) => {
      const server = c.req.param('server');
      const lines = logs
        .all(server)
        .map((entry) => `${JSON.stringify(logEntrySchema.parse(entry))}\n`);
      return c.body(lines.join(''), 200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="decoy-${server}-logs.jsonl"`,
      });
    });
}
