import { type ReactNode } from 'react';

/** Props of `Section`. */
export type SectionProps = {
  /** Heading text. */
  title: string;
  /** Short explanation under the heading. */
  children: ReactNode;
  /** Buttons aligned with the heading. */
  actions?: ReactNode;
};

/** A titled block of the Connections tab. */
export function Section({ title, children, actions }: SectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
