import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSWRConfig } from 'swr';

import { type Tool } from '@/shared/api';
import { client, keys, unwrap, useTools } from '@/ui/api';

import { useServerContext } from '../server-layout';
import { ToolEditor } from './tool-editor';
import { ToolList } from './tool-list';

/** `/servers/:server/tools`: the tool list and the editor of `?tool=`. */
export function ToolsPage() {
  const { server } = useServerContext();
  const { data: tools, error } = useTools(server.name);
  const { mutate } = useSWRConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const select = (name: string | null) => {
    setSearchParams(name === null ? {} : { tool: name }, { replace: true });
  };

  const requested = searchParams.get('tool');
  const selected: Tool | undefined =
    tools?.find((tool) => tool.name === requested) ?? tools?.[0];

  const refresh = async () => {
    await Promise.all([
      mutate(keys.tools(server.name)),
      mutate(keys.server(server.name)),
      mutate(keys.servers),
    ]);
  };

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
      <p role="alert" className="m-0 p-6 text-sm text-error">
        Could not load tools: {error.message}
      </p>
    );
  }

  let editor;
  if (tools === undefined) {
    editor = <p className="m-0 p-8 text-sm text-ink-4">Loading tools…</p>;
  } else if (selected === undefined) {
    editor = null;
  } else {
    editor = (
      <ToolEditor
        key={`${selected.name}@${selected.updatedAt}`}
        server={server}
        tool={selected}
        onSaved={async (saved) => {
          await refresh();
          select(saved.name);
        }}
        onDeleted={async () => {
          await refresh();
          select(null);
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
