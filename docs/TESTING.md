# Testing checklist

Here's a hands-on checklist, in order. Each section builds on the one before.

While writing it I found a bug you'll hit in section 6. **If the server restarts
while the Logs tab is open, the live list stops updating until you reload the
page.** Log ids restart at 1 after a restart. The browser reconnects with the
old, higher id, and the page then drops every "new" entry as already seen.
`tsx watch` restarts the server on every file save, so this shows up often in
dev. I haven't fixed it yet.

## 0. Setup

- [x] Use the right Node (24+):

```bash
nvm use
```

- [x] Install dependencies:

```bash
pnpm install
```

- [x] Run the automated checks once (format, lint, types, tests). Expect 179
      passing tests:

```bash
pnpm fix && pnpm typecheck && pnpm test
```

## 1. Start the dev server

`pnpm dev` writes to your real config directory (`~/Library/Preferences/decoy`).
To keep test data out of it, run the two halves in separate terminals with a
scratch directory:

```bash
pnpm dev:server --config-dir /tmp/decoy-dev
```

```bash
pnpm dev:ui
```

- [x] The server terminal shows the Clack banner: the API URL, the MCP URL
      pattern, the config file path and "Servers: none yet". It has no UI line
      in dev, because Vite prints its own URL in the other terminal.
- [x] Open http://localhost:5173. The header shows "decoy v0.1.0" and a green
      dot with "Listening on localhost:6280".

## 2. Servers and New server

- [x] With no servers, the empty state shows an explanation and a **New server**
      button.
- [x] The footer shows the path to `/tmp/decoy-dev/servers.json`. The tunnel
      card shows the `cloudflared` and `ngrok` commands for port 6280.
- [x] Click **New server** and type `Weather`. An inline error appears and
      **Create server** is disabled.
- [x] Type `weather` instead. The endpoint preview and `serverInfo.name`
      (`decoy/weather`) follow what you type.
- [x] Add some instructions and click **Create server**. You land on the
      server's **Tools** tab.
- [x] Go back to New server and type `weather` again. "A server named “weather”
      already exists." appears and **Create server** is disabled.
- [x] On Servers, the table row shows the endpoint, the copy button (check that
      it copies the full `http://…` URL), "No tools" and a grey "0" pill.

## 3. Tools editor

- [x] Click **New**. A `new_tool` draft appears in the list with a **Draft**
      badge, and the editor shows **Publish tool**, **Save draft** and **Discard
      draft**.
- [x] Put invalid JSON in **Input schema** and click **Save draft**. You get an
      inline "Invalid JSON" error, and nothing is sent.
- [x] Set the input schema to `{"type":"string"}`. The error says it must have
      "type": "object".
- [x] Rename the tool to `get_forecast`, add a description, and set this
      response template:
      `{"content":[{"type":"text","text":"Forecast for ${args.city}"}]}`
- [ ] Click **Publish tool**. The badge turns **Published**, the URL becomes
      `/servers/<server>/tools/get_forecast`, and an orange warning reports
      `object has no property "city"`. That's expected: the trial render runs
      with empty arguments.
- [ ] Create a second tool and rename it to `get_forecast`. The conflict error
      appears under **Name**.
- [ ] Tick a few annotation checkboxes, click **Save changes**, and reload the
      page. The ticks are still there.
- [ ] **Discard draft** and **Delete tool** both open a confirmation dialog
      before deleting.

## 4. Connect a real MCP client

The MCP Inspector works well here. It uses ports 6274 and 6277, so it doesn't
clash with decoy.

```bash
npx @modelcontextprotocol/inspector
```

- [ ] Connect with transport **Streamable HTTP** to
      `http://localhost:6280/s/weather/mcp`.
- [ ] Within about 2 seconds, decoy's header and the Servers table show "1 live
      session".
- [ ] **List tools** shows only published tools: no drafts.
- [ ] Calling `get_forecast` with `{"city":"Paris"}` returns "Forecast for
      Paris".
- [ ] Calling it without `city` returns `isError: true` with a decoy template
      error. That's a tool result, not a protocol error.
- [ ] Publish a new tool in decoy while the Inspector stays connected. The
      Inspector receives `notifications/tools/list_changed`, and the new tool
      shows up when you list tools again, without reconnecting.
- [ ] Unpublish it. Another `list_changed` arrives and the tool disappears from
      the list.
- [ ] The editor's "Live, no restart · notifies 1 session on weather" line
      matches the session count.

## 5. Logs tab

- [ ] Rows read: time with milliseconds, a blue → or orange ← arrow, the method,
      a tag (request/result/notify/error), a short note, the JSON-RPC id, a
      short session id, and the duration on responses.
- [ ] The notes say: `initialize` shows the client name, `tools/list` results
      show "N tools", `tools/call` shows the tool name, and errors show the code
      and message.
- [ ] Click a row. The Negotiation card shows the client's requested version and
      capabilities next to the server's answer. The JSON panel shows the
      pretty-printed message.
- [ ] **Go to response** and **Go to request** jump between the two halves of a
      pair. **Copy JSON** copies the message.
- [ ] Type `tools/call` in search: the list filters as you type.
- [ ] Click **Pause**, then make a few calls from the Inspector. The list stays
      frozen and the button reads "Resume · N new". Click it and exactly those
      entries appear, with no duplicates.
- [ ] The newest message is at the top. Make calls: new rows appear at the top.
      Scroll down and make calls: your position stays put.
- [ ] **Export JSONL** downloads `decoy-weather-logs.jsonl`, with one JSON entry
      per line.
- [ ] **Clear** empties the list, including in a second browser tab that's open
      on the same server.
- [ ] **Search all** only appears when more than 500 entries exist. To create
      that many quickly (each request logs one entry in and one out), run this,
      then search:

```bash
for i in $(seq 1 260); do curl -s -X POST localhost:6280/s/weather/mcp -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":$i,\"method\":\"tools/list\"}" > /dev/null; done
```

## 6. Reconnects and restarts

- [ ] Stop the server terminal while the Logs tab is open. The footer changes to
      "reconnecting…".
- [ ] Start it again. The footer returns to "streaming", but **new entries won't
      appear until you reload**. This is the bug described at the top.
- [ ] The Inspector's next request gets a 404 because sessions don't survive a
      restart; reconnecting it works.
- [ ] Servers and tools are still there after the restart (they're read back
      from `servers.json`).

## 7. Edit a server

Do this with the Inspector still connected to `weather`, and a second server
named `echo` created (see section 2).

- [ ] On Servers, each row has an **Edit** link. It opens a dialog titled “Edit
      “weather””, filled with the server's name, `serverInfo.name`,
      `serverInfo.version` and instructions. **Save changes** is disabled until
      you change something.
- [ ] **Cancel**, **Escape** and a click on the backdrop all close the dialog
      without saving.
- [ ] Change only `serverInfo.version` to `2.0.0` and save. The dialog closes
      and `servers.json` has the new version. Nothing else changed, and the
      Inspector stays connected.
- [ ] Clear `serverInfo.version` and save. The error "Version is required"
      appears under that field, and the dialog stays open.
- [ ] Clear the instructions and save. `servers.json` no longer has an
      `instructions` key for `weather`.
- [ ] Type `echo` as the name. "A server named “echo” already exists." appears
      and **Save changes** is disabled. Typing `Bad Name` shows the slug error.
- [ ] Type `forecast` as the name. The endpoint preview follows and a note says
      renaming closes live sessions. Save.
- [ ] On Servers, the row now reads `forecast`, with the new endpoint.
- [ ] The Inspector's next request fails with a 404 (the old URL answers
      "Unknown server"). Reconnecting to the new URL works.
- [ ] Open `forecast` from the table. The Logs tab still holds the earlier
      messages, and the Tools tab still has your tools.
- [ ] On the server page, click **Edit server** in the header. The same dialog
      opens. Rename it back to `weather` from the Tools tab. The URL becomes
      `/servers/weather/tools` and you stay on the Tools tab.
- [ ] With an unsaved change in the tool editor, rename the server. Check what
      happens: the unsaved-changes prompt should appear before you leave.
- [ ] The `PATCH` endpoint works from `curl`, and a rename sends a `Location`
      header:

```bash
curl -i -X PATCH http://localhost:6281/api/v1/servers/weather \
  -H 'content-type: application/json' -d '{"name":"forecast"}'
```

## 8. Delete a server

- [ ] With the Inspector connected, click **Delete server** and confirm in the
      dialog. You land on Servers.
- [ ] The Inspector's next request fails with a 404.
- [ ] Open `http://localhost:5173/servers/weather/tools`. A "Server not found"
      page appears with a link back to Servers.
- [ ] Open a nonsense URL such as `/foo`. The "Page not found" page appears.

## 9. Config file

- [ ] Look at `/tmp/decoy-dev/servers.json`. It holds the servers and tools you
      created, with nothing sensitive in it.
- [ ] While decoy runs, `/tmp/decoy-dev/runtime.json` exists. Starting a second
      instance on the same directory prints "decoy is already running at …" and
      exits:

```bash
pnpm exec tsx --tsconfig tsconfig.server.json src/server/cli.ts --config-dir /tmp/decoy-dev --mcp-port 7280 --ui-port 7281
```

- [ ] Ctrl+C on the dev server prints "decoy stopped" and removes
      `runtime.json`.
- [ ] Break the file by hand (for example, set a server name to `Bad Name`) and
      start decoy again. It refuses to start and names the file and the
      offending field.

## 10. CLI flags

- [ ] `--help` prints usage and `--version` prints `0.1.0`:

```bash
pnpm exec tsx --tsconfig tsconfig.server.json src/server/cli.ts --help
```

- [ ] Bad values give readable errors, for example `--mcp-port 0`,
      `--log-limit 50` and `--nope`:

```bash
pnpm exec tsx --tsconfig tsconfig.server.json src/server/cli.ts --mcp-port 0 --log-limit 50 --nope
```

- [ ] With decoy running, starting another copy on the same MCP port fails fast
      and names `--mcp-port`.

## 11. Security checks (with the server running)

- [ ] A foreign `Host` gets a 403:

```bash
curl -i -H 'host: evil.example:6281' localhost:6281/api/v1
```

- [ ] A POST without a JSON content type gets a 415:

```bash
curl -i -X POST localhost:6281/api/v1/servers -d '{"name":"x"}'
```

- [ ] A POST from a foreign `Origin` gets a 403:

```bash
curl -i -X POST localhost:6281/api/v1/servers -H 'content-type: application/json' -H 'origin: http://evil.example' -d '{"name":"x"}'
```

- [ ] An unknown API route returns problem+json, not the SPA's `index.html`:

```bash
curl -i localhost:6281/api/v1/nope
```

## 12. Release build

Stop the dev processes first, because the release build uses the same ports.

- [ ] Build and start the release version:

```bash
pnpm build && node dist/cli.js --config-dir /tmp/decoy-release
```

- [ ] Open http://localhost:6281. Go to a server's Logs tab and press reload:
      the page still loads.
- [ ] Pack the package:

```bash
pnpm pack
```

- [ ] Then run it from an empty directory, passing the tarball as a relative
      path (an absolute path only works with a `file:` prefix):

```bash
mkdir -p /tmp/decoy-empty && cp decoy-0.1.0.tgz /tmp/decoy-empty/ && cd /tmp/decoy-empty && npx ./decoy-0.1.0.tgz --config-dir /tmp/decoy-npx
```

- [ ] Both ports come up and the UI works the same as in dev.
