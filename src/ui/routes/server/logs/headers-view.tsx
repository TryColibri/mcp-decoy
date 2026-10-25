/** Props of `HeadersView`. */
export type HeadersViewProps = {
  /** The request line (`POST http://…`) or status line (`HTTP 200`). */
  line: string;
  /** Headers, lower-cased names. */
  headers: Record<string, string>;
};

/**
 * The head of an HTTP message like Chrome's Headers panel: the request or
 * status line, then the headers.
 */
export function HeadersView({ line, headers }: HeadersViewProps) {
  const rows = Object.entries(headers).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-mono text-[12.5px] leading-[1.6] font-semibold wrap-anywhere text-ink-900">
        {line}
      </p>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-500">No headers</p>
      ) : (
        <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12.5px] leading-[1.6]">
          {rows.map(([name, value]) => (
            <div key={name} className="col-span-2 grid grid-cols-subgrid">
              <dt className="font-semibold text-ink-700">{name}</dt>
              <dd className="m-0 wrap-anywhere text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
