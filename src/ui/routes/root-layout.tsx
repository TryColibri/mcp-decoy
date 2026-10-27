import { Link, Outlet } from 'react-router';

import { useInstance } from '@/ui/api';
import { StatusDot } from '@/ui/components/sessions-pill';
import { ThemeToggle } from '@/ui/theme';

import { TunnelPopover } from './tunnel-popover';

/** Every page: the global header above the routed content. */
export function RootLayout() {
  return (
    <div className="flex h-dvh flex-col bg-paper-50 text-ink-900 dark:bg-paper-950 dark:text-ink-100">
      <GlobalHeader />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

function GlobalHeader() {
  const { data: instance, error } = useInstance();

  const mcpHost =
    instance?.mcp.host === '127.0.0.1' || instance?.mcp.host === '0.0.0.0'
      ? 'localhost'
      : instance?.mcp.host;

  const listening =
    instance === undefined || mcpHost === undefined ? null : (
      <>
        <TunnelPopover host={mcpHost} port={instance.mcp.port} />
        <span
          aria-hidden="true"
          className="mx-2 text-ink-400 dark:text-ink-500"
        >
          ·
        </span>
        <StatusDot live />
        <span>Listening on</span>
        <span className="font-mono text-ink-900 dark:text-ink-100">
          {mcpHost}:{instance.mcp.port}
        </span>
      </>
    );

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-paper-200 bg-white px-6 py-3 dark:border-paper-800 dark:bg-paper-900">
      <Link
        to="/"
        className="flex items-center gap-2.5 text-ink-900 no-underline hover:text-ink-900 dark:text-ink-100 dark:hover:text-ink-100"
      >
        <LogoMark />
        <span className="text-base font-bold tracking-tight">MCP Decoy</span>
        {instance !== undefined && (
          <span className="font-mono text-xs text-ink-500 dark:text-ink-400">
            v{instance.version}
          </span>
        )}
        <ThemeToggle className="ml-3" />
      </Link>
      <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
        {error === undefined ? (
          listening
        ) : (
          <>
            <StatusDot live={false} />
            <span>MCP Decoy is not reachable</span>
          </>
        )}
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}
