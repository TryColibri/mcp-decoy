import {
  type HTTPEndFact,
  type HTTPEntry,
  type HTTPFact,
  type LogEntry,
  type LogFact,
  type MCPEntry,
  type MCPFact,
  type NoReplyFact,
} from '@/shared/api';

/**
 * The id of the anchor an attachment belongs to.
 *
 * @param fact - Any fact.
 * @returns The `exchange` of an `http-end`, the `replyTo` of a `no-reply` or
 *   of an `mcp` reply, and `null` for anchors.
 */
export function anchorIdOf(fact: LogFact): number | null {
  switch (fact.type) {
    case 'http':
      return null;
    case 'http-end':
      return fact.exchange;
    case 'mcp':
      return fact.replyTo;
    case 'no-reply':
      return fact.replyTo;
  }
}

/**
 * The facts an entry is made of: the anchor first, then its attachment.
 *
 * @param entry - A reconciled entry.
 */
export function factsOf(entry: LogEntry): LogFact[] {
  if (entry.type === 'http') {
    return entry.end === null ? [entry.exchange] : [entry.exchange, entry.end];
  }
  return entry.reply === null ? [entry.message] : [entry.message, entry.reply];
}

/**
 * Turns an anchor and its attachments into one entry. Attachments of other
 * anchors are ignored, and so are repeated ones: the first of an anchor wins.
 * Pure, so the server (page reads) and the browser (live stream) agree.
 *
 * @param anchor - An `http` fact, or an `mcp` fact without `replyTo`.
 * @param attachments - Facts that may belong to `anchor`.
 * @throws {TypeError} When `anchor` is an attachment.
 */
export function reconcile(
  anchor: LogFact,
  attachments: readonly LogFact[],
): LogEntry {
  if (anchorIdOf(anchor) !== null) {
    throw new TypeError(`Fact ${anchor.id} is an attachment, not an anchor`);
  }
  if (anchor.type === 'http') {
    return reconcileHTTP(anchor, attachments);
  }
  if (anchor.type === 'mcp') {
    return reconcileMCP(anchor, attachments);
  }
  throw new TypeError(`Fact ${anchor.id} is an attachment, not an anchor`);
}

const reconcileHTTP = (
  exchange: HTTPFact,
  attachments: readonly LogFact[],
): HTTPEntry => {
  const end = attachments.find(
    (fact): fact is HTTPEndFact =>
      fact.type === 'http-end' && fact.exchange === exchange.id,
  );
  const stream = exchange.response?.stream === true;
  let state: HTTPEntry['state'] = 'complete';
  if (exchange.response === null) {
    state = 'aborted';
  } else if (end !== undefined) {
    state = end.state;
  } else if (stream) {
    state = 'streaming';
  }
  return {
    type: 'http',
    id: exchange.id,
    exchange,
    end: end ?? null,
    state,
    durationMs: end?.durationMs ?? (stream ? null : exchange.durationMs),
  };
};

const reconcileMCP = (
  message: MCPFact,
  attachments: readonly LogFact[],
): MCPEntry => {
  const reply =
    message.kind === 'request'
      ? attachments.find(
          (fact): fact is MCPFact | NoReplyFact =>
            (fact.type === 'mcp' || fact.type === 'no-reply') &&
            fact.replyTo === message.id,
        )
      : undefined;
  let state: MCPEntry['state'] = 'complete';
  if (message.kind === 'request') {
    if (reply === undefined) {
      state = 'pending';
    } else if (reply.type === 'no-reply') {
      state = 'aborted';
    }
  }
  return {
    type: 'mcp',
    id: message.id,
    message,
    reply: reply ?? null,
    state,
    durationMs: reply?.type === 'mcp' ? reply.durationMs : null,
  };
};
