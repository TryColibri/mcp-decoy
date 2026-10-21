import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Props of `CopyButton`. */
export type CopyButtonProps = {
  /** Text put on the clipboard. */
  text: string;
  /** Accessible name, e.g. "Copy endpoint URL". */
  label: string;
};

/** A square icon button that copies `text` and briefly shows a check mark. */
export function CopyButton({ text, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={copy}
      className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:bg-hover"
    >
      {copied ? (
        <CheckIcon size={14} aria-hidden="true" className="text-live" />
      ) : (
        <CopyIcon size={14} aria-hidden="true" />
      )}
    </button>
  );
}
