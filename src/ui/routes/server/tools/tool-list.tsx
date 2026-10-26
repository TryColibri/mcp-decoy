import { PlusIcon } from '@phosphor-icons/react';
import { twMerge } from 'tailwind-merge';

import { type Tool } from '@/shared/api';

/** Props of `ToolList`. */
export type ToolListProps = {
  /** Tools of the server, drafts included. */
  tools: Tool[];
  /** Name of the selected tool. */
  selected: string | null;
  /** Whether a new tool is being created. */
  creating: boolean;
  /** Why creating the last tool failed. */
  createError: string | null;
  /** Called when a tool row is clicked. */
  onSelect: (name: string) => void;
  /** Called when New is clicked. */
  onCreate: () => void;
};

/** Left column of the Tools tab: tool rows and the New button. */
export function ToolList({
  tools,
  selected,
  creating,
  createError,
  onSelect,
  onCreate,
}: ToolListProps) {
  return (
    <aside
      aria-label="Tools on this server"
      className="box-border flex w-full flex-col gap-3.5 border-r border-paper-200 bg-white px-4 py-5 md:w-75 md:shrink-0 md:overflow-y-auto dark:border-paper-800 dark:bg-paper-900"
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-xs font-semibold tracking-wide text-ink-500 uppercase dark:text-ink-400">
          Tools · {tools.length}
        </h2>
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-paper-300 bg-white px-2.5 text-[13px] font-semibold text-ink-900 hover:bg-paper-200 disabled:cursor-wait dark:border-paper-700 dark:bg-paper-900 dark:text-ink-100 dark:hover:bg-paper-800"
        >
          <PlusIcon size={14} weight="bold" aria-hidden="true" />
          New
        </button>
      </div>
      {createError !== null && (
        <p
          role="alert"
          className="m-0 text-[13px] text-red-800 dark:text-red-400"
        >
          {createError}
        </p>
      )}
      {tools.length === 0 && (
        <div className="flex flex-col items-start gap-2 px-1">
          <h3 className="m-0 text-base font-semibold">No tools yet</h3>
          <p className="m-0 text-sm/relaxed text-ink-600 dark:text-ink-300">
            A new tool starts as a draft: clients only see it once you publish
            it, and connected sessions are notified right away.
          </p>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-paper-300 bg-white px-2.5 text-[13px] font-semibold text-ink-900 hover:bg-paper-200 disabled:cursor-wait dark:border-paper-700 dark:bg-paper-900 dark:text-ink-100 dark:hover:bg-paper-800"
          >
            <PlusIcon size={14} weight="bold" aria-hidden="true" />
            New tool
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {tools.map((tool) => {
          const active = tool.name === selected;
          return (
            <button
              key={tool.name}
              type="button"
              onClick={() => {
                onSelect(tool.name);
              }}
              aria-pressed={active}
              className={twMerge(
                'flex min-h-13 w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left font-sans',
                active
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950'
                  : 'border-transparent bg-white hover:bg-blue-50/50 dark:bg-paper-900 dark:hover:bg-blue-950/50',
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="font-mono text-[13px] font-medium break-all text-ink-900 dark:text-ink-100">
                  {tool.name}
                </span>
                {!tool.published && (
                  <span className="ml-auto rounded-sm bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                    Draft
                  </span>
                )}
              </span>
              <span className="text-xs text-ink-500 dark:text-ink-400">
                {tool.description === '' ? 'No description' : tool.description}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-auto rounded-lg bg-paper-100 p-3 text-xs/normal text-ink-700 dark:bg-paper-800 dark:text-ink-200">
        Server capability <span className="font-mono">tools.listChanged</span>{' '}
        is <strong>on</strong>. Clients get{' '}
        <span className="font-mono">notifications/tools/list_changed</span>{' '}
        whenever this list changes.
      </div>
    </aside>
  );
}
