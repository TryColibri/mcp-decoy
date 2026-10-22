import { type ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';

import { CopyButton } from '@/ui/components/copy-button';
import { displayEndpoint } from '@/ui/components/endpoint';

/** Props of `EndpointPill`. */
export type EndpointPillProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Full MCP endpoint URL; shown without its scheme, copied as is. */
  url: string;
};

/**
 * A pill showing an MCP endpoint, with a copy button inside it at the top
 * right. `className` is merged over the pill styles; `ref` is the `<span>`.
 */
export function EndpointPill({ url, className, ...props }: EndpointPillProps) {
  return (
    <span
      {...props}
      className={twMerge(
        'inline-flex items-start gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 font-mono text-[13px] text-ink',
        className,
      )}
    >
      <span className="py-0.5">{displayEndpoint(url)}</span>
      <CopyButton text={url} label="Copy endpoint URL" className="size-6" />
    </span>
  );
}
