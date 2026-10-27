import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useSWRConfig } from 'swr';

import { type Tool } from '@/shared/api';
import { client, keys, unwrap, useTools } from '@/ui/api';
import { ButtonLink } from '@/ui/components/button';

import { useServerContext } from '../server-layout';
import { ToolEditor } from './tool-editor';
import { ToolList } from './tool-list';

/**
 * `/servers/:server/tools/:tool?`: the tool list and the editor of `:tool`.
 * Without `:tool` it redirects to the first tool; an unknown `:tool` is a 404.
 */
export function ToolsPage() {
  const { server } = useServerContext();
  const { data: tools, error } = useTools(server.name);
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const { tool: requested } = useParams();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const toolsPath = `/servers/${server.name}/tools`;
  const select = (name: string | null) => {
    void navigate(name === null ? toolsPath : `${toolsPath}/${name}`, {
      replace: true,
    });
  };

  const selected: Tool | undefined = tools?.find(
    (tool) => tool.name === requested,
  );

  const refresh = async () => {
    await Promise.all([
      mutate(keys.tools(server.name)),
      mutate(keys.server(server.name)),
      mutate(keys.servers),
    ]);
  };

  /**
   * Updates the cached tool list before the URL changes, so the route never
   * points at a tool the list doesn't have yet.
   */
  const patchTools = (update: (current: Tool[]) => Tool[]) =>
    mutate(
      keys.tools(server.name),
      (current: Tool[] | undefined) =>
        current === undefined ? current : update(current),
      { revalidate: false },
    );

  const createTool = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await unwrap(
        client.servers[':server'].tools.$post({
          param: { server: server.name },
          json: { name: nextToolName(tools ?? []) },
        }),
      );
      await refresh();
      select(created.name);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  if (error !== undefined) {
    return (
      <p
        role="alert"
        className="m-0 p-6 text-sm text-red-800 dark:text-red-400"
      >
        Could not load tools: {error.message}
      </p>
    );
  }

  if (tools !== undefined && requested === undefined && tools.length > 0) {
    return <Navigate to={`${toolsPath}/${tools[0].name}`} replace />;
  }

  let editor;
  if (tools === undefined) {
    editor = (
      <p className="m-0 p-8 text-sm text-ink-500 dark:text-ink-400">
        Loading tools…
      </p>
    );
  } else if (requested !== undefined && selected === undefined) {
    editor = <ToolNotFound name={requested} toolsPath={toolsPath} />;
  } else if (selected === undefined) {
    editor = null;
  } else {
    editor = (
      <ToolEditor
        key={`${selected.name}@${selected.updatedAt}`}
        server={server}
        tool={selected}
        onSaved={async (saved) => {
          await patchTools((current) =>
            current.map((tool) => (tool.name === selected.name ? saved : tool)),
          );
          select(saved.name);
          await refresh();
        }}
        onDeleted={async () => {
          await patchTools((current) =>
            current.filter((tool) => tool.name !== selected.name),
          );
          select(null);
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <ToolList
        tools={tools ?? []}
        selected={selected?.name ?? null}
        creating={creating}
        createError={createError}
        onSelect={select}
        onCreate={createTool}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{editor}</main>
    </div>
  );
}

const nextToolName = (tools: Tool[]): string => {
  const taken = new Set(tools.map((tool) => tool.name));
  let name = 'new_tool';
  for (let index = 2; taken.has(name); index++) {
    name = `new_tool_${index}`;
  }
  return name;
};

type ToolNotFoundProps = {
  name: string;
  toolsPath: string;
};

function ToolNotFound({ name, toolsPath }: ToolNotFoundProps) {
  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <h2 className="m-0 text-[22px] font-bold tracking-tight">
        Tool not found
      </h2>
      <p className="m-0 text-[15px] text-ink-600 dark:text-ink-300">
        This server has no tool named <span className="font-mono">{name}</span>.
        It may have been deleted or renamed.
      </p>
      <ButtonLink to={toolsPath} variant="primary">
        Back to tools
      </ButtonLink>
    </div>
  );
}
