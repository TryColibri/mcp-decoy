import { CodeEditor, type CodeEditorMode } from '@/ui/components/code-editor';
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
 * A body in a read-only code block with a copy button: text as it is,
 * anything else as pretty JSON. A body that parses as JSON is colored and can
 * be folded.
 */
export function BodyView({ body, copyLabel = 'Copy body' }: BodyViewProps) {
  if (body === undefined) {
    return (
      <p className="m-0 text-sm text-ink-500 dark:text-ink-400">No body</p>
    );
  }
  const text = prettyBody(body);
  const mode = modeOf(body, text);
  return (
    <div className="relative rounded-lg border border-paper-200 bg-paper-50 dark:border-paper-800 dark:bg-paper-950">
      <CodeEditor
        readOnly
        autoHeight
        mode={mode}
        value={text}
        aria-label={copyLabel.replace(/^Copy /, '')}
        className="rounded-lg"
      />
      <CopyButton
        text={text}
        label={copyLabel}
        className="absolute top-2 right-2 bg-paper-50/80 text-ink-600 hover:bg-paper-200 dark:bg-paper-950/80 dark:text-ink-300 dark:hover:bg-paper-800"
      />
    </div>
  );
}

/** Anything but a string is shown as JSON; a string only if it parses. */
const modeOf = (body: unknown, text: string): CodeEditorMode => {
  if (typeof body !== 'string') {
    return 'json';
  }
  try {
    JSON.parse(text);
    return 'json';
  } catch {
    return 'text';
  }
};
