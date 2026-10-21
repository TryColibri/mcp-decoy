import { Link, Outlet } from 'react-router';

import { useInstance } from '@/ui/api';
import { StatusDot } from '@/ui/components/sessions-pill';

/** Every page: the global header above the routed content. */
export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-page text-ink">
      <GlobalHeader />
      <Outlet />
    </div>
  );
}

function GlobalHeader() {
  const { data: instance, error } = useInstance();

  const listening =
    instance === undefined ? null : (
      <>
        <StatusDot live />
        <span>Listening on</span>
        <span className="font-mono text-ink">
          {instance.mcp.host === '127.0.0.1' || instance.mcp.host === '0.0.0.0'
            ? 'localhost'
            : instance.mcp.host}
          :{instance.mcp.port}
        </span>
      </>
    );

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-4 border-b border-line bg-surface px-6 py-3">
      <Link
        to="/"
        className="flex items-center gap-2.5 text-ink no-underline hover:text-ink"
      >
        <LogoMark />
        <span className="text-base font-bold tracking-tight">decoy</span>
        {instance !== undefined && (
          <span className="font-mono text-xs text-ink-4">
            v{instance.version}
          </span>
        )}
      </Link>
      <div className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
        {error === undefined ? (
          listening
        ) : (
          <>
            <StatusDot live={false} />
            <span>decoy is not reachable</span>
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
