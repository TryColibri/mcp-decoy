import { ButtonLink } from '@/ui/components/button';

/** Any URL the SPA doesn't know. */
export function NotFoundPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-6 py-16">
      <h1 className="m-0 text-[28px] font-bold tracking-tight">
        Page not found
      </h1>
      <p className="m-0 text-[15px] text-ink-3">
        There is nothing at this address.
      </p>
      <ButtonLink to="/" variant="primary">
        Back to servers
      </ButtonLink>
    </main>
  );
}
