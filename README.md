# MCP Decoy

MCP Decoy is a mock MCP server for debugging MCP clients. You define tools in a
web UI, point your client at MCP Decoy, and watch every JSON-RPC message in both
directions.

It is the mirror image of the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector). The
Inspector is a client that you point at your server. MCP Decoy is a server that
you point your client at.

Use MCP Decoy when you build or debug an MCP client and need to answer questions
like the following:

- What does my client send during `initialize`, and what does it do with the
  server's response?
- Does my client refresh its tool list after `notifications/tools/list_changed`?
- How does my client handle a tool that returns `isError: true`, a long text
  result, or an odd input schema?
- What does a hosted client, such as a chat product that connects to remote MCP
  servers, send to my server?

You change tools while the client stays connected. Nothing restarts.

## Requirements

- Node.js 24 or later

## Start MCP Decoy

Run MCP Decoy with `npx`:

```sh
npx @hodor-ai/mcp-decoy
```

To install MCP Decoy globally and run it as `mcp-decoy`:

```sh
npm install --global @hodor-ai/mcp-decoy
mcp-decoy
```

The output is similar to the following:

```text
┌  MCP Decoy v0.1.0
│
◆  UI        http://localhost:6281
│
●  API       http://localhost:6281/api/v1
│
●  Config    /home/dana/.config/mcp-decoy/servers.json
│
●  Servers
│    echo  http://localhost:6280/s/echo/mcp
```

MCP Decoy hosts mock MCP servers, which this document calls servers. Each server
has its own tools, its own logs, and its own URL. One MCP Decoy process hosts
any number of servers.

On the first run, MCP Decoy creates one server named `echo` with one published
tool, also named `echo`, which returns its `message` argument. Open the UI URL
to manage servers and tools.

## Connect your MCP client

Every server has its own URL, `http://localhost:6280/s/SERVER_NAME/mcp`. MCP
Decoy speaks the Streamable HTTP transport, so give your client that URL and
select an HTTP transport. The following examples connect to the default `echo`
server.

### Claude Code

Add the server with the `claude mcp add` command:

```sh
claude mcp add --transport http echo http://localhost:6280/s/echo/mcp
```

### Cursor

Add the server to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json`
for all projects:

```json
{
  "mcpServers": {
    "echo": { "url": "http://localhost:6280/s/echo/mcp" }
  }
}
```

### Visual Studio Code

Add the server to `.vscode/mcp.json`:

```json
{
  "servers": {
    "echo": { "type": "http", "url": "http://localhost:6280/s/echo/mcp" }
  }
}
```

### A client that runs on another host

A client that runs on a remote host, such as a hosted chat product, can't reach
`localhost`. MCP Decoy serves plain HTTP, so put a tunnel in front of the MCP
port. Don't tunnel the UI port. For example, with
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```sh
cloudflared tunnel --url http://localhost:6280
```

Then give the client the tunnel URL with the server path appended, such as
`https://TUNNEL_HOST/s/echo/mcp`. In the UI, the tunnel button shows this
command with the right port.

### Check the connection

Each client connection is a session, identified by its `Mcp-Session-Id` header.
After the client connects, the server's live session count in the UI changes to
`1 live`. To close a session and test how your client recovers, use the
[REST API](#rest-api). Open the server and go to the **Logs** tab. The tab shows
the `initialize` request and response, followed by the requests that your client
sends next, such as `tools/list`. Call the `echo` tool from your client to see
the `tools/call` request and its response.

## Define a tool

A tool is what a client lists and calls on a server. Open a server in the UI and
go to the **Tools** tab to create one. A tool has the following fields:

- **Name**: the name that clients use in `tools/call`. The name is unique on the
  server.
- **Title**: an optional display name.
- **Description**: the text that clients, and the models behind them, read to
  decide when to call the tool.
- **Input schema**: a JSON Schema that describes the arguments. The schema must
  have `"type": "object"`.
- **Response template**: what the tool returns. See the following section.

A tool is either a draft or published, and clients see only published tools.
**Save draft** keeps a tool hidden while you work on it, and **Publish tool**
makes it visible. When you publish a tool, or edit, rename, unpublish, or delete
a published tool, MCP Decoy sends `notifications/tools/list_changed` to every
connected session. Changes to drafts send nothing. Use this notification to test
whether your client refreshes its tool list.

## Write a response template

A response template defines the result of a tool call. MCP Decoy renders the
template with [json-e](https://json-e.js.org/) on every `tools/call`, and the
output must be a valid MCP `CallToolResult`.

A template is JSON. Strings can interpolate values with `${...}`. The template
can read one variable: `args`, the `arguments` object of the call.

The following template returns a fixed sentence that includes an argument:

```json
{
  "content": [
    { "type": "text", "text": "Forecast for ${args.city}: 14°C, light rain" }
  ]
}
```

To insert a whole value instead of a string, use `$eval`. The following
template, which is the default for new tools, returns the arguments as JSON
text:

```json
{ "content": [{ "type": "text", "text": { "$json": { "$eval": "args" } } }] }
```

To vary the result, use json-e operators such as `$if`. The following template
returns a tool error when `city` is `Atlantis`:

```json
{
  "content": [
    {
      "type": "text",
      "text": {
        "$if": "args.city == 'Atlantis'",
        "then": "City not found: ${args.city}",
        "else": "Forecast for ${args.city}: 14°C, light rain"
      }
    }
  ],
  "isError": { "$eval": "args.city == 'Atlantis'" }
}
```

Keep the following rules in mind:

- json-e treats every object key that starts with `$` as an operator. To write a
  literal `$`, double it: `$$`.
- The UI checks the template while you type. It renders the template with empty
  arguments and reports only errors that no arguments can fix, such as a syntax
  error. Errors that depend on `args`, such as a missing property, appear when a
  client calls the tool.
- If a template fails to render, or the output isn't a valid `CallToolResult`,
  the tool call returns a result with `isError: true` and a text message that
  starts with `MCP Decoy: the response template of this tool failed to render.`

For the full operator list, see the
[json-e documentation](https://json-e.js.org/).

## Read the logs

The **Logs** tab lists every JSON-RPC message that the server sent or received,
including malformed requests and notifications. Each entry shows the direction,
the method, the session, and, on responses, the time since the matching request.

- Select an entry to see the exact JSON text.
- Filter with the search box. The filter is a case-insensitive substring match
  over the method and the raw message, and the entry count reflects the filter.
- Pause the live view to read without the list moving.
- Clear the logs of a server.
- Select **Export JSONL** to download the matching entries as newline-delimited
  JSON.

Logs live in memory only and are lost when MCP Decoy exits. MCP Decoy keeps the
newest 10,000 messages across all servers. To change the limit, use
`--log-limit`.

## Testing OAuth clients

Real MCP servers increasingly require OAuth 2.1, and that flow is where clients
break most. Switch a server to OAuth in its edit dialog, and MCP Decoy acts as
both the resource server and an authorization server for it: RFC 9728
protected-resource metadata, RFC 8414 discovery, Dynamic Client Registration,
PKCE, and RFC 8707 resource indicators, all handled by `@hono/mcp`'s
authorization-server router.

- Your client discovers the authorization server from the `401` challenge,
  registers (or uses the pre-registered client below), and opens MCP Decoy's
  consent page. **Approve** issues a code; **Deny** redirects the client with
  `error=access_denied`.
- Every server on OAuth also has one pre-registered confidential client, shown
  with its ID and secret in the server's OAuth pill. It authenticates with
  `client_secret_post` only — send `client_id` and `client_secret` in the token
  request body, not as `Authorization: Basic`. Give it redirect URIs to use it;
  with none, only Dynamic Client Registration works.
- Click **Revoke tokens** to invalidate every access and refresh token of a
  server. The client's next request gets a `401` and must re-authorize.
- The **Logs** tab interleaves OAuth HTTP exchanges with JSON-RPC traffic, so
  you can watch the whole handshake in one place.

OAuth state — registered clients, codes and tokens — lives in memory only, like
logs; a restart forgets it, though a server's pre-registered client survives in
`servers.json`.

The authorization server's issuer must be `https:`, or `http:` on `localhost` or
`127.0.0.1`. An MCP Decoy reachable only over plain HTTP on a LAN address (for
example, started with `--host 0.0.0.0`) can't host it. Point your client at
`localhost` instead, or put a tunnel in front of the MCP port (see "Need a
public URL?" next to the endpoint) and use the tunnel's HTTPS URL.

## Options

Pass options after the command, as in `mcp-decoy --mcp-port 7000`. The following
table lists them:

| Option                | Description                                                   | Default                                               |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `--mcp-port <port>`   | Port of the MCP listener.                                     | `6280`                                                |
| `--ui-port <port>`    | Port of the UI and API listener.                              | `6281`                                                |
| `--host <address>`    | Bind address of the MCP listener. The UI listener ignores it. | `127.0.0.1`                                           |
| `--config-dir <path>` | Directory that holds `servers.json`.                          | `$XDG_CONFIG_HOME/mcp-decoy` or `~/.config/mcp-decoy` |
| `--log-limit <n>`     | Messages kept in memory, across all servers. Minimum: `100`.  | `10000`                                               |
| `-h`, `--help`        | Print the usage text.                                         |                                                       |
| `-v`, `--version`     | Print the version.                                            |                                                       |

If a port is in use, MCP Decoy exits and names the option to change.

MCP Decoy supports one running instance per config directory. To run two
instances, give each its own `--config-dir` and ports.

## Where MCP Decoy stores data

MCP Decoy writes `servers.json` to the config directory after every change. The
file holds your servers and tools, so you can back it up, copy it to another
machine, or commit it. If the file is missing, MCP Decoy creates it with the
`echo` server. If the file is invalid, MCP Decoy doesn't start and prints the
file path and the problems.

While MCP Decoy runs, it also writes `runtime.json` to the same directory. The
file records the process ID and the listener URLs, and MCP Decoy removes it on
shutdown.

## REST API

The UI is a client of a REST API, and you can use the API too. It listens on the
UI port, under `/api/v1`. Requests and responses are JSON, and errors use
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details.

The following table lists the endpoints:

| Method and path                                | Description                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /servers`                                 | List servers.                                                           |
| `POST /servers`                                | Create a server.                                                        |
| `GET /servers/{server}`                        | Get a server.                                                           |
| `PATCH /servers/{server}`                      | Update a server. A new `name` moves the server and closes its sessions. |
| `DELETE /servers/{server}`                     | Delete a server and close its sessions.                                 |
| `GET /servers/{server}/tools`                  | List tools, drafts included.                                            |
| `POST /servers/{server}/tools`                 | Create a tool.                                                          |
| `GET /servers/{server}/tools/{tool}`           | Get a tool.                                                             |
| `PATCH /servers/{server}/tools/{tool}`         | Update a tool. Set `published` to publish or unpublish it.              |
| `DELETE /servers/{server}/tools/{tool}`        | Delete a tool.                                                          |
| `GET /servers/{server}/sessions`               | List live sessions.                                                     |
| `DELETE /servers/{server}/sessions/{session}`  | Close a session.                                                        |
| `DELETE /servers/{server}/oauth/tokens`        | Revoke every access and refresh token of a server on OAuth.             |
| `GET /servers/{server}/logs?q=&cursor=&limit=` | List log entries, newest first, with cursor pagination.                 |
| `DELETE /servers/{server}/logs`                | Clear the logs of a server.                                             |
| `GET /servers/{server}/logs/stream?after=&q=`  | Stream new log entries as server-sent events.                           |
| `GET /servers/{server}/logs/export`            | Download all entries as newline-delimited JSON.                         |

The following command publishes a draft tool named `get_forecast` on the
`weather` server:

```sh
curl -X PATCH http://localhost:6281/api/v1/servers/weather/tools/get_forecast \
  -H 'Content-Type: application/json' \
  -d '{"published": true}'
```

Every connected session receives `notifications/tools/list_changed`. The Zod
schemas in [src/shared/api/](src/shared/api/) define the request and response
bodies.

## Develop MCP Decoy

MCP Decoy needs Node.js 24 or later and [pnpm](https://pnpm.io/). Run the
following commands from a clone of the repository:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the server and Vite. Open `http://localhost:5173`, because the
Vite dev server proxies API requests to the server on port `6281`.

The following scripts run the same checks as CI:

| Script           | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm test`      | Run the Vitest unit and integration tests. |
| `pnpm typecheck` | Check types with `tsc -b`.                 |
| `pnpm lint`      | Run oxlint.                                |
| `pnpm format`    | Check formatting with oxfmt.               |
| `pnpm fix`       | Format and lint with automatic fixes.      |
| `pnpm build`     | Build the UI and the CLI into `dist/`.     |

After `pnpm build`, run `node dist/cli.js` to start the built package.

### Install the agent skills

The repository records the agent skills that AI coding assistants use when they
work on MCP Decoy, such as the Hono and React guidance, in `skills-lock.json`.
Git ignores the skills themselves, so a fresh clone doesn't contain them.

To install them, run the following command from the root of the repository:

```sh
npx skills update -p
```

The `-p` flag limits the command to project skills, so it leaves your global
skills alone. The command downloads each skill in `skills-lock.json` from its
source repository into `.agents/skills/` and links it into `.claude/skills/`.

The command installs the latest version of each skill, not the version that
`skills-lock.json` pins, and it updates the hashes in `skills-lock.json` to
match. Review the change with `git diff skills-lock.json` before you commit it.
