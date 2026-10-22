import { type LogEntry } from '@/shared/api';
import { useSessions } from '@/ui/api';

import {
  describeCapabilities,
  type Negotiation,
  negotiationOf,
  shortSession,
} from './log-format';

/** Props of `NegotiationCard`. */
export type NegotiationCardProps = {
  /** The session whose negotiation is shown. */
  sessionId: string;
  /** Loaded entries, searched for the `initialize` exchange. */
  entries: LogEntry[];
  /** Server name, for the live sessions fallback. */
  server: string;
};

const SERVER_CAPABILITIES = { tools: { listChanged: true } };

/**
 * What a session's client asked for and what the server answered, from its
 * `initialize` exchange, or from the live session when that exchange is no
 * longer loaded.
 */
export function NegotiationCard({
  sessionId,
  entries,
  server,
}: NegotiationCardProps) {
  const fromLogs = negotiationOf(sessionId, entries);
  const { data: sessions } = useSessions(server, {
    isPaused: () => fromLogs !== null,
  });
  const live = sessions?.find((session) => session.id === sessionId);

  const negotiation: Negotiation | null =
    fromLogs ??
    (live === undefined
      ? null
      : {
          sessionId,
          requestedVersion: live.requestedProtocolVersion,
          agreedVersion: live.protocolVersion,
          client:
            live.clientInfo === null
              ? null
              : `${live.clientInfo.name} ${live.clientInfo.version}`,
          clientCapabilities: live.capabilities,
          serverCapabilities: SERVER_CAPABILITIES,
        });

  const title = (
    <h2 className="m-0 text-[15px] font-semibold">
      Negotiation · session{' '}
      <span className="font-mono" title={sessionId}>
        {shortSession(sessionId)}
      </span>
    </h2>
  );

  if (negotiation === null) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4.5 py-4">
        {title}
        <p className="m-0 text-[13px] text-ink-3">
          The <span className="font-mono">initialize</span> exchange of this
          session isn’t loaded and the session is closed.
        </p>
      </section>
    );
  }

  const agreed =
    negotiation.agreedVersion !== null &&
    negotiation.agreedVersion === negotiation.requestedVersion;
  const badge =
    negotiation.agreedVersion === null ? (
      <Badge tone="error">No answer</Badge>
    ) : agreed ? (
      <Badge tone="success">Agreed</Badge>
    ) : (
      <Badge tone="warning">Server chose another version</Badge>
    );

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4.5 py-4">
      <div className="flex items-center justify-between gap-2">
        {title}
        {badge}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-ink-4 uppercase">
            Client asked
          </span>
          <span className="font-mono text-[13px]">
            {negotiation.requestedVersion ?? '—'}
          </span>
          {negotiation.client !== null && (
            <span className="text-[13px] text-ink">{negotiation.client}</span>
          )}
          <span className="text-[13px] text-ink-2">
            {describeCapabilities(negotiation.clientCapabilities)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-wide text-ink-4 uppercase">
            Server answered
          </span>
          <span className="font-mono text-[13px]">
            {negotiation.agreedVersion ?? '—'}
          </span>
          <span className="text-[13px] text-ink-2">
            {describeCapabilities(negotiation.serverCapabilities)}
          </span>
        </div>
      </div>
    </section>
  );
}

type BadgeProps = {
  tone: 'success' | 'warning' | 'error';
  children: string;
};

const tones: Record<BadgeProps['tone'], string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-out-bg text-out',
  error: 'bg-error-bg text-error',
};

function Badge({ tone, children }: BadgeProps) {
  return (
    <span
      className={`rounded-full px-2 py-0.75 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
