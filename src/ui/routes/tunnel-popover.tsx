import { Popover } from '@base-ui/react/popover';

import { CopyButton } from '@/ui/components/copy-button';

/** Props of `TunnelPopover`. */
export type TunnelPopoverProps = {
  /** Host of the MCP listener, as a client on this machine reaches it. */
  host: string;
  /** Port of the MCP listener, the only one to tunnel. */
  port: number;
};

/**
 * Header hint link that opens how to put HTTPS or a public URL in front of the
 * MCP port: a single `cloudflared` command, with a copy button.
 */
export function TunnelPopover({ host, port }: TunnelPopoverProps) {
  const command = `cloudflared tunnel --url http://${host}:${port}`;

  return (
    <Popover.Root>
      <Popover.Trigger className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-sans text-[13px] text-ink-600 underline decoration-ink-400 decoration-dotted underline-offset-4 hover:text-ink-900 hover:decoration-ink-900 dark:text-ink-300 dark:decoration-ink-500 dark:hover:text-ink-100 dark:hover:decoration-ink-100">
        Need a public URL?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            aria-label="Tunnel the MCP port"
            className="flex w-120 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-paper-200 bg-white p-5 shadow-xl dark:border-paper-800 dark:bg-paper-900"
          >
            <Popover.Description className="m-0 text-[13px] leading-normal text-ink-600 dark:text-ink-300">
              MCP Decoy serves plain HTTP. Put a tunnel in front of the MCP
              port, for example with{' '}
              <a
                href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/"
                target="_blank"
                rel="noreferrer"
              >
                cloudflared
              </a>
              , then use the tunnel host in place of {host}. Never tunnel the UI
              port.
            </Popover.Description>
            <div className="flex items-start gap-2 rounded-lg bg-ink-900 py-1.5 pr-1.5 pl-3.5 dark:border dark:border-ink-800 dark:bg-ink-950">
              <div className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-xs whitespace-nowrap text-paper-200">
                <span className="text-ink-400" aria-hidden="true">
                  ${' '}
                </span>
                {command}
              </div>
              <CopyButton
                text={command}
                label="Copy tunnel command"
                className="size-7 text-ink-400 hover:bg-white/10 hover:text-paper-200 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-paper-200"
              />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
