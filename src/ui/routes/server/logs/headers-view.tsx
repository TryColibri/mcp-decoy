import { tw } from '@/ui/tw';

/** Props of `HeadersView`. */
export type HeadersViewProps = {
  /** The request line (`POST http://…`) or status line (`HTTP 200`). */
  line: string;
  /** Headers, lower-cased names. */
  headers: Record<string, string>;
  /** Decoded query parameters, shown before the headers when not empty. */
  query?: Array<[name: string, value: string]>;
};

const titleClasses = tw`m-0 mt-4 text-xs font-semibold tracking-wide text-ink-500 uppercase`;
const listClasses = tw`m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12.5px] leading-[1.6]`;

/**
 * The head of an HTTP message like Chrome's Headers panel: the request or
 * status line, the query parameters, then the headers.
 */
export function HeadersView({ line, headers, query = [] }: HeadersViewProps) {
  const rows = Object.entries(headers).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-mono text-[12.5px] leading-[1.6] font-semibold wrap-anywhere text-ink-900">
        {line}
      </p>
      {query.length > 0 && (
        <>
          <h3 className={titleClasses}>Query parameters</h3>
          <dl className={listClasses}>
            {query.map(([name, value], index) => (
              <div
                key={`${index}:${name}`}
                className="col-span-2 grid grid-cols-subgrid"
              >
                <dt className="font-semibold text-ink-700">{name}</dt>
                <dd className="m-0 wrap-anywhere text-ink-900">{value}</dd>
              </div>
            ))}
          </dl>
          <h3 className={titleClasses}>Headers</h3>
        </>
      )}
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-500">No headers</p>
      ) : (
        <dl className={listClasses}>
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
