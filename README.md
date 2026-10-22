# decoy

A configurable mock MCP server with a live web UI, for debugging MCP
**clients**.

decoy is the mirror image of the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector): instead of a
client poking at your server, decoy is the server your client connects to. You
define tools in the browser, publish them while your client is connected, and
watch every JSON-RPC message go by.

- **Servers**: as many mock servers as you like, each on its own URL:
  `http://localhost:6280/s/<server>/mcp`.
- **Live tools**: add, edit, publish and unpublish tools without restarting
  anything. Connected sessions get `notifications/tools/list_changed`.
- **Templated responses**: every tool answers with a
  [json-e](https://json-e.js.org/) template rendered with the call's arguments.
- **Logs**: every message in and out, live, with search, pause, clear and JSONL
  export. Requests and responses are paired, with durations, and each session's
  `initialize` negotiation is summarized.
- **REST API**: everything the UI does goes through `/api/v1`, so you can script
  decoy with `curl`.

## Usage

Requires Node.js 24 or later.

```bash
npx decoy
```

Then open <http://localhost:6281>, create a server, add a tool, and point your
MCP client at the server's endpoint (shown in the UI), for example:

```
http://localhost:6280/s/weather/mcp
```

decoy speaks Streamable HTTP only, with sessions (`Mcp-Session-Id`). Stop it
with Ctrl+C.

### Flags

| Flag                  | Default             | Meaning                                                      |
| --------------------- | ------------------- | ------------------------------------------------------------ |
| `--mcp-port <port>`   | `6280`              | Port of the MCP listener.                                    |
| `--ui-port <port>`    | `6281`              | Port of the UI and REST API listener.                        |
| `--host <address>`    | `127.0.0.1`         | Bind address of the MCP listener only.                       |
| `--config-dir <path>` | platform config dir | Where `servers.json` (and `runtime.json`) are stored.        |
| `--log-limit <n>`     | `10000`             | Messages kept in memory, across all servers. At least `100`. |
| `-h`, `--help`        |                     | Show usage.                                                  |
| `-v`, `--version`     |                     | Show the version.                                            |

The UI listener always binds `127.0.0.1` and rejects requests whose `Host` isn't
`localhost:<ui-port>` or `127.0.0.1:<ui-port>`. It has no authentication.

### Where things are stored

Servers and tools are saved to `servers.json` in the config directory after
every change:

| Platform | Default config directory                  |
| -------- | ----------------------------------------- |
| Linux    | `~/.config/decoy` (or `$XDG_CONFIG_HOME`) |
| macOS    | `~/Library/Preferences/decoy`             |
| Windows  | `%APPDATA%\decoy\Config`                  |

The UI shows the exact path. Logs are kept in memory only and are dropped on
exit.

While decoy runs, it writes `runtime.json` next to `servers.json` (process ID,
API URL, MCP URL template) and removes it on exit. A second instance using the
same config directory refuses to start.

### HTTPS or a public URL

decoy serves plain HTTP on localhost. If your client needs HTTPS or runs
elsewhere, put a tunnel in front of the **MCP port only**:

```bash
cloudflared tunnel --url http://localhost:6280
```

```bash
ngrok http 6280
```

Then use the tunnel's host in place of `localhost:6280`. Never tunnel the UI
port: it has no authentication.

## Response templates

A tool's response template is a JSON value rendered with
[json-e](https://json-e.js.org/). The rendered value must be a valid MCP
`CallToolResult`. The context has one key, `args`, the call's `arguments`.

```json
{
  "content": [
    { "type": "text", "text": "Forecast for ${args.city}: 14°C, light rain" }
  ]
}
```

- `${args.city}` interpolates a string, number or boolean inside a string.
- `{ "$eval": "args" }` inserts a structure, for example in `structuredContent`.
- Keys starting with `$` are json-e operators. Write `$$` for a literal `$`.

New tools echo their arguments back as JSON text:

```json
{ "content": [{ "type": "text", "text": { "$json": { "$eval": "args" } } }] }
```

When a template fails to render, or renders to something that isn't a
`CallToolResult`, the call returns a tool execution error (`isError: true`)
explaining why. Calling an unknown or unpublished tool returns the JSON-RPC
error `-32602`. Arguments are not validated against the input schema.

## REST API

The API lives at `http://localhost:6281/api/v1`. Bodies are JSON, errors are
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`.
Requests with a body need `Content-Type: application/json`.

| Method & path                                   | Purpose                                             |
| ----------------------------------------------- | --------------------------------------------------- |
| `GET /api/v1`                                   | Instance info: version, ports, config file.         |
| `GET /api/v1/servers`                           | List servers.                                       |
| `POST /api/v1/servers`                          | Create `{ name, serverInfo?, instructions? }`.      |
| `GET /api/v1/servers/{server}`                  | One server.                                         |
| `DELETE /api/v1/servers/{server}`               | Delete it and close its sessions.                   |
| `GET /api/v1/servers/{server}/tools`            | List tools, drafts included.                        |
| `POST /api/v1/servers/{server}/tools`           | Create a tool (a draft unless `published`).         |
| `GET /api/v1/servers/{server}/tools/{tool}`     | One tool, with template warnings.                   |
| `PATCH /api/v1/servers/{server}/tools/{tool}`   | Update any field, including `published`.            |
| `DELETE /api/v1/servers/{server}/tools/{tool}`  | Delete a tool.                                      |
| `GET /api/v1/servers/{server}/sessions`         | Live MCP sessions.                                  |
| `DELETE /api/v1/servers/{server}/sessions/{id}` | Close a session server-side.                        |
| `GET /api/v1/servers/{server}/logs`             | Log entries, newest first (`q`, `cursor`, `limit`). |
| `DELETE /api/v1/servers/{server}/logs`          | Clear the log.                                      |
| `GET /api/v1/servers/{server}/logs/stream`      | Live entries over SSE (`after`, `Last-Event-ID`).   |
| `GET /api/v1/servers/{server}/logs/export`      | Every entry as NDJSON.                              |

The Zod schemas in `src/shared/api/` are the contract, with a JSDoc comment on
every field. For example:

```bash
curl -X POST localhost:6281/api/v1/servers \
  -H 'content-type: application/json' -d '{"name":"weather"}'

curl -X POST localhost:6281/api/v1/servers/weather/tools \
  -H 'content-type: application/json' \
  -d '{"name":"echo","description":"Returns its arguments","published":true}'
```

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the server with `tsx watch` (MCP on 6280, API on 6281) and Vite
on <http://localhost:5173>, which proxies `/api/` to the server, side by side.
Note that it uses your default config directory. To pass flags such as
`--config-dir`, run `pnpm dev:server --config-dir <dir>` and `pnpm dev:ui` in
separate terminals.

| Script           | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `pnpm build`     | `vite build` → `dist/ui/`, `tsdown` → `dist/cli.js` |
| `pnpm start`     | Runs the build: `node dist/cli.js`                  |
| `pnpm test`      | Vitest, with type checking                          |
| `pnpm typecheck` | `tsc -b` over the server and UI projects            |
| `pnpm fix`       | oxfmt, then oxlint with fixes                       |

See [AGENTS.md](AGENTS.md) for the architecture and coding standards.
