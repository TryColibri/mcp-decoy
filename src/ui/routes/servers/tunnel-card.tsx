/** Props of `TunnelCard`. */
export type TunnelCardProps = {
  /** Port of the MCP listener, the only one to tunnel. */
  port: number;
};

/** Side card: how to put HTTPS or a public URL in front of the MCP port. */
export function TunnelCard({ port }: TunnelCardProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <h2 className="m-0 text-[15px] font-semibold">
        Need HTTPS or a public URL?
      </h2>
      <p className="m-0 text-[13px] leading-normal text-ink-3">
        decoy runs locally over plain HTTP. Put a tunnel in front of the MCP
        port, then use the tunnel host in place of localhost. Never tunnel the
        UI port.
      </p>
      <div className="overflow-x-auto rounded-lg bg-code px-3.5 py-3 font-mono text-xs leading-[1.7] whitespace-nowrap text-code-ink">
        <div>
          <span className="text-code-dim" aria-hidden="true">
            ${' '}
          </span>
          cloudflared tunnel --url http://localhost:{port}
        </div>
        <div>
          <span className="text-code-dim" aria-hidden="true">
            ${' '}
          </span>
          ngrok http {port}
        </div>
      </div>
    </section>
  );
}
