import { useServerContext } from '../server-layout';
import { ClientsSection } from './clients-section';
import { OAuthSection } from './oauth-section';
import { TokensSection } from './tokens-section';

/** `/servers/:server/connections`: clients, OAuth settings and tokens. */
export function ConnectionsPage() {
  const { server } = useServerContext();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6">
        <ClientsSection server={server} />
        <OAuthSection server={server} />
        {server.auth.mode === 'oauth' && <TokensSection server={server} />}
      </div>
    </div>
  );
}
