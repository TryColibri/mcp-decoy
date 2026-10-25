import { CopyButton } from '@/ui/components/copy-button';

import { prettyBody } from './log-format';

/** Props of `BodyView`. */
export type BodyViewProps = {
  /** The body to show; `undefined` means there is none. */
  body: unknown;
  /** Accessible name of the copy button. Default: "Copy body". */
  copyLabel?: string;
};

/**
 * A body in the dark code block with a copy button: text as it is, anything
 * else as pretty JSON.
 */
export function BodyView({ body, copyLabel = 'Copy body' }: BodyViewProps) {
  if (body === undefined) {
    return <p className="m-0 text-sm text-ink-500">No body</p>;
  }
  const text = prettyBody(body);
  return (
    <div className="relative">
      <pre className="m-0 max-h-[70dvh] min-h-24 overflow-auto rounded-lg bg-ink-900 py-4 pr-12 pl-4.5 font-mono text-[12.5px] leading-[1.6] whitespace-pre text-paper-200">
        {text}
      </pre>
      <CopyButton
        text={text}
        label={copyLabel}
        className="absolute top-2 right-2 text-paper-200 hover:bg-ink-700"
      />
    </div>
  );
}
