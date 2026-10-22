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
      <Popover.Trigger className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-sans text-[13px] text-ink-3 underline decoration-ink-faint decoration-dotted underline-offset-4 hover:text-ink hover:decoration-ink">
        Need a public URL?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            aria-label="Tunnel the MCP port"
            className="flex w-[480px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
          >
            <Popover.Description className="m-0 text-[13px] leading-normal text-ink-3">
              decoy serves plain HTTP. Put a tunnel in front of the MCP port,
              for example with{' '}
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
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-code px-3.5 py-3 font-mono text-xs whitespace-nowrap text-code-ink">
                <span className="text-code-dim" aria-hidden="true">
                  ${' '}
                </span>
                {command}
              </div>
              <CopyButton text={command} label="Copy tunnel command" />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
