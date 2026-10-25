import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ValidationError } from '@/server/errors';
import { type LogStreamEvent, type LogsService } from '@/server/logs';
import {
  LOG_PAGE_DEFAULT_LIMIT,
  LOG_STREAM_EVENTS,
  logEntrySchema,
  logEvictedSchema,
  logFactSchema,
  logPageQuerySchema,
  logPageSchema,
  logStreamQuerySchema,
} from '@/shared/api';

import { decodeCursor, encodeCursor } from './cursor';
import { validationHook } from './problems';

/** Interval between SSE heartbeat comments. */
const HEARTBEAT_MS = 15_000;

/**
 * `/api/v1/servers/{server}/logs`, `…/logs/{id}`, `…/logs/stream` and
 * `…/logs/export`. Entries are identified by the id of their anchor fact; the
 * stream and its `Last-Event-ID` speak in fact ids.
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
          carriedBy,
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
          carriedBy,
          beforeId,
          limit,
        });
        const last = page.items.at(-1);
        return c.json(
          logPageSchema.parse({
            items: page.items,
            nextCursor:
              page.more && last !== undefined ? encodeCursor(last.id) : null,
            total: page.total,
            after: page.after,
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
        const { q, after } = c.req.valid('query');
        const lastEventID = Number.parseInt(
          c.req.header('last-event-id') ?? '',
          10,
        );
        const afterId = Number.isSafeInteger(lastEventID)
          ? lastEventID
          : (after ?? 0);

        const queue: LogStreamEvent[] = [];
        let wake: (() => void) | undefined;
        const unsubscribe = logs.stream(
          server,
          { text: q, afterId },
          (event) => {
            queue.push(event);
            wake?.();
          },
        );

        return streamSSE(c, async (stream) => {
          stream.onAbort(() => {
            unsubscribe();
            wake?.();
          });

          const writeEvent = async (event: LogStreamEvent) => {
            if (event.type === 'fact') {
              await stream.writeSSE({
                event: LOG_STREAM_EVENTS.fact,
                // A late anchor has no id, so a reconnect resumes before the
                // attachment that made it match.
                ...(event.late ? {} : { id: String(event.fact.id) }),
                data: JSON.stringify(logFactSchema.parse(event.fact)),
              });
            } else if (event.type === 'evicted') {
              await stream.writeSSE({
                event: LOG_STREAM_EVENTS.evicted,
                data: JSON.stringify(logEvictedSchema.parse({ id: event.id })),
              });
            } else {
              await stream.writeSSE({
                event: LOG_STREAM_EVENTS.cleared,
                data: '{}',
              });
            }
          };

          const heartbeat = setInterval(() => {
            void stream.write(': heartbeat\n\n');
          }, HEARTBEAT_MS);

          try {
            while (!stream.aborted) {
              const event = queue.shift();
              if (event === undefined) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                wake = undefined;
              } else {
                await writeEvent(event);
              }
            }
          } finally {
            clearInterval(heartbeat);
            unsubscribe();
          }
        });
      },
    )
    .get('/:server/logs/:id{[0-9]+}', (c) => {
      const entry = logs.get(
        c.req.param('server'),
        Number.parseInt(c.req.param('id'), 10),
      );
      return c.json(logEntrySchema.parse(entry), 200);
    })
    .get('/:server/logs/export', (c) => {
      const server = c.req.param('server');
      const lines = logs
        .all(server)
        .map((entry) => `${JSON.stringify(logEntrySchema.parse(entry))}\n`);
      return c.body(lines.join(''), 200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="mcp-decoy-${server}-logs.jsonl"`,
      });
    });
}
