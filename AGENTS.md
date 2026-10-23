# MCP Decoy

MCP Decoy is a local tool for debugging MCP **clients**. It is the mirror image
of the MCP Inspector: a configurable mock MCP server that your client connects
to, with a web UI to define tools live and watch every JSON-RPC message.

The original implementation brief is in `docs/SPEC.md` and the approved UI
mockups are in `docs/design/`. Read the brief before changing behavior: its
decisions are settled.

---

# Tech stack

| Concern         | Choice                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Shape           | **One** Node.js process running **two Hono apps** with `@hono/node-server`, plus a **Vite + React 19 + TypeScript SPA**         |
| Ports           | MCP listener on `6280` (`--host`, default `127.0.0.1`). UI listener on `6281`, always bound to `127.0.0.1` (API + built SPA)    |
| MCP library     | Official TypeScript SDK v2 (`@modelcontextprotocol/server`), **low-level `Server`**, `WebStandardStreamableHTTPServerTransport` |
| Transport       | Streamable HTTP only, stateful (`Mcp-Session-Id`), one SDK `Server` + one transport per session                                 |
| Capabilities    | Every mock server advertises only `tools: { listChanged: true }`                                                                |
| Persistence     | `servers.json` in the config directory (XDG: `~/.config/decoy`, `--config-dir`). Logs in memory only                            |
| Tool responses  | Always a **json-e** template, wrapped in `src/server/templates/`                                                                |
| API             | Public REST API under `/api/v1`, Zod schemas in `src/shared/api/` as the contract, `@hono/zod-validator`, RFC 9457 errors       |
| API client      | Hono's typed client (`hc`) in `src/shared/client/`                                                                              |
| Live logs       | SSE (`streamSSE` from `hono/streaming`)                                                                                         |
| SPA routing     | **React Router** as a client-side library (declarative mode). No framework mode, no SSR                                         |
| SPA data        | **`useSWR`** for reads; mutations with the typed client followed by SWR `mutate`                                                |
| Styling         | Tailwind CSS v4 (`@tailwindcss/vite`) utility classes, `@theme` tokens in `src/ui/styles.css`                                   |
| UI primitives   | **Base UI** (`@base-ui/react`) for dialogs, tooltips, checkboxes, …                                                             |
| Icons and fonts | `@phosphor-icons/react`; `@fontsource/geist` and `@fontsource/geist-mono` (bundled, works offline)                              |
| CLI             | Bombshell: `@bomb.sh/args` for flags, `@clack/prompts` for terminal output                                                      |
| Bundling        | `vite build` → `dist/ui/`, `tsdown` → `dist/cli.js`                                                                             |
| Package manager | pnpm — always use `pnpm add`/`pnpm remove`, never edit dependencies in `package.json` directly. Exact versions                  |
| Test runner     | Vitest (projects: `node` for server and shared, `jsdom` for UI)                                                                 |
| Formatter       | oxfmt — `pnpm format:fix` to auto-format (or `pnpm fix` to format and lint together)                                            |
| Lint            | oxlint (type-aware via `oxlint-tsgolint`) — `pnpm lint` runs oxlint only; formatting is checked separately via `pnpm format`    |
| Typecheck       | TypeScript 7, `tsc -b` over `tsconfig.server.json`, `tsconfig.ui.json` and `tsconfig.node.json`                                 |
| Node            | `.nvmrc`; `engines.node` is `>=24`                                                                                              |

TypeScript 7 ships no editor plugin API. Install the dedicated **TypeScript 7**
extension (`TypeScriptTeam.native-preview`, recommended in
`.vscode/extensions.json`) for editor language support.

## Rules agents tend to break

- **Never use any TanStack package** (Query, Router, Table, …). Reads go through
  `useSWR`; routing through React Router.
- **Never use Commander** (or yargs, meow, …). Flags are parsed with
  `@bomb.sh/args` and validated with Zod.
- **No shadcn.** Interactive primitives come from Base UI, styled with Tailwind
  utility classes inline. No component library on top.
- **No Next.js, no React Router framework mode, no SSR.** The SPA is static
  files served by the UI listener.
- **No OpenAPI.** The Zod schemas in `src/shared/api/` are the contract.
- `src/ui/**` never imports `src/server/**`. `src/shared/**` imports nothing
  from either, except `src/shared/client/`, which may `import type` from
  `src/server/api/`. The oxlint config enforces this.
- Server runtime packages go in `dependencies`; everything compiled into
  `dist/ui` (React, Router, SWR, Base UI, Tailwind, fonts, icons) is a
  `devDependency`.

---

# CI/CD philosophy

1. CI calls `package.json` scripts and may only extend them with flags. If a
   check needs different behavior, change the script, not the workflow. This is
   what keeps a green local run meaning the same thing as a green CI run.
2. Releases are automated, from commits to `main`. Pull request titles must be
   Conventional Commits (`pr-title.yml`), because the squashed title becomes the
   commit. After the checks pass, `release.yml` runs semantic-release, which
   bumps `package.json`, commits and tags it. `publish.yml` then publishes that
   tag to npm. The package must stay releasable as is: after `pnpm build`,
   `npx .` (or `npx ./hodor-ai-mcp-decoy-<version>.tgz` from `pnpm pack`) starts
   everything with one command.
3. Unit tests must not depend on ambient environment (ports, home directory,
   config directory). Tests that need a config directory create a temp one.

---

# Architecture

## Runtime

```
npx @hodor-ai/mcp-decoy
  └─ node dist/cli.js                                   (one process)
       ├─ :6280  mcpApp (Hono)   /s/:server/mcp          ← MCP clients, tunnels
       └─ :6281  uiApp  (Hono)   /api/v1/*   → services   ← browser, 127.0.0.1 only
                                 /assets/*   → dist/ui/assets
                                 /*          → dist/ui/index.html (SPA fallback)

       both apps ──▶ services (servers, tools, logs, mcp sessions)
                       │            │
                  event bus    <config dir>/servers.json
```

- There are only two listeners. Vite runs only in development (`pnpm dev`: Vite
  on 5173 proxies `/api` to 6281).
- State is ordinary module instances wired once in `src/server/main.ts` and
  passed to the apps. No `globalThis` registry, no environment-variable handoff.
- The UI listener rejects any `Host` other than `localhost:<uiPort>` or
  `127.0.0.1:<uiPort>` (DNS rebinding) and requires JSON plus a matching
  `Origin` (when present) on mutating requests (CSRF).
- The MCP listener allows any origin (CORS) because it only serves mock data.
- The CSRF check requires `Content-Type: application/json` on POST, PUT and
  PATCH. DELETE has no body and always needs a CORS preflight cross-origin, so
  only its `Origin` is checked; `curl -X DELETE` works without headers.
- Sessions are stateful 2025-era Streamable HTTP (`initialize`,
  `Mcp-Session-Id`). The MCP SDK v2 also implements the stateless 2026-07-28
  revision; clients that probe it with `server/discover` get a 400 and fall back
  to `initialize` (covered by `mcp-app.integration.test.ts`). The session ID is
  generated before the `initialize` request is handed to the transport, so that
  request is logged under the session it opens.
- `<config dir>/runtime.json` advertises a running instance to future CLI
  subcommands and the TUI, and prevents two instances from sharing a config
  directory.

## Layering

API handlers are a thin HTTP shell: **validate → call one service function →
serialize**. All behavior lives in services so other front-ends (CLI
subcommands, TUI) can reuse it.

- **Services** (`src/server/servers/`, `tools/`, `logs/`, `mcp/`) take plain
  typed inputs, return typed values and throw domain errors from
  `src/server/errors.ts` (`NotFoundError`, `ConflictError`, `ValidationError`
  with field paths). They know nothing about Hono, HTTP or status codes.
- **One `app.onError`** on the API maps domain errors to 404/409/422 as
  `application/problem+json`. Validation failures from `@hono/zod-validator` use
  the same shape.
- **Mutations emit events** on the typed event bus (`src/server/events.ts`). The
  MCP layer subscribes (for example, to send
  `notifications/tools/list_changed`). Services never call the MCP layer.

## Code layout

```
src/
  shared/
    api/              # Zod schemas + types for API bodies, grouped by resource
    client/           # createDecoyClient(baseUrl), built on hc<ApiV1>
  server/
    cli.ts            # bin entry: parse flags, print banner, call main.start()
    main.ts           # start(options) → { close() }
    mcp-app.ts        # Hono app for /s/:server/mcp
    ui-app.ts         # Hono app: middleware, /api/v1, static + SPA fallback
    api/              # /api/v1 route modules per resource, problem+json
    servers/ tools/ templates/ logs/ mcp/ config/ runtime/
    events.ts, errors.ts
  ui/
    index.html, main.tsx, styles.css
    api.ts            # SWR fetcher + ApiError, built on the shared client
    routes/           # one directory per route; components colocated
    components/       # shared only when used by 2+ unrelated routes
```

Hono's typed client infers types only from **chained** route definitions. Write
route modules as one chain and export the app type (`type ApiV1`).

## `src/shared/api/` — wire-format layer

Modules under `src/shared/api/` own the Zod schemas and TypeScript types for
HTTP request and response bodies. They contain **no server-only imports, no
business logic, and no HTTP concerns** — making them safe to import from
anywhere, including the SPA.

**Grouping rule:** organise by the **resource** a schema affects (`servers`,
`tools`, `sessions`, `logs`, `problems`), not by route path.

**Import rule:** the SPA **never** imports from `src/server/`; it imports
wire-format types from `src/shared/api/`.

**Import rule:** handlers import their own schemas from `src/shared/api/`, not
the other way around.

**What stays in the handler:** cursor codecs (`encodeCursor` / `decodeCursor`),
query/path param parsing, status codes and headers.

**Type authoring rule:** define types explicitly with JSDoc; type schemas as
`z.ZodType<T>` so TypeScript enforces the schema matches the type; use
`z.strictObject` instead of `z.object` for all object schemas; match
`.describe()` strings to the JSDoc property comments.

Example:

```ts
// src/shared/api/servers.ts

/** Summary of a server as returned by `GET /api/v1/servers`. */
export type ServerSummary = {
  /** URL slug of the server. */
  name: string;
  /** Number of live MCP sessions. */
  sessionCount: number;
};

export const serverSummarySchema: z.ZodType<ServerSummary> = z.strictObject({
  name: z.string().describe('URL slug of the server.'),
  sessionCount: z.number().int().describe('Number of live MCP sessions.'),
});

// src/server/api/servers.ts (handler)
import { serverSummarySchema } from '@/shared/api';
// src/ui/routes/servers/servers-page.tsx
import { type ServerSummary } from '@/shared/api';
```

## Multi-file modules export through a barrel

When a module spans multiple files, expose its public API through a single
barrel. Consumers import from the module directory, not from internal files.

```ts
// correct
import { createLogStore, type LogStore } from '@/server/logs';
// incorrect — leaks internal file structure to consumers
import { createRingBufferLogStore } from '@/server/logs/ring-buffer';
```

The barrel re-exports only what is part of the module's public contract.
Internal helpers that are not meant for outside use are not re-exported.

## File colocation in `src/ui/routes/`

Route-specific components and hooks live directly in the route directory
alongside the route's page component — no `_components/` subdirectory.

```
src/ui/routes/server/logs/
├── logs-page.tsx          ← route entry point
├── message-list.tsx       ← colocated
├── negotiation-card.tsx   ← colocated
└── use-log-stream.ts      ← colocated hook
```

Move a file to `src/ui/components/` only when it is used by two or more
unrelated routes. Do not create intermediate shared directories.

## Testing

Tests live alongside the source files they exercise. A module
`src/server/foo/bar.ts` has its unit tests in `src/server/foo/bar.test.ts` and
its integration tests in `src/server/foo/bar.integration.test.ts`.

Two test types, each with a different mocking contract:

- **Unit tests** — test a single module in isolation. Mock every import from
  outside the module under test using `vi.mock()`, `vi.fn()`.
- **Integration tests** — test a module with its real collaborators. Mock only
  externalities: network calls, the file system (use a temp directory), and
  third-party APIs. API integration tests use `uiApp.request()` (no sockets) and
  validate every response body against its schema in `src/shared/api/`.

---

# Coding standards

## Guiding principle

> Clear is better than clever.
>
> — Rob Pike, Go Proverbs

## Naming conventions

### Boolean variables

Use adjective-based names for `boolean` variables, not verb-based.

```ts
// correct
const hidden = true;
const outdated = false;
const closing = true;

// incorrect
const isHidden = true;
const shouldUpdate = false;
const willClose = true;
```

### Acronyms in camelCase and PascalCase

Put acronyms in all uppercase, except when the acronym starts a camelCase name.

```ts
// camelCase
(url, urlError, handleURL, encodeURLComponent, jsonSchema, parseYAML);

// PascalCase
(URL, URLHandler, EncryptedURL, JSONSchema, YAMLParser);

// incorrect
(handleUrl, createUrlHandler, JsonSchema, YamlParser);
```

## Functions

### Closures

When defining a closure inside a function body, prefer assigning an arrow
function to a `const` variable over a nested `function` declaration.

An inline arrow callback is fine when the whole callback is three lines or fewer
(counting the line that contains `=>` and any continuation lines), for example
in `filter`, `map`, `reduce`, or Vitest `expect` helpers. If it grows past that,
assign it to a `const` (or extract a named function) instead of inlining.

```ts
// correct — short enough to inline
function processItems(items: string[]) {
  return items.map((item: string) => item.trim().toLowerCase());
}

// correct — named when you want a stable reference or clearer call site
function processItems(items: string[]) {
  const format = (item: string) => item.trim().toLowerCase();
  return items.map(format);
}

// incorrect — nested function declaration
function processItems(items: string[]) {
  function format(item: string) {
    return item.trim().toLowerCase();
  }
  return items.map(format);
}
```

### Arguments & return types

When a function takes or returns an object, define it as a named type rather
than inlining the shape at the call site. Named types are easier to document,
reuse, and refactor.

```ts
// correct
type CreateUserParams = {
  name: string;
  email: string;
  role: "admin" | "student";
};

type CreateUserResult = {
  id: string;
  createdAt: Date;
};

function createUser(params: CreateUserParams): CreateUserResult { ... }

// incorrect
function createUser(params: {
  name: string;
  email: string;
  role: "admin" | "student";
}): { id: string; createdAt: Date } { ... }
```

Destructure object parameters in the function signature, not the body.

```ts
// correct
function createUser({ name, email, role }: CreateUserParams): CreateUserResult { ... }

// incorrect
function createUser(params: CreateUserParams): CreateUserResult {
  const { name, email, role } = params;
  ...
}
```

## Component composition

When a component accepts content that ends up in the DOM, accept it as
**children** (or as a named-slot subcomponent), not as a string prop. String
props that render into DOM elements are a leaky interface — the parent ends up
reaching across the primitive to customize a grandchild's text, icon, or class.

```tsx
// incorrect — leaky string props
<Button label="Start journey" icon={ArrowRightIcon} onClick={…} />
<Header title="Limits and continuity" />

// correct — children-based composition
<Button onClick={…}>
  <ArrowRightIcon size={15} weight="bold" />
  {t('startJourney')}
</Button>

<ChatPageShell.Header>
  <Title>{chapter.title}</Title>
</ChatPageShell.Header>
```

When composition gets complex enough to warrant explicit slots, use the
**named-slot subcomponent pattern**:

```tsx
<Shell>
  <Shell.Header>…</Shell.Header>
  <Shell.Sidebar>…</Shell.Sidebar>
  <Shell.Content>…</Shell.Content>
</Shell>
```

Slots are exposed as static properties on the parent (e.g.
`Shell.Header = function ShellHeader(…)`), and the parent inspects its children
— or simply renders the subcomponents in fixed positions — to lay them out.

Data-driven props are still fine where the content is intrinsically structured
(e.g. a list of chapters, a table of rows). Rendering each item via `children`
would push every caller into hand-rolling the same item markup, which is the
duplication this rule exists to prevent.

## Reusable components

Every reusable component (anything in `src/ui/components/`) must:

- accept `className` and merge it into the top-level element's classes with
  `twMerge` (from `tailwind-merge`), the caller's classes last so they win;
- accept `ref` and forward it to the top-level element. React 19 passes `ref` as
  a regular prop, so extend `ComponentProps<'tag'>` and spread the rest onto the
  element; no `forwardRef`.

## Type narrowing

Do not cast with `as`. Use type predicates (`value is Foo`) or type assertion
functions (`asserts value is Foo`) instead.

## Types and definitions

Do not create `types.ts` files. Define types close to their point of usage.

## Project structure

Organize files around feature concerns, not code categories. Prefer directories
named after what the code _does_ (`auth/`, `billing/`) over what it _is_
(`components/`, `hooks/`, `adapters/`).

### Source directory boundary

No source files live outside `src/`. Config and setup files (`*.config.ts`,
`vitest.setup.ts`, `oxlint-plugin.ts`, etc.) may remain at the repository root,
but all application source belongs under `src/server/`, `src/shared/` or
`src/ui/`.

## Documentation

Document exported TypeScript symbols with JSDoc. Document properties
individually on object types. Document function parameters. Add examples where
useful. Do not document unexported symbols.

## JSX

Keep JSX clean. Inline JavaScript is fine for simple expressions — string
interpolation, short ternaries, mapping a list to simple elements. When the
logic gets heavy, pull it out.

Two signals that logic belongs outside the JSX:

- It would span more than ~5 lines inside the expression.
- It produces nested component structure (conditionally rendered subtrees, lists
  of lists, etc.).

In those cases, extract a named `const` above the `return`, or a separate
component.

```tsx
// ✅ simple interpolation — fine inline
<p>Hello, {user.name}</p>

// ✅ short ternary — fine inline
<button>{loading ? 'Loading...' : 'Submit'}</button>

// ✅ list of simple elements — fine inline
<ul>
  {items.map((item) => (
    <li key={item.id}>{item.label}</li>
  ))}
</ul>

// ❌ conditional subtree with nesting — extract it
<div>
  {user.role === "admin" ? (
    <div>
      <h2>Admin panel</h2>
      <p>{user.email}</p>
      <button onClick={handleRevoke}>Revoke access</button>
    </div>
  ) : (
    <div>
      <h2>Member</h2>
      <p>{user.email}</p>
    </div>
  )}
</div>

// ✅ extracted — readable
const panel =
  user.role === "admin" ? (
    <AdminPanel email={user.email} onRevoke={handleRevoke} />
  ) : (
    <MemberPanel email={user.email} />
  );

return <div>{panel}</div>;
```

## CSS

Do not use `!important`.

## Logging

Log levels:

- `error` — something went wrong, the program could not function correctly
- `warning` — functioned as expected, but something warrants attention
- `info` — the program did something as expected
- `debug` — extra detail, or "the program is about to do something"

Never emit an `error`-level log and then rethrow. Either handle the error or
throw it — not both. Logging before rethrowing causes duplicate log lines for
the same error and false positives when errors are caught higher in the stack.

## HTTP status codes

Use status codes that accurately reflect the nature of the failure, not just the
nearest approximation.

- **404 Not Found** — the addressed resource does not exist. This includes route
  parameters that are syntactically invalid (e.g. a server name that is not a
  valid slug): the URL simply points to nothing.
- **409 Conflict** — the request conflicts with existing state (e.g. a duplicate
  name).
- **415 Unsupported Media Type** — a mutating request without
  `Content-Type: application/json`.
- **422 Unprocessable Content** — the request body or query parameters fail
  validation. The problem details list every failing field in `errors`.
- **403 Forbidden** — the request was refused by the Host or Origin checks.

The key distinction between 422 and 404 when parsing route parameters: if the
parameter is part of the URL path and its value makes no sense as a resource
identifier, the address is effectively non-existent — return 404, not 422.
Reserve 422 for problems with the request _body_ or query.

## JSON validation and serialization

Use Zod schemas at every JSON boundary. Parse untrusted input with the schema
after `JSON.parse` or `req.json()`. Run trusted output through the schema before
`JSON.stringify` or `Response.json()` — this validates shape and strips fields
the schema does not allow.

Infer TypeScript types with `z.infer<typeof …>`; do not maintain parallel
hand-written types for the same shape.

### Schema ownership

Who defines the schema depends on the boundary:

- **API endpoints** — `src/shared/api/` owns the Zod schemas and exported types
  for request and response bodies, grouped by resource. Handlers and clients
  import them from there; they do not redefine the shape.
- **Persisted files** (`servers.json`, `runtime.json`) — the persistence module
  that reads and writes the file owns its Zod schema. Callers of that module
  import the exported types; they do not parse or validate the file themselves.

Validate all **incoming** JSON:

- API request bodies (through `@hono/zod-validator`)
- Files read from disk (`servers.json`, `runtime.json`)

Serialize all **outgoing** JSON:

- API response bodies
- Files written to disk

```ts
// correct — validate after parse
const file = serversFileSchema.parse(JSON.parse(text));

// incorrect — trust parsed JSON
const file = JSON.parse(text) as ServersFile;

// correct — serialize before responding
return c.json(serverSummarySchema.parse(summary));
```

## Testing

### Test structure

Group tests by exported symbol, then by method or scenario, using nested
`describe` blocks. Each `it` block must be fully independent — no test may rely
on state left behind by a sibling.

```ts
describe('UserService', () => {
  describe('createUser', () => {
    it('creates a user with valid input', async () => { ... });
    it('throws when email is already taken', async () => { ... });
  });

  describe('deleteUser', () => {
    it('deletes an existing user', async () => { ... });
  });
});
```

Use `beforeEach` to produce a fresh instance or mock for every test. Use
`beforeAll`/`afterAll` only for expensive shared resources that are genuinely
read-only within the suite (e.g. a started server).

### Mocking in unit tests

Declare all `vi.mock()` calls at the top of the file, after all imports. Extract
mocked exports into named `const mock*` variables with `vi.mocked()`, then call
mock function methods on those variables. Prefer this over returning a mock
object from the `vi.mock` factory — it keeps setup close to the test and avoids
hidden state.

```ts
import { send } from './mailer';

vi.mock('./mailer');

const mockSend = vi.mocked(send);

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a welcome email on creation', async () => {
    mockSend.mockResolvedValueOnce({ messageId: 'abc' });

    await new UserService().createUser('a@b.com');

    expect(mockSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: 'a@b.com' }),
    );
  });
});
```

Rules:

- Use `mockDeep<T>()` from `vitest-mock-extended` only for class mocks, not
  plain objects or functions.
- Use `chainMock()` / `chainMocked()` from `chain-mock` for objects with
  chainable method APIs; do not use `vi.mocked()` for these.
- Extract mocked exports into `const mock*` variables with `vi.mocked()`; prefer
  calling mock function methods on those over returning a mock object from the
  `vi.mock` factory.
- Name mock variables with a `mock` prefix: `mockDB`, `mockClient`, `mockUser`.
- Call `vi.clearAllMocks()` in `beforeEach` to prevent state bleed between
  tests.
- Use `vi.useFakeTimers()` / `vi.useRealTimers()` in `beforeAll`/`afterAll` when
  the module under test uses `Date`, `setTimeout`, or `setInterval`.

### Assertions

Use `expect` from Vitest. Prefer the most specific matcher available — it
produces a better failure message than a generic `toBe(true)`.

```ts
// correct
expect(result).toEqual({ id: 1, name: 'Dan' });
expect(fn).toHaveBeenCalledExactlyOnceWith('arg');
await expect(promise).rejects.toThrow('error message');
expect(items).toHaveLength(3);
expect(str).toContain('substring');

// incorrect — prefer specific matchers
expect(result !== null).toBe(true);
expect(fn.mock.calls.length).toBe(1);
```

## Pagination

List endpoints that can grow without bound are paginated with **cursor-based
pagination** — never offset (`?page=` / `?offset=`). In v1 that is only logs.

Cursors are an **API concern**. Route handlers own the full cursor lifecycle:
deserialize and validate incoming `cursor` query parameters, call the service
with the decoded cursor fields, then serialize `nextCursor` on the way out.
Services never accept or return opaque cursor strings — they take plain cursor
values (e.g. `beforeId`) that the handler extracted from a valid cursor.

```ts
// route handler — owns cursors
const beforeId = decodeCursor(rawCursor);
if (beforeId === null) {
  throw new ValidationError([{ path: 'cursor', message: 'Invalid cursor' }]);
}
const items = logs.query({ server, beforeId, limit });

// service — owns the query, not the wire format
type LogQuery = {
  server: string;
  beforeId?: number;
  limit: number;
};
```

### Naming

- Request: `?cursor=<token>&limit=<n>` — omit `cursor` for the first page
- Response: `{ items: T[], nextCursor: string | null }` — `null` signals the
  last page

Clients **never construct cursors**. They only echo back what the server placed
in `nextCursor`. This makes inclusiveness, sort direction, and tie-breaking
invisible to the caller.

### Cursor encoding

Implement `encodeCursor` / `decodeCursor` next to the route handler (or in
colocated modules under the same route directory). Do not put cursor codecs in
services.

Encode cursors as a **fixed-width binary struct** serialized to `base64url` — no
JSON, no field names, no separators. Map each cursor field to a fixed byte range
(e.g. a `uint64` for an ID). Decode by reading the same offsets in reverse. This
keeps cursors short and opaque.

Example for a log entry `id` cursor:

```
[0..7]  uint64 big-endian — id of the last entry on the page
→ 8 bytes → 11 base64url chars
```

### Stability

When the sort key can have ties, include a secondary key in both the cursor and
the predicate. Log entry IDs are unique and monotonic, so they need none.

## Git

Keep commit messages to a single line, maximum 80 characters.
