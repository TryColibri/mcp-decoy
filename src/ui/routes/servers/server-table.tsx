import { Link } from 'react-router';

import { type ServerSummary } from '@/shared/api';
import { EndpointPill } from '@/ui/components/endpoint-pill';
import { SessionsPill, StatusDot } from '@/ui/components/sessions-pill';
import { tw } from '@/ui/tw';

/** Props of `ServerTable`. */
export type ServerTableProps = {
  /** Servers to list, in display order. */
  servers: ServerSummary[];
};

const th = tw`border-b border-line px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-ink-4 uppercase`;
const td = tw`border-b border-line-soft px-4 py-3.5 align-middle text-sm whitespace-nowrap`;

/** The servers table: name, endpoint, exposed tools, sessions, links. */
export function ServerTable({ servers }: ServerTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th} scope="col">
              Name
            </th>
            <th className={th} scope="col">
              Endpoint
            </th>
            <th className={th} scope="col">
              Exposes
            </th>
            <th className={th} scope="col">
              Sessions
            </th>
            <th className={th} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <ServerRow key={server.name} server={server} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ServerRowProps = {
  server: ServerSummary;
};

function ServerRow({ server }: ServerRowProps) {
  const base = `/servers/${server.name}`;
  return (
    <tr>
      <td className={td}>
        <div className="flex items-center gap-2.5">
          <StatusDot live={server.sessionCount > 0} />
          <Link to={`${base}/logs`} className="font-semibold text-ink">
            {server.name}
          </Link>
        </div>
      </td>
      <td className={td}>
        <EndpointPill url={server.mcpUrl} />
      </td>
      <td className={`${td} text-ink-2`}>{describeTools(server)}</td>
      <td className={td}>
        <SessionsPill count={server.sessionCount} />
      </td>
      <td className={`${td} text-right`}>
        <div className="inline-flex gap-2">
          <Link
            to={`${base}/logs`}
            className="px-2.5 py-2 text-[13px] font-medium no-underline"
          >
            Logs
          </Link>
          <Link
            to={`${base}/tools`}
            className="px-2.5 py-2 text-[13px] font-medium no-underline"
          >
            Tools
          </Link>
        </div>
      </td>
    </tr>
  );
}

const describeTools = ({
  publishedToolCount: published,
  toolCount,
}: ServerSummary): string => {
  const drafts = toolCount - published;
  const tools =
    published === 0
      ? 'No tools'
      : `${published} ${published === 1 ? 'tool' : 'tools'}`;
  return drafts === 0
    ? tools
    : `${tools} · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}`;
};
