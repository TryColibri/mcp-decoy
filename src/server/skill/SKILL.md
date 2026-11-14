---
name: mcp-decoy
description:
  MCP Decoy is a local mock MCP server with a REST API, for debugging MCP
  clients (the code that connects to servers, not a server). Use it whenever the
  user is building or fixing an MCP client, agent host or SDK integration and
  needs to see what the client really sends, reproduce a client bug, or test how
  it handles tool-list changes (`list_changed`), tool errors (`isError`), odd
  schemas, huge results, closed sessions, or OAuth 2.1 (discovery, registration,
  refresh, revoked tokens). Reach for it even if the user doesn't name it, for
  example "my client never shows tools I add" or "what is my client sending".
---

# MCP Decoy

MCP Decoy hosts mock MCP servers that the client under test connects to. You
shape them through a REST API while the client runs, and read a log of every
HTTP request and JSON-RPC message. Use that log as ground truth about the
client.

- Clients connect to `http://localhost:6280/s/{server}/mcp` (Streamable HTTP).
- You call the API at `http://localhost:6281/api/v1`. `GET /api/v1` returns the
  real ports and URL template. Use `localhost`: other `Host` values get `403`.
- Not running? Start it in the background and keep the PID:
  `npx -y @hodor-ai/mcp-decoy --config-dir "$(mktemp -d)" > /tmp/decoy.log 2>&1 & echo $! > /tmp/decoy.pid`
  (`--mcp-port` and `--ui-port` change the ports; Node 24+). Stop it with
  `kill "$(cat /tmp/decoy.pid)"`, never `pkill -f`: other instances may be
  running.

## API in one screen

Resources: `/servers`, `/servers/{s}/tools`, `/servers/{s}/clients`,
`/servers/{s}/logs`, `/servers/{s}/oauth/tokens`. Standard REST verbs. `POST`
and `PATCH` need `Content-Type: application/json`. Error bodies list every bad
field in `errors[]`, so trust them and fix what they say.

```sh
curl -X POST $API/servers -H 'Content-Type: application/json' -d '{"name":"debug"}'   # returns mcpUrl
curl -X POST $API/servers/debug/tools -H 'Content-Type: application/json' -d '{
  "name":"get_forecast","published":true,
  "inputSchema":{"type":"object","properties":{"city":{"type":"string"}}},
  "responseTemplate":{"content":[{"type":"text","text":"Forecast for ${args.city}"}],
                      "isError":{"$eval":"args.city == '"'"'Atlantis'"'"'"}}}'
```

`responseTemplate` is a [json-e](https://json-e.js.org/) template rendered on
each call, with `args` as the only variable. The result must be a valid
`CallToolResult`.

## What you can't guess

- **New tools are drafts** and clients can't see them. Send `"published": true`.
- Publishing, editing, renaming or deleting a published tool sends
  `notifications/tools/list_changed`. It reaches the client only over a
  `GET /mcp` event stream the client opened (2025-11-25), or a
  `subscriptions/listen` stream (2026-07-28). In the log, `carriedBy: null` on
  that notification means it was never delivered, so the client has no stream.
- Decoy never validates call arguments against `inputSchema`.
- `GET /servers/{s}/clients` lists every client, whatever protocol generation it
  speaks (`era`: `legacy` is a 2025-11-25 session, `modern` is a 2026-07-28
  stateless client keyed `oauth:<client_id>` or `info:<name>/<version>`).
  `DELETE /servers/{s}/clients/{id}` (percent-encode the id) makes a legacy
  client's next request fail with `404` and `-32001 Session not found`; a
  correct client re-initializes. For a modern client it forgets it and ends its
  `subscriptions/listen` streams. Logs carry the same id in `client`; filter
  with `?client=`.
- `protocol.eras` on `POST`/`PATCH /servers` picks the generations a server
  accepts: `both` (default), `legacy` (2025-11-25 only: a `server/discover`
  probe gets an error, so use it to **force a client to fall back** to
  `initialize`) or `modern` (2026-07-28 only: `initialize` gets `-32022`, so use
  it to **reject legacy** clients; sessions are closed). `protocol.cache`
  (`ttlMs`, `scope`: `private` or `public`) is the cache hint on 2026-07-28
  `tools/list` and `server/discover` results.
- A failed template becomes an `isError` result starting with `MCP Decoy:` and
  is not a client bug.
- Reading the log: `GET /servers/{s}/logs` lists entries, newest first. `mcp`
  entries pair a request with its reply, and `carriedBy` is the id of the `http`
  entry (headers, status) that carried it. `?q=` filters by substring.
  `DELETE .../logs` clears it, so do that before each experiment.
- OAuth: `PATCH /servers/{s}` with `{"auth":{"mode":"oauth"}}`. The consent page
  is a plain form: `GET` the authorize URL, then `POST /consent/{id}` with
  `decision=approve` on the MCP port, and follow the `302` `Location`. Revoke
  with `DELETE .../oauth/tokens/{id}` (list them first) to test refresh. Any
  client may request `scope=mcp`, even one that registered without `scope`, plus
  the scopes it registered with. Anything else gets `invalid_scope`.
  `clientScopes` in `auth` sets the pre-registered client's scopes. Omitted
  `auth` fields keep their value.

## Working method

Create your own server instead of editing existing ones, since the user may rely
on them. Change one thing, make the client act, read the log, and compare what
the client did with the spec. Delete your server when you're done.
