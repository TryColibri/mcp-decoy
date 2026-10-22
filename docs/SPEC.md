# decoy — implementation brief

You are building **decoy**, a local tool for debugging MCP **clients**. It is
the mirror image of the MCP Inspector: instead of a client poking at your
server, decoy is a configurable mock MCP server that your client connects to,
with a web UI to define tools live and watch every JSON-RPC message.

"decoy" is a working name. This is a side project: no publishing workflow or
deploys. Still, the package must be **releasable as is**: after `pnpm build`,
`npx .` (or `npx ./decoy-<version>.tgz` from `pnpm pack`) starts everything with
one command, exactly as `npx decoy` would from the registry.

This brief comes from a design and architecture discussion with the owner. Items
marked as decisions are settled — do not revisit them. Section 13 lists facts
you must confirm against the installed packages before relying on them, because
library APIs move.

The approved UI mockups are in `design/` next to this file (§ 10).

---

## 1. Scope of v1

In scope:

1. **Servers**: create and delete mock MCP servers. Each one is mounted on its
   own URL, `http://<host>:6280/s/<server>/mcp`, all served by the same process.
   Servers are persisted.
2. **Tools**: add, edit, publish, unpublish and delete tools on a server **while
   clients are connected, without restarting anything**. Connected sessions get
   `notifications/tools/list_changed`.
3. **Logs**: every JSON-RPC message in and out, per server, viewable live in the
   UI with a search box, pause, clear and JSONL export. Logs are in memory only
   and are dropped on exit.
4. **CLI**: `npx decoy` starts the MCP listener and the UI listener (which
   serves the API and the built SPA).
5. **Public REST API**: everything the UI does goes through a versioned, REST
   API (`/api/v1`). The SPA is just its first client; CLI subcommands and a TUI
   will be the next ones (§ 7).

Out of scope for v1 (do not build, but don't paint yourself into a corner):
resources, prompts, sampling, elicitation, other capabilities; fault injection;
CLI subcommands (`decoy tool add`, etc.) and the TUI — the API and the runtime
file (§ 11.1) exist so they can be added without server changes; the legacy
HTTP+SSE transport; stdio; picking a protocol version; editing a server's
identity after creation; authentication; log persistence; i18n; dark mode.

---

## 2. Decisions

| Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager   | pnpm. Use `pnpm add` / `pnpm remove`, never hand-edit dependencies. Pin exact versions like the reference project.                                                                                                                                                                                                                                                                                                            |
| Shape             | **One** Node.js process running **two Hono apps** with `@hono/node-server`, plus a **Vite + React + TypeScript SPA**. No Next.js.                                                                                                                                                                                                                                                                                             |
| Ports             | MCP listener on `6280` (users tunnel only this one). UI listener on `6281`, bound to `127.0.0.1`, serving `/api/*` and the built SPA. The MCP Inspector uses 6274 and 6277; avoid those.                                                                                                                                                                                                                                      |
| Repo              | One package (no workspace): `src/server/`, `src/ui/`, `src/shared/` (§ 6).                                                                                                                                                                                                                                                                                                                                                    |
| MCP library       | The official TypeScript SDK, **low-level `Server`** class (not `McpServer`), with the web-standard Streamable HTTP transport (`Request` in, `Response` out).                                                                                                                                                                                                                                                                  |
| Transport         | Streamable HTTP only.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sessions          | Stateful: `Mcp-Session-Id`, one SDK `Server` plus one transport per session.                                                                                                                                                                                                                                                                                                                                                  |
| Capabilities      | Every server advertises only `tools: { listChanged: true }`.                                                                                                                                                                                                                                                                                                                                                                  |
| Protocol version  | Always negotiated by the SDK.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Persistence       | Servers and tools persisted to a config directory. Logs in memory, dropped on exit.                                                                                                                                                                                                                                                                                                                                           |
| Tool responses    | Always a **template**: a JSON value rendered with **json-e** (§ 8.3).                                                                                                                                                                                                                                                                                                                                                         |
| API               | A **public REST API** under `/api/v1` on the UI listener, designed for any client (SPA now, CLI subcommands and TUI later), not as a private backend for the SPA. Input validated with `@hono/zod-validator` using the Zod schemas in `src/shared/`, which are the API contract. **No OpenAPI** (generation or document). Errors as RFC 9457 `application/problem+json`. The SPA calls it through Hono's typed client (`hc`). |
| Live log updates  | SSE from the UI listener (`streamSSE` from `hono/streaming`).                                                                                                                                                                                                                                                                                                                                                                 |
| SPA routing       | **React Router**, used as a client-side library (declarative or data router). **No framework mode, no SSR.** **Never use any TanStack package.**                                                                                                                                                                                                                                                                              |
| SPA data fetching | **`useSWR`** (the `swr` package) for reads; mutations with the typed client followed by SWR `mutate`.                                                                                                                                                                                                                                                                                                                         |
| Styling           | Tailwind CSS v4 (`@tailwindcss/vite`) utility classes inline, with **Base UI** (`@base-ui/react`) for interactive primitives (dialog, select, tooltip, checkbox, …). **No shadcn.**                                                                                                                                                                                                                                           |
| CLI               | The **Bombshell** stack: `@bomb.sh/args` for flags and `@clack/prompts` for terminal output. **Never use Commander** (or yargs, meow, etc.).                                                                                                                                                                                                                                                                                  |
| Lint/format       | oxlint + oxfmt, copied from the reference project.                                                                                                                                                                                                                                                                                                                                                                            |
| Tests             | Vitest.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Node              | Same `.nvmrc` as the reference (24.15 at time of writing). `engines.node` set to `>=24`.                                                                                                                                                                                                                                                                                                                                      |
| Logs storage      | An in-memory ring buffer behind a `LogStore` interface. Not DuckDB (§ 9.3).                                                                                                                                                                                                                                                                                                                                                   |

---

## 3. Project tooling (copy from the reference)

The reference project is <https://github.com/loderunner/teacher>. Clone it
somewhere temporary. Read its `AGENTS.md` in full first: its coding standards
apply here. It is a Next.js app, so adapt everything Next-specific.

Copy and adapt:

- `.nvmrc`, `.gitignore` (drop the Next and Vercel lines, add `dist/` and
  `*.tgz`), `.cursorignore`.
- `.oxfmtrc.json`, `.oxlintrc.json`, `oxlint-plugin.ts` (the custom
  `loderunner/no-chained-arrow` rule). Remove the `nextjs` plugin and the Next,
  i18n and Drizzle ignore patterns.
- TypeScript: base strict settings from the reference's `tsconfig.json`, split
  into three configs: `tsconfig.server.json` (Node types, no DOM, covers
  `src/server` and `src/shared`), `tsconfig.ui.json` (DOM, JSX, Vite client
  types, covers `src/ui` and `src/shared`), and a root `tsconfig.json`
  referencing both. `pnpm typecheck` checks both (`tsc -b`; if TS 7's build mode
  doesn't support this, run `tsc -p` twice). Path alias `@/*` → `src/*` in both,
  mirrored in Vite and Vitest config.
- Also add an oxlint import restriction: `src/ui/**` must not import
  `src/server/**`, and `src/shared/**` imports nothing from either.
- `vitest.config.ts` / `vitest.setup.ts`: use Vitest projects, `node`
  environment for server and shared, `jsdom` for UI tests. No `loadEnv`.
- `.vscode/` (extensions, settings; launch.json: debug the server with `tsx`,
  debug the client at `http://localhost:5173`).
- `.github/actions/setup/action.yml` and `.github/workflows/checks.yml` (format,
  lint, typecheck, test), plus a `build` job running `pnpm build`. Remove the
  fake `DATABASE_URL`. Add a `pull-request.yml` and a push-to-main workflow that
  only call `checks.yml`. Do **not** copy `neon-cleanup.yml`, `production.yml`
  or any Vercel steps.
- `package.json` scripts: keep `format`, `format:fix`, `lint`, `lint:fix`,
  `fix`, `typecheck`, `test`, `test:watch`, `test:coverage`. Add `dev`, `build`
  and `start` from § 11.
- `.claude/settings.json`: keep the `Stop` hooks (`pnpm fix`, `pnpm typecheck`,
  `pnpm test:coverage`), `plansDirectory`, and the worktree hook. Remove the
  Drizzle deny rule, and remove the `.vercel` and `.env.local` symlinks from
  `create-worktree.sh`.

Skills: the reference vendors skills into `.agents/skills/`, symlinks them from
`.claude/skills/`, and pins them in `skills-lock.json`. Use the same mechanism.
Keep: `vercel-react-best-practices` (ignore its Next.js-only advice),
`vercel-composition-patterns`, `building-components`, `web-design-guidelines`,
`writing-guidelines`, `agent-browser`. Drop all others, including
`next-best-practices` and `shadcn`. If reputable skills exist for Hono, Vite,
the MCP TypeScript SDK or Clack, add them.

`AGENTS.md` (with `CLAUDE.md` as a symlink to it): write a new one for decoy.

- **Keep verbatim** from the reference: the Coding standards chapter (naming,
  functions, component composition, type narrowing, types, JSX, CSS, logging,
  JSON validation and serialization, testing structure, mocking and assertions,
  Git), the barrel-export rule, and the wire-format rules (`z.ZodType<T>`,
  `z.strictObject`, JSDoc that matches `.describe()`), re-homed to
  `src/shared/api/`.
- **Adapt**: file colocation, applied to `src/ui/routes/`.
- **Replace**: the tech stack table (use § 2) and the architecture chapter (use
  § 4 to § 10).
- **Drop**: everything Next.js (`'use client'`, `client-only`, the `Island`
  convention, the "This is NOT the Next.js you know" block), Vercel, Neon, i18n,
  Clerk, AI SDK, shadcn.
- Add the rules from § 2 that agents tend to break: no TanStack, no Commander,
  SWR for data fetching, Base UI and Tailwind without shadcn.

---

## 4. Runtime architecture

```
npx decoy
  └─ node dist/cli.js                                   (one process)
       ├─ :6280  mcpApp (Hono)   /s/:server/mcp          ← MCP clients, tunnels
       │          (--host, default 127.0.0.1)
       └─ :6281  uiApp  (Hono)   /api/*      → services   ← browser, 127.0.0.1 only
                                 /assets/*   → dist/ui/assets
                                 /*          → dist/ui/index.html (SPA fallback)
                                 (API clients: SPA, later CLI/TUI)

       both apps ──▶ services (servers, tools, logs, mcp sessions)
                       │            │
                  event bus    <config dir>/servers.json
```

- **There are only two listeners.** The SPA is static files in `dist/ui/`,
  served by the UI listener after the API routes. Vite runs only in development
  (§ 11).
- The SPA and the API share an origin (`localhost:6281`). The SPA calls
  `/api/...` with relative URLs, so there's no CORS on the UI listener.
- Both apps live in the same process and import the same modules, so state is
  ordinary module-level singletons (wired once in `src/server/main.ts`). There
  is no `globalThis` registry and no environment-variable handoff.
- Each app only defines its own routes, so there's no cross-port filtering.
  Anything else returns 404.

### 4.1 UI listener hardening

- Always bind `127.0.0.1`.
- Middleware rejects (403) any request whose `Host` is not `localhost:<uiPort>`
  or `127.0.0.1:<uiPort>`. This protects against DNS rebinding; the UI must
  never be reachable through a tunnel. In development the Vite proxy uses
  `changeOrigin: true`, so proxied requests carry the target host and pass the
  check.
- Mutating `/api` requests must have `Content-Type: application/json` and, when
  an `Origin` header is present, an Origin matching the allowed hosts (plus the
  Vite dev origin when running in dev mode). This is CSRF protection.
  Non-browser clients (curl, a future CLI or TUI) send no `Origin` and pass.
- The API has no authentication in v1; being bound to `127.0.0.1` is the
  protection. If a later version allows binding the UI listener elsewhere, it
  must add a token first (generated at startup and written to the runtime file,
  § 11.1).

### 4.2 MCP listener CORS

The owner's client could be browser-based. Use `hono/cors` on `mcpApp`: allow
any origin, allow headers `content-type`, `mcp-session-id`,
`mcp-protocol-version`, `last-event-id` and `authorization`, expose
`mcp-session-id`, and allow `GET`, `POST`, `DELETE` and `OPTIONS`. This is
acceptable because the listener only serves mock data. Preflights are not
logged.

---

## 5. Layering

The owner's requirement: **API handlers call a service as early as possible**.
Handlers are a thin HTTP shell: validate → call one service function →
serialize. All behavior lives in services, so other front-ends (CLI subcommands,
a public REST API) can reuse them later.

- **Services** take plain typed inputs, return typed values, and throw domain
  errors from `src/server/errors.ts`: `NotFoundError`, `ConflictError` (for
  example a duplicate name), and `ValidationError` (with field paths). They know
  nothing about Hono, HTTP or status codes.
- **One `app.onError`** on the API maps domain errors to 404/409/422 as
  `application/problem+json` (§ 7.2). Request validation failures from
  `@hono/zod-validator` use the same shape (pass a hook that formats them).
  Anything else is 500, logged once and not rethrown.
- **Mutations emit events** on a small typed event bus (`src/server/events.ts`).
  For example `tools.publish()` persists, then emits `toolsChanged(server)`. The
  MCP layer subscribes and notifies sessions. Services never call the MCP layer
  directly.
- **Wire-format schemas** (`src/shared/api/`) are the single source of request
  and response types for both handlers and the SPA.

---

## 6. Code layout

```
src/
  shared/
    api/              # Zod schemas + types for API bodies, grouped by resource (servers, tools, logs)
  server/
    cli.ts            # bin entry: parse flags, print banner, call main.start()
    main.ts           # start({ mcpPort, uiPort, host, configDir, logLimit, dev }) → { close() }
    mcp-app.ts        # Hono app for /s/:server/mcp
    ui-app.ts         # Hono app: middleware, mounts api routes, static + SPA fallback
    api/              # /api/v1: Hono route modules per resource, problem+json
    servers/          # service + persistence (servers.json)
    tools/            # service
    templates/        # json-e rendering + CallToolResult validation
    logs/             # LogStore interface, ring buffer, query, clear, subscribe
    mcp/              # session registry, per-session SDK Server factory, request handling, capture
    config/           # config-dir resolution, servers.json read/write
    events.ts, errors.ts
  ui/
    index.html, main.tsx, styles.css (Tailwind + @theme tokens)
    api.ts            # SWR fetcher + ApiError, built on the shared client
    routes/           # one directory per route; components colocated with their route
    components/       # shared only when used by 2+ unrelated routes
vite.config.ts        # root: src/ui, outDir: dist/ui, proxy /api → 6281
tsdown.config.ts      # (or tsup) bundles src/server/cli.ts → dist/cli.js
```

Hono's typed client infers types only from **chained** route definitions. Write
route modules that way and export `type ApiV1 = typeof apiV1`. Put the typed
client factory (`createDecoyClient(baseUrl)`, built on `hc<ApiV1>`) in
`src/shared/client/` so the SPA today, and the CLI and TUI later, use the same
client. That module may `import type` from `src/server/api/` (type-only imports
are erased); allow exactly that in the import-restriction lint rule.

---

## 7. Public REST API (`/api/v1`, UI listener)

Design this as a public API from day one: stable, documented, resource-oriented,
usable from `curl`. The SPA must not get special endpoints; if the SPA needs
something, it's an API feature.

### 7.1 Conventions

- **Versioning**: everything under `/api/v1`. Breaking changes mean `/api/v2`;
  additive changes (new fields, new endpoints) are fine within v1. Clients must
  ignore unknown fields.
- **Contract**: the request and response Zod schemas in `src/shared/api/` (with
  their JSDoc) are the API's documentation and contract. Validate inputs with
  `@hono/zod-validator`; tests check that handlers return bodies matching the
  response schemas (§ 12). No OpenAPI.
- **Resources and identifiers**: servers are identified by `name`, tools by
  `name` within their server. Renaming a tool (`PATCH` with a new `name`) moves
  it: the response has the new resource and a `Location` header.
- **JSON** everywhere, `camelCase` fields, ISO 8601 timestamps.
- **Status codes**: 200 read/update, 201 create (with `Location`), 204 delete,
  404 unknown resource, 409 conflict (duplicate name), 422 validation, 415 wrong
  content type, 500 unexpected.
- **Errors**: RFC 9457 `application/problem+json`:
  `{ type, title, status, detail, errors?: [{ path, message }] }`, where `type`
  is a stable URI per error kind (for example
  `https://decoy.dev/problems/conflict`; it doesn't need to resolve) so clients
  can switch on it.
- **Collections**: `{ items: [...] }` (an object, so fields can be added later).
  Paginate with a cursor where a collection can grow without bound (only logs in
  v1): `{ items, nextCursor }`, `?cursor=&limit=`. Use the reference project's
  pagination and cursor encoding rules (opaque base64url cursors).
- **No concurrency control in v1** (no ETags); last write wins. Leave room to
  add `ETag` / `If-Match` later.

### 7.2 Endpoints

| Method & path                                         | Purpose                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1`                                         | Instance info: version, MCP port and host, UI port, config file path, MCP URL template, link to the servers collection.             |
| `GET /api/v1/servers`                                 | List servers, each with `toolCount`, `publishedToolCount`, `sessionCount` and `mcpUrl`.                                             |
| `POST /api/v1/servers`                                | Create `{ name, serverInfo?, instructions? }` → 201 + `Location`.                                                                   |
| `GET /api/v1/servers/{server}`                        | One server (same summary fields).                                                                                                   |
| `DELETE /api/v1/servers/{server}`                     | Delete it and close its sessions → 204.                                                                                             |
| `GET /api/v1/servers/{server}/tools`                  | List tools, drafts included.                                                                                                        |
| `POST /api/v1/servers/{server}/tools`                 | Create a tool; omitted fields take defaults; `published` defaults to `false` → 201 + `Location`.                                    |
| `GET /api/v1/servers/{server}/tools/{tool}`           | One tool.                                                                                                                           |
| `PATCH /api/v1/servers/{server}/tools/{tool}`         | Partial update of any field, including `published: true/false` (publishing is a state change on the resource, not an RPC endpoint). |
| `DELETE /api/v1/servers/{server}/tools/{tool}`        | Delete → 204.                                                                                                                       |
| `GET /api/v1/servers/{server}/sessions`               | Live MCP sessions: `id`, `clientInfo`, `protocolVersion`, client capabilities, `connectedAt`, `lastSeenAt`.                         |
| `DELETE /api/v1/servers/{server}/sessions/{session}`  | Close a session server-side → 204. Its client gets 404 on its next request and should re-initialize.                                |
| `GET /api/v1/servers/{server}/logs?q=&cursor=&limit=` | Log entries, newest first, paginated.                                                                                               |
| `DELETE /api/v1/servers/{server}/logs`                | Clear → 204.                                                                                                                        |
| `GET /api/v1/servers/{server}/logs/stream?after=`     | Live SSE stream (§ 9.4).                                                                                                            |
| `GET /api/v1/servers/{server}/logs/export`            | All entries as NDJSON (`application/x-ndjson`), with `Content-Disposition: attachment`.                                             |

Live session counts in the SPA come from SWR polling (`refreshInterval: 2000`)
on the servers and server resources. That's good enough locally; don't add
another stream for it. The Logs screen's Negotiation card can use
`GET …/sessions` for sessions that are still live, falling back to the
`initialize` pair in the loaded log entries for closed ones.

---

## 8. Domain model, services, MCP layer

### 8.1 Types (`src/shared/api/`)

```ts
/** A persisted mock MCP server. */
type ServerConfig = {
  /** URL slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 1–64 chars, unique. */
  name: string;
  /** Sent as serverInfo in the initialize result. Default: { name: `decoy/${name}`, version: '0.1.0' }. */
  serverInfo: { name: string; version: string };
  /** Optional `instructions` in the initialize result. */
  instructions?: string;
  tools: ToolConfig[];
  createdAt: string; // ISO 8601
};

/** A tool definition. Only published tools are visible to clients. */
type ToolConfig = {
  /** MCP tool name, unique per server. */
  name: string;
  title?: string;
  description: string;
  /** JSON Schema object; must have type: 'object'. */
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  /** json-e template; the rendered result must be a valid CallToolResult. */
  responseTemplate: unknown;
  published: boolean;
  updatedAt: string;
};
```

Renaming a tool is allowed: it counts as a change and triggers `list_changed`. A
server's name can't change after creation.

### 8.2 MCP request handling (`src/server/mcp/`, mounted by `mcp-app.ts`)

The handler gets `c.req.raw` (a Fetch `Request`) and returns the transport's
`Response`.

- **POST** without `Mcp-Session-Id` carrying an `initialize` request: create a
  session, meaning a new low-level SDK `Server` with
  `{ capabilities: { tools: { listChanged: true } }, instructions }` and the
  server's `serverInfo`, plus a new web-standard Streamable HTTP server
  transport with a session ID generator, connected to each other. Register the
  session under the server name once the transport reports its ID.
- **POST/GET/DELETE** with `Mcp-Session-Id`: look up the session and pass the
  request to its transport. If the ID is unknown, return 404 (per spec, so
  clients re-initialize).
- A request for an unknown server name returns 404 with a JSON-RPC error body
  naming the known servers. That's a debugging aid.
- `tools/list` returns the server's **published** tools, read fresh from the
  service on each call so live edits show up immediately.
- `tools/call`:
  - Unknown or unpublished tool: a JSON-RPC error (`-32602`, "Unknown tool:
    <name>").
  - Otherwise render the template (§ 8.3) with `{ args }`. If rendering fails,
    or the output doesn't validate as a `CallToolResult`, return a **tool
    execution error** result (`isError: true`, text describing the template
    error). This is more useful to a client developer than a protocol error.
  - Do **not** validate `arguments` against `inputSchema` in v1.
- **`toolsChanged(server)` event**: for every live session of that server, send
  `notifications/tools/list_changed` through its SDK `Server`.
- **`serverDeleted(server)` event**: close all of its sessions' transports and
  remove them; later requests get 404.
- **DELETE** with a session ID: close the session and unregister it.
- On process shutdown, close every session.

### 8.3 Templates (json-e)

Use [json-e](https://json-e.js.org/) (`json-e` on npm). It renders JSON data
structures, interpolates `${expr}` inside strings, offers `$eval` for non-string
values, never uses `eval`, and guarantees termination. That makes it safe to run
on user input.

- Context: `{ args }`, the `arguments` of the call, defaulting to `{}`. Design
  it so more keys (for example session or clientInfo) can be added later.
- In strings, `${args.city}` interpolates strings, numbers and booleans. To
  insert a structure, use `{ "$eval": "args" }`.
- json-e treats object keys that start with `$` as operators; `$$` escapes a
  literal `$`. Put both facts in the UI hint.
- Validate the template while it is edited, not on save: the first edit at once,
  then at most every 400 ms. The UI checks that it is JSON, then renders it in
  the browser with empty `args` and shows only json-e's `TemplateError` and
  `SyntaxError`, which no arguments can fix. Errors that depend on `args` (a
  missing property) are ignored: a template can legitimately need arguments.
  Other json-e errors surface when the tool is called.
- Validate the rendered output against the SDK's `CallToolResult` Zod schema.
- Wrap json-e in `src/server/templates/` so the engine can be swapped.

Default template for a new tool, which echoes the arguments back as JSON text
(confirm that json-e's `$json` operator behaves as expected; otherwise fall back
to a fixed text such as `"OK"`):

```json
{ "content": [{ "type": "text", "text": { "$json": { "$eval": "args" } } }] }
```

Example with interpolation:

```json
{
  "content": [
    { "type": "text", "text": "Forecast for ${args.city}: 14°C, light rain" }
  ]
}
```

### 8.4 Persistence (`src/server/config/`)

- The default directory is `$XDG_CONFIG_HOME/decoy`, or `~/.config/decoy` when
  `XDG_CONFIG_HOME` is unset or not absolute, on every platform (not the system
  preferences directory). In dev mode (`--dev`) it is `.decoy/` at the
  repository root, which is gitignored. `--config-dir` overrides both.
- One file, `servers.json`: `{ "version": 1, "servers": [ServerConfig, …] }`,
  validated with Zod on load. If it's missing, start with no servers. If it's
  invalid, refuse to start and print the Zod issues and the file path.
- Write atomically (temp file in the same directory, then `rename`) on every
  mutation, serialized through one promise queue so concurrent requests can't
  interleave writes.

---

## 9. Logs

### 9.1 What gets logged

Every JSON-RPC message, in both directions, for every session. Each `LogEntry`
contains:

```ts
type LogEntry = {
  id: number; // monotonic across the process, used as an SSE event id and cursor
  at: string; // ISO timestamp with ms
  server: string;
  sessionId: string | null; // null until a session is assigned (e.g. the initialize request)
  direction: 'in' | 'out'; // in = client → server
  kind: 'request' | 'response' | 'error' | 'notification' | 'invalid';
  method: string | null; // for responses, copied from the matched request
  jsonrpcId: string | number | null;
  durationMs: number | null; // on responses: time since the matching request
  raw: string; // exact JSON text
};
```

- **Incoming**: capture in the MCP handler **before** handing over to the
  transport. Read `await c.req.raw.clone().text()` so malformed JSON is logged
  as `kind: 'invalid'`. Back-fill `sessionId` on the `initialize` request once
  it's known, or link it by `jsonrpcId`.
- **Outgoing**: wrap the transport's `send` (or the equivalent hook in the
  installed SDK) so every message is captured exactly once, including those sent
  on the GET SSE stream, `list_changed` notifications, and responses streamed as
  SSE inside a POST response.
- Pair requests and responses by `(sessionId, jsonrpcId)` to fill `method` and
  `durationMs` on responses.
- Don't log CORS preflights or HTTP-level noise.

### 9.2 LogStore

```ts
interface LogStore {
  append(entry: Omit<LogEntry, 'id'>): LogEntry;
  query(q: {
    server: string;
    text?: string;
    afterId?: number;
    beforeId?: number;
    limit: number;
  }): LogEntry[];
  clear(server: string): void;
  subscribe(
    server: string,
    listener: (
      event: { type: 'entry'; entry: LogEntry } | { type: 'cleared' },
    ) => void,
  ): () => void;
}
```

- v1 implementation: a ring buffer with a **global** cap (`--log-limit`, default
  10 000). The oldest entries are evicted.
- `text` search: case-insensitive substring over `method` and `raw`.

### 9.3 Why not DuckDB (for now)

A debugging session produces thousands of messages, at most a few hundred
thousand. An array filtered in JS handles that easily. DuckDB's Node client
ships a native binary for each platform, which makes every `npx` install
heavier. If richer queries are wanted later, the next step is an in-memory
`node:sqlite` database: it's built into Node, has JSON functions and FTS5, and
costs nothing to install (check its stability status in the Node version used).
DuckDB comes after that, only if analytical queries appear. All of these sit
behind the `LogStore` interface.

### 9.4 Live delivery to the UI

- `GET /api/v1/servers/{server}/logs/stream` uses `streamSSE`.
  - Replay the entries after `Last-Event-ID` (or `?after=`) from the store, then
    forward events from `subscribe`.
  - Send events `entry` (with `id` set to the entry's ID) and `cleared`, plus a
    heartbeat comment every 15 s.
  - Unsubscribe when the stream aborts (`stream.onAbort`).
- The logs page loads the latest 500 entries with SWR (`GET …/logs?limit=500`),
  then opens an `EventSource` with `after=<highest id>` and appends incoming
  entries into the SWR cache (`mutate(key, updater, { revalidate: false })`).
  That way no entry is missed or duplicated. On `cleared`, empty it.
- **Pause** stops appending to the visible list and buffers in the client. Show
  a "N new" counter; resuming flushes the buffer.
- **Search** filters client-side over what's loaded, debounced. If there are
  older entries (`nextCursor` is set), a "Search all" action queries `?q=`. Keep
  this simple.
- **Clear**: `DELETE …/logs`. **Export JSONL**: a plain link to `…/logs/export`.

---

## 10. UI

Static mockups (in `design/`, `.dc.html` files): `Main.dc.html` (Servers),
`Logs.dc.html`, `Tools.dc.html`, `NewServer.dc.html`. They are written for a
design tool: markup uses `{{holes}}`, `<sc-for>` and `<sc-if>`, and sample data
sits in the `renderVals()` script at the bottom. Use them as the visual
reference (layout, spacing, colors, copy), not as code to port. All sample data
in them is invented.

Stack: React 19 SPA built by Vite. React Router as a client-side library.
`useSWR` for every read, with one shared fetcher built on the shared typed
client that throws an `ApiError` carrying the parsed problem details. Forms map
`errors[].path` onto fields. Base UI for interactive primitives. Tailwind v4
through `@tailwindcss/vite`. Fonts are bundled with `@fontsource/geist` and
`@fontsource/geist-mono` so the tool works offline (no Google Fonts at runtime).
Icons: one outline set, for example `lucide-react`.

Visual system (from the mockups). Define these as Tailwind v4 `@theme` tokens in
`styles.css` and use them through utility classes:

| Use                 | Value                                |
| ------------------- | ------------------------------------ |
| Page background     | `#F7F7F5`                            |
| Surface             | `#FFFFFF`                            |
| Ink                 | `#16181D`                            |
| Secondary text      | `#3F434A` / `#4B4F57` / `#5C6068`    |
| Borders             | `#E4E4E0` / `#EDEDEA`                |
| Code panels         | `#16181D` background, `#E8E8E3` text |
| Links and selection | `#1D4ED8`, selected row `#EEF3FE`    |
| Client → server     | arrow `#1D4ED8` on `#EAF0FD`         |
| Server → client     | arrow `#9A3412` on `#FDF1E4`         |
| Success             | `#14532D` on `#E7F5EC`               |
| Error               | `#991B1B` on `#FDECEC`               |

Radii: 6px for small controls, 8px for inputs and buttons, 12px for cards.
Primary button: ink background, white text, at least 44px tall. Accessibility:
real `<button>`, `<a>`, `<label>`; `aria-label` on icon-only buttons; visible
focus states; text contrast of at least 4.5:1.

Routes:

| Path                     | Screen                                |
| ------------------------ | ------------------------------------- |
| `/`                      | Servers                               |
| `/servers/new`           | New server                            |
| `/servers/:server`       | redirect → `logs`                     |
| `/servers/:server/logs`  | Logs                                  |
| `/servers/:server/tools` | Tools (`?tool=<name>` selects a tool) |
| `*`                      | Not found                             |

Screens:

1. **Global header** on every page: logo mark, "decoy", version, and on the
   right "Listening on localhost:6280" with a green dot (from `GET /api/v1`),
   preceded by a dotted-underline "Need a public URL?" link. It opens a popover
   with the single `cloudflared tunnel --url http://localhost:6280` command
   (copy button) for the **MCP port**, and a warning never to tunnel the UI
   port. No top-level nav; Servers is the only top-level page.
2. **Servers** (`/`): title, "Each mock server is mounted on its own URL…", and
   a **New server** button. Below that, a table with columns: name (links to the
   server), endpoint (mono, with a copy button), exposes ("N tools"), live
   sessions (pill), and Logs and Tools links. Footer note: "Servers are stored
   in <config path>. Changes apply live — no restart." Empty state: a short
   explanation and a New server button.
3. **Server layout** (`/servers/:server/*`): breadcrumb "Servers / <name>", the
   endpoint URL with a copy button, a "N live sessions" pill, a **Delete
   server** button (not in the mockups; put it at the right of the header, with
   a Base UI AlertDialog to confirm), and tabs **Logs | Tools**. Logs and Tools
   exist only inside a server: no server switcher. If the server is deleted
   elsewhere (404), show a not-found state with a link back to Servers.
4. **Logs**: a toolbar with only a **search** input, plus Pause, Clear and
   Export JSONL. No server, session or direction filters. On the left, a message
   list with columns time (mono, ms), direction arrow, method plus a kind tag
   (request/result/notify/error) plus a short note (tool name, tool count, error
   code), JSON-RPC id, session (short), and duration. Rows are buttons; the
   selected one is highlighted. On the right, a **Negotiation** card for the
   selected message's session (protocol version requested and agreed, client
   name and version, client capabilities, server capabilities), derived from
   that session's `initialize` pair in the loaded entries. Below it, the
   selected message's pretty-printed JSON with Copy JSON and "Go to response" /
   "Go to request" buttons. Auto-scroll when already at the bottom. Show a
   "reconnecting…" state when the `EventSource` drops.
5. **Tools**: a list on the left with the tool count, a **New** button, tool
   rows (mono name, description, a "Draft" badge when unpublished) and a note
   that `tools.listChanged` is on. On the right, an editor: name, title,
   description, input schema (JSON textarea, validated), **Response template**
   (JSON textarea, json-e hint below the label), annotation checkboxes
   (readOnlyHint, destructiveHint, openWorldHint), then actions. For a draft:
   **Publish tool** and Discard draft. For a published tool: **Save changes**
   and Unpublish, with Delete tool as a secondary action. Publish and Unpublish
   are `PATCH` with `published`. Next to the buttons: "Live, no restart ·
   notifies N sessions on <server>". Show field-level errors from the problem
   details. A plain `<textarea>` with a mono font is fine for JSON in v1; no
   code editor.
6. **New server** (`/servers/new`): a single centered card with name (live slug
   preview of the endpoint, inline "already exists" error checked against the
   SWR servers list, Create disabled when invalid), optional `serverInfo.name`
   (placeholder `decoy/<name>`) and `serverInfo.version` (placeholder `0.1.0`),
   and an optional instructions textarea. Empty `serverInfo` fields are omitted
   from the request, so the server applies the defaults. Then **Create server**
   and Cancel. On success, navigate to the new server's Tools tab. No protocol
   or capability options.

---

## 11. CLI, development and release

### 11.1 The `decoy` command

```
decoy [--mcp-port 6280] [--ui-port 6281] [--host 127.0.0.1]
      [--config-dir <path>] [--log-limit 10000] [--help] [--version]
```

- Parse with `@bomb.sh/args`
  (`parse(process.argv.slice(2), { string, boolean, alias, default })`), then
  validate the result with a Zod schema (ports are integers 1–65535, the log
  limit is at least 100) and print readable errors. Aliases: `-h` for help, `-v`
  for version.
- Print terminal output with `@clack/prompts`: `intro` with name and version;
  `log` lines for the UI URL, the MCP URL pattern
  `http://localhost:6280/s/<server>/mcp`, the config file and the loaded
  servers; a `note` with the tunnel tip
  (`cloudflared tunnel --url http://localhost:6280`); and `outro` on shutdown.
  Use `log.error` for startup failures. Clack is for this decorated output only;
  no interactive prompts in v1. If Bombshell offers a styling or TTY helper
  package (bomb.sh has "TTY" docs), prefer it for colors; otherwise use
  `node:util`'s `styleText`.
- `--host` sets only the MCP listener's bind address. The UI listener always
  binds `127.0.0.1`.
- If either port is in use, fail fast, naming the flag to change.
- **Runtime file**: once both listeners are up, write
  `<config dir>/runtime.json` with
  `{ pid, version, apiUrl, mcpUrlTemplate, startedAt }` (atomic write), and
  remove it on shutdown. Future CLI subcommands and the TUI use it to find a
  running instance's API. If the file exists at startup and its `pid` is alive,
  refuse to start ("decoy is already running at <apiUrl>"); if the pid is dead,
  overwrite it. Since a second instance can't share the config file safely, this
  also prevents two instances from writing `servers.json` concurrently.
- SIGINT/SIGTERM: close both listeners and all MCP sessions, remove the runtime
  file, print the outro, exit 0.
- `cli.ts` only parses, prints and calls `main.start()`. `main.ts` takes a typed
  options object, so tests can start the whole thing on random ports.

### 11.2 Development

`pnpm dev` runs two processes in parallel (`pnpm run --parallel "/^dev:/"`):

- `dev:server`: `tsx watch src/server/cli.ts --dev`, which serves MCP on 6280
  and the API on 6281. `--dev` is a hidden flag: it doesn't serve static files
  and it allows the Vite origin in the CSRF check.
- `dev:ui`: `vite` on 5173, with `server.proxy` sending `/api` to
  `http://localhost:6281` (`changeOrigin: true`; check SSE passes through
  unbuffered).

Open `localhost:5173` in development and `localhost:6281` in a release. The SPA
uses relative `/api` URLs, so the code is the same in both.

### 11.3 Build and release shape

- `build`: `vite build` → `dist/ui/`, then the server bundler (tsdown or tsup) →
  `dist/cli.js` (ESM, Node 24 target, shebang preserved, dependencies kept
  external).
- `start`: `node dist/cli.js`.
- `package.json`: `"bin": { "decoy": "dist/cli.js" }`, `"files": ["dist"]`, and
  `"prepack": "pnpm build"`.
- **Dependencies**: only server runtime packages go in `dependencies` (hono,
  @hono/node-server, @hono/zod-validator, the MCP SDK, json-e, zod,
  @bomb.sh/args, @clack/prompts). React, React Router, SWR, Base UI, Tailwind,
  Vite, fonts and icons are `devDependencies`, because they're compiled into
  `dist/ui`. That keeps `npx decoy` quick to install.
- **Static root**: `npx` runs from the user's current directory. Resolve the SPA
  folder from the code, `fileURLToPath(new URL('./ui/', import.meta.url))`,
  never from the working directory. Check whether `@hono/node-server`'s
  `serveStatic` accepts an absolute `root`. If not, write a small static handler
  for that resolved path: content types, `index.html` fallback for non-`/api`
  GETs, immutable caching for hashed `/assets/*`, and path traversal protection.
  Unknown `/api/*` paths must return a problem+json 404, never `index.html`.
- Smoke test before calling it done: `pnpm pack`, then run
  `npx ./decoy-<version>.tgz` from an **empty temp directory**, and check both
  ports and a deep-link reload of `/servers/<name>/logs`.

---

## 12. Testing

- **Unit**: services (with persistence and the event bus mocked), template
  rendering and result validation, the ring buffer (eviction, query, `afterId`),
  the error-to-status mapping, and CLI flag validation.
- **API integration**: `uiApp.request()` (no sockets) through create → list →
  update tool → publish → delete → list and delete sessions → paginate logs,
  plus problem+json shapes (404, 409, 415, 422), `Location` headers, and the
  Host and CSRF checks. Validate every response body against its response schema
  in `src/shared/api/`, so the contract can't drift from the handlers.
- **Runtime file**: written on start, removed on shutdown, refusal when a live
  instance exists, overwrite when the pid is dead.
- **MCP integration**: a real SDK **client** whose `fetch` calls
  `mcpApp.request()`. Script: create a server → initialize → `tools/list`
  (empty) → publish a tool through the service → assert the client receives
  `list_changed` → `tools/list` (1 tool) → `tools/call` returns the rendered
  template → an unknown tool returns `-32602` → the LogStore has every message
  in order with correct directions, pairing and durations → delete the server →
  the session's requests get 404.
- **Persistence**: write and reload from a temp dir; an invalid file fails with
  a readable error.
- **UI**: a few jsdom tests for the logs SWR + SSE merge logic and the tool
  editor's error display. Then use the `agent-browser` skill to compare the four
  screens with the mockups at the end of each UI milestone.

---

## 13. Milestones

Work in this order. Each milestone ends green on
`pnpm fix && pnpm typecheck && pnpm test` (and `pnpm build` from milestone 2
on), with a commit (one-line message, ≤ 80 chars, per the reference).

1. **Tooling**: scaffold the package, copy § 3, `AGENTS.md`, skills, CI.
2. **Skeleton**: `cli.ts` with Bombshell args and Clack output, `main.ts`, both
   Hono apps, Host and CSRF middleware, the Vite SPA with React Router and the
   global header, static serving with SPA fallback, `pnpm dev` and
   `pnpm build && pnpm start` both working.
3. **API foundations, persistence and servers**: `/api/v1` with
   `@hono/zod-validator`, problem+json, the shared typed client, the runtime
   file, then the servers service and endpoints.
4. **MCP core**: sessions, initialize, `tools/list`, `tools/call` with json-e,
   `list_changed`, CORS, 404 rules, the tools and sessions endpoints, plus the
   MCP integration test.
5. **Logging**: capture, LogStore, pairing, the SSE and export endpoints.
6. **UI: Servers + New server**.
7. **UI: Tools** editor with live notification.
8. **UI: Logs** with the live stream, selection, negotiation card, pause,
   search, clear, export.
9. **Polish and release check**: empty and error states, SSE reconnect, README
   (usage, flags, tunnel only the MCP port, config location), and the
   `pnpm pack` + `npx` smoke test from § 11.3.

Done means: `npx ./decoy-<version>.tgz` from an empty directory brings up both
ports; an MCP client can connect to `http://localhost:6280/s/<name>/mcp`, list
and call tools; a tool published in the UI shows up in the client without
reconnecting; and every message appears live in the Logs tab.

---

## 14. Verify before coding

These came from quick checks during design and may have changed:

- **MCP SDK.** v2 of the TypeScript SDK is split into packages
  (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, …) and
  provides `WebStandardStreamableHTTPServerTransport`. Install the latest stable
  major and confirm: the low-level `Server` class, the transport's options
  (session ID generator, session initialized and closed callbacks), how to
  intercept outgoing messages, the list-changed notification helper, and the
  exported `CallToolResult` schema. If only v1 (`@modelcontextprotocol/sdk`) is
  stable, use its equivalents.
- **json-e**: ESM and TypeScript import shape (its docs say TypeScript users may
  need `require` for the typings), the error classes it throws, and `$json`
  behavior.
- **Hono**: `@hono/node-server` `serve()` options (hostname, port, close),
  `serveStatic` with an absolute root, `streamSSE` abort handling, and `hc` type
  inference across mounted sub-apps.
- **`@hono/zod-validator`**: support for the Zod major you install (Zod 4) and
  the hook signature for formatting validation errors.
- **Bombshell**: `@bomb.sh/args` typing of parsed results (the docs mention
  typed parsing) and the current `@clack/prompts` API (`intro`, `outro`,
  `log.*`, `note`). Check bomb.sh for a TTY or styling package before using
  `node:util`'s `styleText`.
- **React Router**: the current major's library-mode API, so you don't pull in
  framework mode by accident.
- **Base UI**: the current package name and component APIs (`@base-ui/react` in
  the reference).
- **TypeScript 7**: support for `tsc -b` and project references; oxlint's
  type-aware mode with split tsconfigs.
