# MCP Decoy

MCP Decoy is a local tool that hosts mock MCP servers for debugging MCP clients.
You define tools in a web UI, connect your client to MCP Decoy, and watch every
JSON-RPC message that the client sends and receives.

MCP Decoy is the counterpart of the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector). The
Inspector is a client that connects to your server. MCP Decoy is a server that
your client connects to.

Use MCP Decoy when you build or debug an MCP client and need to answer questions
like the following:

- What does my client send during `initialize`, and what does it do with the
  server's response?
- Does my client refresh its tool list after `notifications/tools/list_changed`?
- How does my client handle a tool that returns `isError: true`, a long text
  result, or an unusual input schema?
- What does a hosted client, such as a chat product that connects to remote MCP
  servers, send to my server?
- Does my client complete an OAuth 2.1 authorization flow?

You can change tools while the client stays connected. MCP Decoy doesn't
restart, and your client doesn't reconnect.

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

The output is similar to the following. The version and the config path differ
on your machine.

```text
┌  MCP Decoy v1.2.0
│
◆  UI        http://localhost:6281
│
●  API       http://localhost:6281/api/v1
│
●  Config    /home/dana/.config/mcp-decoy/servers.json
│
●  Servers
│    echo  http://localhost:6280/s/echo/mcp
│
│  Press Ctrl+C to stop.
```

MCP Decoy hosts mock MCP servers, called servers in this document. Each server
has its own tools, logs, and URL. One MCP Decoy process hosts any number of
servers. By default, MCP Decoy listens on port `6280` for MCP clients and on
port `6281` for the UI and the API.

If the config directory has no `servers.json`, MCP Decoy creates one server
named `echo` with one published tool, also named `echo`. The tool returns its
`message` argument. Open the UI URL from the output to manage servers and tools.

## Connect your MCP client

Every server has its own URL, `http://localhost:6280/s/SERVER_NAME/mcp`. MCP
Decoy supports the Streamable HTTP transport, so give your client that URL and
select an HTTP transport. The following examples connect to the default `echo`
server on the default MCP port. To change the port, see [Options](#options).

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

### Connect a client on another host

A client that runs on a remote host, such as a hosted chat product, can't reach
`localhost` on your machine. MCP Decoy serves plain HTTP, so put a tunnel in
front of the MCP port, `6280` by default.

Don't tunnel the UI port. The UI listener rejects any `Host` header other than
`localhost` or `127.0.0.1`, so a tunnel to it returns `403 Forbidden`.

To expose the MCP port, run a quick tunnel with
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```sh
cloudflared tunnel --url http://localhost:6280
```

Give the client the tunnel URL with the server path appended:
`https://TUNNEL_HOST/s/echo/mcp`. Replace `TUNNEL_HOST` with the host name that
`cloudflared` prints. In the UI header, select **Need a public URL?** to see
this command with your MCP host and port, and a button that copies it.

### Check the connection

Each client connection is a session. The server assigns the session an ID, and
the client sends it in the `Mcp-Session-Id` header. To check that your client
connected, take the following steps:

1. In the UI, open the **Servers** page. After the client connects, the
   **Sessions** column of its server shows `1 live`.
2. Select the server, and then select the **Connections** tab. The **Sessions**
   section lists each session with the client name, the client version, and the
   session ID.
3. Select the **Logs** tab. It shows the `initialize` request and its response,
   followed by the requests that your client sends next, such as `tools/list`.
4. Call the `echo` tool from your client. The **Logs** tab shows the
   `tools/call` request and its response.
5. Optional: To test how your client recovers from a closed session, go to the
   **Connections** tab and click **Close** on the session's row. You can also
   close a session with the `DELETE /servers/{server}/sessions/{session}`
   endpoint of the [REST API](#rest-api).

## Define a tool

A tool is what a client lists and calls on a server. To create one, open a
server in the UI, go to the **Tools** tab, and click **New tool**. A tool has
the following fields:

- **Name**: the name that clients use in `tools/call`. The name is unique on the
  server and contains 1-128 letters, digits, underscores, dashes, or dots.
- **Title**: an optional display name.
- **Description**: the text that clients, and the models behind them, read to
  decide when to call the tool.
- **Input schema**: a valid JSON Schema that describes the arguments, with
  `"type": "object"`. MCP Decoy doesn't validate call arguments against it.
- **Annotations**: the `readOnlyHint`, `destructiveHint`, and `openWorldHint`
  checkboxes. Clients receive them in `tools/list`.
- **Response template**: what the tool returns. See
  [Write a response template](#write-a-response-template).

A tool is either a draft or published, and clients see only published tools. A
new tool starts as a draft. **Save draft** keeps a tool hidden while you work on
it, and **Publish tool** makes it visible. On a published tool, **Save changes**
updates it and **Unpublish** hides it again.

MCP Decoy sends `notifications/tools/list_changed` to every connected session of
the server in the following cases:

- You publish a tool.
- You edit, rename, unpublish, or delete a published tool.

Changes to a draft don't send a notification. Use these notifications to test
whether your client refreshes its tool list.

## Write a response template

A response template defines the result of a tool call. MCP Decoy renders the
template with [json-e](https://json-e.js.org/) on every `tools/call`, and the
output must be a valid MCP `CallToolResult`.

A template is JSON. Strings can interpolate values with `${...}`. The only
variable that MCP Decoy provides is `args`, the `arguments` object of the call.
json-e also provides built-in functions and the `now` variable.

The following examples assume an input schema with a string property named
`city`.

The following template returns a sentence that includes an argument:

```json
{
  "content": [
    { "type": "text", "text": "Forecast for ${args.city}: 14°C, light rain" }
  ]
}
```

To insert a value instead of text, use `$eval`. To convert a value to JSON text,
use `$json`. The following template, which is the default for new tools, returns
the arguments as JSON text:

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

The following rules apply:

- json-e treats every object key that starts with `$` as an operator. To use a
  key that starts with a literal `$`, double it: `$$name` becomes `$name`.
- In a string, `$` is literal unless `{` follows it. To write a literal `${`,
  write `$${`.
- The UI checks the template while you type. It renders the template with empty
  arguments and reports only errors that no arguments can fix, such as a syntax
  error. Errors that depend on `args`, such as a missing property, appear when a
  client calls the tool. The UI doesn't check that the output is a valid
  `CallToolResult`. That check runs when a client calls the tool.
- If a template fails to render, or the output isn't a valid `CallToolResult`,
  the tool call returns `isError: true` and a text message. The message starts
  with `MCP Decoy: the response template of this tool failed to render.` and
  continues with the error details, one per line.

For the full operator list, see the
[json-e documentation](https://json-e.js.org/).

## Read the logs

The **Logs** tab records everything that reaches the MCP listener for the
server, on two layers:

- The **http** layer has one entry for each HTTP request, including OAuth
  requests and event streams. MCP Decoy doesn't log `OPTIONS` preflight
  requests.
- The **mcp** layer has one entry for each JSON-RPC message, including
  notifications and malformed bodies. A request and its response share one
  entry.

Each entry shows the time, the layer, the kind, the name, the status, a short
summary, the session, and how long the exchange took.

In the **Logs** tab, you can do the following:

- Select an entry to open its details: the headers, the query parameters, and
  the pretty-printed JSON of each message, with a button that copies it. The
  details link an `mcp` entry to the `http` entry that carried it.
- Type in the search box to filter. The filter is a case-insensitive substring
  match over the method, the URL, the headers, and the bodies. The entry count
  reflects the filter.
- Click **Pause** to read without the list moving, and **Resume** to catch up.
- Click **Clear** to delete the entries of the server.
- Click **Export JSONL** to download every entry of the server as
  newline-delimited JSON, whatever the filter.

MCP Decoy keeps logs in memory only, so they're gone when MCP Decoy exits. The
buffer holds the newest 10,000 log records across all servers. A log record is
one HTTP exchange, one JSON-RPC message, or the end of an event stream, so a
single tool call over HTTP uses at least three records. When the buffer is full,
MCP Decoy drops the oldest records first. To change the limit, use
`--log-limit`.

## Test an OAuth client

A server can require OAuth 2.1, so you can test how your client discovers an
authorization server, registers, asks for consent, and handles tokens. MCP Decoy
acts as both the resource server and the authorization server. It supports the
following standards:

- Protected Resource Metadata
  ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728))
- Authorization Server Metadata
  ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414))
- Dynamic Client Registration
- Proof Key for Code Exchange (PKCE), with the `S256` method only
- Resource Indicators ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). The
  authorization request must include `resource`.

### Turn on OAuth

In the **Connections** tab of the server, turn on the switch in the **OAuth**
section. You can also select **OAuth 2.1** under **Authentication** when you
create or edit the server.

Turning OAuth on generates a client ID and a client secret for the
pre-registered client. Turning OAuth off asks for confirmation, then deletes
those credentials.

### Authorize a client

The handshake has the following steps:

1. The client sends a request without a token. MCP Decoy answers `401` with a
   `WWW-Authenticate` header that points to the protected-resource metadata.
2. The client reads the metadata to find the authorization server, then
   registers itself or uses the pre-registered client.
3. The client sends the browser to the MCP Decoy consent page. Click **Approve**
   to redirect the browser to the client's redirect URI with an authorization
   code. Click **Deny** to redirect with `error=access_denied`.
4. The client exchanges the code for tokens and retries the request with the
   access token.

To watch the whole handshake, open the **Logs** tab. It lists the OAuth HTTP
requests together with the JSON-RPC messages.

Access tokens expire after one hour. Refresh tokens don't expire, and each
refresh issues a new token pair.

### Use the pre-registered client

Each server on OAuth has one pre-registered client that has a secret. The
**OAuth** section of the **Connections** tab shows its client ID and secret.

The client works only after you add redirect URIs in the **Redirect URIs** field
of the same section and click **Save redirect URIs**. With no redirect URIs,
only Dynamic Client Registration works.

The client authenticates with `client_secret_post`. Send `client_id` and
`client_secret` in the body of the token request. MCP Decoy doesn't support
`Authorization: Basic`.

### Revoke tokens

The **Tokens** section of the **Connections** tab lists every live access and
refresh token with its client, scopes, and expiry. Use the following buttons:

- **Revoke** on a row invalidates one token.
- **Revoke all** invalidates every token of the server.

After you revoke an access token, the client's next request gets a `401`, and
the client must authorize again. If you revoke only a refresh token, the access
token stays valid, and the refresh request fails.

Changing the redirect URIs, turning OAuth on, and turning OAuth off also revoke
every token and close the live sessions of the server.

### Use HTTPS or a public URL

MCP Decoy builds the issuer from the address that your client uses to reach the
MCP port. The issuer must use `https:`, or `http:` with the host `localhost` or
`127.0.0.1`. A client that connects over plain HTTP to a LAN address, such as
when you start MCP Decoy with `--host 0.0.0.0`, can't complete OAuth.

Use a `localhost` URL, or put a tunnel in front of the MCP port and use the
HTTPS URL of the tunnel. For the command, see
[Connect a client on another host](#connect-a-client-on-another-host).

### OAuth state and restarts

MCP Decoy keeps OAuth state in memory only, like the logs. A restart discards
registered clients, authorization codes, and tokens, so clients must register
and authorize again. The pre-registered client persists in `servers.json`,
including its secret.

## Options

Pass options after the command, as in `mcp-decoy --mcp-port 7000`. The following
table lists the options:

| Option                | Description                                                                                      | Default                                               |
| --------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `--mcp-port <port>`   | Port of the MCP listener.                                                                        | `6280`                                                |
| `--ui-port <port>`    | Port of the UI and API listener.                                                                 | `6281`                                                |
| `--host <address>`    | Bind address of the MCP listener. The UI listener always binds `127.0.0.1`.                      | `127.0.0.1`                                           |
| `--config-dir <path>` | Config directory, which holds `servers.json` and `runtime.json`. MCP Decoy creates it if needed. | `$XDG_CONFIG_HOME/mcp-decoy` or `~/.config/mcp-decoy` |
| `--log-limit <n>`     | Log records kept in memory, across all servers. The minimum is `100`.                            | `10000`                                               |
| `-h`, `--help`        | Print the usage text.                                                                            | None                                                  |
| `-v`, `--version`     | Print the version.                                                                               | None                                                  |

If `XDG_CONFIG_HOME` isn't an absolute path, MCP Decoy ignores it and uses
`~/.config/mcp-decoy`.

If a port is in use, MCP Decoy exits and names the option to change.

Each config directory supports one running instance. If you start a second
instance with the same config directory, MCP Decoy exits and prints the URL and
the process ID of the running one. To run two instances, give each its own
`--config-dir` and ports.

## Where MCP Decoy stores data

MCP Decoy writes `servers.json` to the config directory after every change. The
file holds your servers, their tools, and the pre-registered OAuth client of
each server that uses OAuth, including its client secret. You can back it up or
copy it to another machine. Before you commit it, remove the `auth` entries or
confirm that the secrets are throwaway test values.

If the file is missing, MCP Decoy creates it with the `echo` server. If the file
is invalid, MCP Decoy doesn't start and prints the file path and the problems.

While MCP Decoy runs, it also writes `runtime.json` to the same directory. The
file records the process ID, the version, the start time, the API URL, and the
MCP URL pattern. MCP Decoy uses it to detect a second instance, and removes it
when it shuts down cleanly.

## REST API

The UI uses a REST API that you can call too. The API listens on the UI port,
under `/api/v1`. Request and response bodies are JSON, except for the log stream
and the log export, and errors use
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details.

The API accepts only requests addressed to `localhost` or `127.0.0.1` on the UI
port. A `POST` or `PATCH` request must send `Content-Type: application/json`,
and a browser request must come from the UI's own origin. Otherwise, the API
answers `415` or `403`.

The paths in the following table are relative to `/api/v1`. Replace `{server}`,
`{tool}`, `{session}`, `{token}`, and `{id}` with the name or ID of the
resource.

| Method and path                                           | Description                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /`                                                   | Get the version, listener ports, MCP URL template, and config file path.    |
| `GET /servers`                                            | List servers.                                                               |
| `POST /servers`                                           | Create a server.                                                            |
| `GET /servers/{server}`                                   | Get a server.                                                               |
| `PATCH /servers/{server}`                                 | Update a server. A new `name` moves the server and closes its sessions.     |
| `DELETE /servers/{server}`                                | Delete a server and close its sessions.                                     |
| `GET /servers/{server}/tools`                             | List tools, drafts included.                                                |
| `POST /servers/{server}/tools`                            | Create a tool.                                                              |
| `GET /servers/{server}/tools/{tool}`                      | Get a tool.                                                                 |
| `PATCH /servers/{server}/tools/{tool}`                    | Update a tool. Set `published` to publish or unpublish it.                  |
| `DELETE /servers/{server}/tools/{tool}`                   | Delete a tool.                                                              |
| `GET /servers/{server}/sessions`                          | List live sessions.                                                         |
| `DELETE /servers/{server}/sessions/{session}`             | Close a session.                                                            |
| `GET /servers/{server}/oauth/tokens`                      | List the live access and refresh tokens of a server that uses OAuth.        |
| `DELETE /servers/{server}/oauth/tokens`                   | Revoke every access and refresh token of a server that uses OAuth.          |
| `DELETE /servers/{server}/oauth/tokens/{token}`           | Revoke one token, by the `id` that the list returns.                        |
| `GET /servers/{server}/logs?q=&carriedBy=&cursor=&limit=` | List log entries, newest first, with cursor pagination.                     |
| `GET /servers/{server}/logs/{id}`                         | Get one log entry by its numeric `id`.                                      |
| `DELETE /servers/{server}/logs`                           | Clear the logs of a server.                                                 |
| `GET /servers/{server}/logs/stream?after=&q=`             | Stream log events as server-sent events. Pass `after` to replay from an ID. |
| `GET /servers/{server}/logs/export`                       | Download all entries as newline-delimited JSON.                             |

The following command publishes a draft tool named `get_forecast` on the
`weather` server:

```sh
curl -X PATCH http://localhost:6281/api/v1/servers/weather/tools/get_forecast \
  -H 'Content-Type: application/json' \
  -d '{"published": true}'
```

MCP Decoy sends `notifications/tools/list_changed` to every live session of the
`weather` server.

The Zod schemas in [src/shared/api/](src/shared/api/) define the request and
response bodies.

## Develop MCP Decoy

MCP Decoy needs Node.js 24 or later and [pnpm](https://pnpm.io/). Run the
following commands from a clone of the repository:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the server and Vite. Open `http://localhost:5173`. In
development, only Vite serves the UI, and it proxies API requests to the server
on port `6281`. MCP Decoy also stores its data in `.mcp-decoy/` in the
repository, instead of the default config directory.

The following scripts run the same checks as CI:

| Script           | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm format`    | Check formatting with oxfmt.               |
| `pnpm lint`      | Run oxlint. Warnings fail the run.         |
| `pnpm typecheck` | Check types with `tsc -b`.                 |
| `pnpm test`      | Run the Vitest unit and integration tests. |
| `pnpm build`     | Build the UI and the CLI into `dist/`.     |

The following scripts help while you work:

| Script               | Description                            |
| -------------------- | -------------------------------------- |
| `pnpm fix`           | Format and lint with automatic fixes.  |
| `pnpm format:fix`    | Format with oxfmt.                     |
| `pnpm lint:fix`      | Run oxlint with automatic fixes.       |
| `pnpm test:watch`    | Run Vitest in watch mode.              |
| `pnpm test:coverage` | Run Vitest with a coverage report.     |
| `pnpm start`         | Run the built CLI, `node dist/cli.js`. |

After `pnpm build`, run `pnpm start` to start the built package.

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

The command installs the latest version of each skill from its source
repository, not the content that `skills-lock.json` recorded. It updates the
hashes in `skills-lock.json` to match. Review the change with
`git diff skills-lock.json` before you commit it.
