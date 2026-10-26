/** One event block of a `text/event-stream` body. */
export type SSEEvent = {
  /** The `id` field, or `null` when the block has none. */
  id: string | null;
  /** The `event` field, or `null` when the block has none. */
  event: string | null;
  /** The `data` lines joined with `\n`, or `null` when the block has no `data` field. */
  data: string | null;
};

/** Incremental parser of a `text/event-stream` body. */
export type SSEParser = {
  /**
   * Feeds the next chunk of text, which may end anywhere, even between the
   * `\r` and `\n` of a line break.
   *
   * @param chunk - Decoded text of the body.
   * @returns The events the chunk completed. A block with at least one field
   *   is an event, even without `data`, such as a priming event. A block of
   *   comments only, such as `: keepalive`, is not.
   */
  feed(chunk: string): SSEEvent[];
};

const lineBreak = /[\r\n]/g;

/** Creates a parser for one event stream. */
export function createSSEParser(): SSEParser {
  // The line being read when a chunk ended.
  let partial = '';
  // A chunk ended on `\r`: a leading `\n` of the next one belongs to it.
  let skipLineFeed = false;
  let id: string | null = null;
  let event: string | null = null;
  let data: string[] = [];
  let fields = 0;

  const line = (text: string, events: SSEEvent[]) => {
    if (text === '') {
      if (fields > 0) {
        events.push({
          id,
          event,
          data: data.length === 0 ? null : data.join('\n'),
        });
      }
      id = null;
      event = null;
      data = [];
      fields = 0;
      return;
    }
    if (text.startsWith(':')) {
      return;
    }
    const colon = text.indexOf(':');
    const name = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    fields++;
    if (name === 'id') {
      id = value;
    } else if (name === 'event') {
      event = value;
    } else if (name === 'data') {
      data.push(value);
    }
  };

  return {
    feed(chunk) {
      const events: SSEEvent[] = [];
      let text = partial + chunk;
      partial = '';
      if (skipLineFeed && text !== '') {
        skipLineFeed = false;
        if (text.startsWith('\n')) {
          text = text.slice(1);
        }
      }
      let start = 0;
      for (;;) {
        lineBreak.lastIndex = start;
        const found = lineBreak.exec(text);
        if (found === null) {
          partial = text.slice(start);
          return events;
        }
        const terminator = found.index;
        line(text.slice(start, terminator), events);
        start = terminator + 1;
        if (text[terminator] === '\r') {
          if (start === text.length) {
            skipLineFeed = true;
          } else if (text[start] === '\n') {
            start++;
          }
        }
      }
    },
  };
}
