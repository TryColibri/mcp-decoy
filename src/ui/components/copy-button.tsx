import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { type ComponentProps, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';

/** Props of `CopyButton`. */
export type CopyButtonProps = Omit<
  ComponentProps<'button'>,
  'children' | 'onClick'
> & {
  /** Text put on the clipboard. */
  text: string;
  /** Accessible name, e.g. "Copy endpoint URL". */
  label: string;
};

/**
 * A square icon button that copies `text` and briefly shows a check mark.
 * `className` is merged over the button styles; `ref` is the `<button>`.
 */
export function CopyButton({
  text,
  label,
  className,
  ...props
}: CopyButtonProps) {
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
      {...props}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={copy}
      className={twMerge(
        'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center self-start rounded-md text-ink-700 hover:bg-paper-200 dark:text-ink-200 dark:hover:bg-paper-800',
        className,
      )}
    >
      {copied ? (
        <CheckIcon
          size={14}
          aria-hidden="true"
          className="text-green-700 dark:text-green-400"
        />
      ) : (
        <CopyIcon size={14} aria-hidden="true" />
      )}
    </button>
  );
}
