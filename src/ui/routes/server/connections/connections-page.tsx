import { useServerContext } from '../server-layout';
import { OAuthSection } from './oauth-section';
import { SessionsSection } from './sessions-section';
import { TokensSection } from './tokens-section';

/** `/servers/:server/connections`: live sessions, OAuth settings and tokens. */
export function ConnectionsPage() {
  const { server } = useServerContext();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6">
        <SessionsSection server={server} />
        <OAuthSection server={server} />
        {server.auth.mode === 'oauth' && <TokensSection server={server} />}
      </div>
    </div>
  );
}
