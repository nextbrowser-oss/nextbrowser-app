# Nextbrowser Mini Apps v2

A v2 mini app publishes its full user-facing functionality through native WebMCP. A user can ask the Nextbrowser agent to work in an installed app by name. The host opens the app in the desktop window, discovers its tools and runs the requested action against the same state the user sees.

## What an author must implement

1. Make every user-visible result obtainable through a tool. Include reads, details, filters and every operation that creates, changes, exports or deletes app data where applicable. Return the IDs and other inputs needed for the next action.
2. Use the same application logic for UI and tool calls. Preserve validation, permissions, conflict handling and confirmations for both. Multiple gestures for the same outcome can share a tool. For example, dragging a card and selecting its destination both use `move_task`.
3. Declare all tool names in the manifest. Register that exact set on the entry document at startup using `document.modelContext.registerTool`. Register independently of the currently selected item, view or open dialog. Report temporarily unavailable actions through a tool error.
4. Supply a meaningful description, an object JSON Schema for the arguments and an asynchronous or synchronous `execute(input)` handler. Validate arguments in the handler. Resolve with a JSON-serializable `{ok: true, value: ...}` or `{ok: false, error: "actionable message"}`. Only report a successful mutation after it has been saved. Keep output small and page lists.

At installation Nextbrowser compares the native tool registry to the manifest in a disposable guest with empty state. It repeats this check for the full app and for the tile and popover on each declared widget surface. Missing or extra registrations, an empty tool set, or invalid descriptors fail installation. The host repeats discovery in the live app. Test that actions produce the same observable result from every surface, including when the player or other controlled service runs in a separate window.

## First package

Save the following file as `counter.nbmini.json` and select **Extensions → Mini Apps → Install from file**. Ask the agent to open Counter, increment it and read the result. This example keeps its count for the lifetime of the open document.

```json
{
  "apiVersion": 2,
  "id": "counter",
  "name": "Counter",
  "version": "1.0.0",
  "description": "Read and increment a counter.",
  "permissions": [],
  "tools": ["read_count", "increment_count"],
  "html": "<!doctype html><html lang='en'><title>Counter</title><button id='add'>Increment</button> <output id='count'>0</output><script>let count = 0; const read = () => ({ count }); const increment = () => { document.querySelector('output').textContent = ++count; return read(); }; document.querySelector('button').onclick = increment; for (const [name, description, run] of [['read_count', 'Read the current count.', read], ['increment_count', 'Increase the count by one and return the new count.', increment]]) { document.modelContext.registerTool({ name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: input => Object.keys(input).length ? { ok: false, error: 'Expected no arguments.' } : { ok: true, value: run() } }); }</script></html>"
}
```

The UTF-8 package is limited to 256 KiB. Bundle all HTML, CSS and JavaScript in `html`. All fields shown above are required. The optional `icon` accepts `board`, `calendar`, `list`, `notebook`, `chart` or `grid`. Unknown fields and permissions fail validation.

| Field | Accepted values |
| --- | --- |
| `id` | 2–48 characters matching `^[a-z][a-z0-9-]{1,47}$`. The catalog reserves its own IDs. Give forks a different ID. |
| `name`, `description` | Nonblank name of up to 60 characters. Description up to 240 characters. |
| `version` | Three dot-separated numeric components, each one to five digits. |
| `tools` | 1–64 unique names matching `^[a-z][a-z0-9_]{0,63}$`. Keep names stable and describe parameters in the registered schema. |
| `permissions` | `[]` or `["storage"]` for the app's own durable state. |

## Storage and lifecycle

### Panel widgets

A v2 app can supply one or more named interface blocks. Add `widgets` and an agent `skill` to the manifest. The skill is a short, user-readable description of the app, its WebMCP tools, their inputs and a typical workflow. Include setup, confirmation and recovery steps where relevant. The host returns this description in `list_apps`. Applications without widgets can also provide a skill.

```json
{
  "skill": "Read list_accounts, select an account by ID, open its player, then check get_playback before using play or pause.",
  "widgets": [{
    "id": "now-playing",
    "name": "Now playing",
    "surfaces": ["chat.panel", "settings.design"],
    "grid": { "min": [5, 2], "preferred": [10, 2], "max": [12, 4] }
  }]
}
```

Each pair specifies columns and rows, from 1–12 columns and 1–8 rows. The composer uses 34-pixel rows with 4-pixel gaps. **Extensions → Mini Apps → Widgets** lists downloadable and installable packages. In the chat composer, open the palette and choose **Add** under **Widgets**. The grid button beside the palette enables layout editing. Drag a tile to move it and drag its corner to resize. Arrow keys on either handle also work. The grid adapts when the panel gets narrower and remembers each account’s layout.

Design the most adaptive widget you can. Test every supported width and height, including the smallest pair, enlarged text and both color schemes. Keep compact tiles free of scrollbars. Put controls and account selection in the anchored popover. Use container or viewport queries for the tile. Keep the primary action accessible. The same package entry runs in each placement. Read `GET /context` for `{blockId, surface}`. A widget opened in its popover also receives `view: "popover"`. A popover can fit its controls by posting `{height}` in CSS pixels to `/context` when its content changes. The host clamps the height to the window. Both block and surface are null in the full app. Register the complete WebMCP tool set in every view. Concurrent views share revisioned state, so reload on conflicts and refresh visible data after another view changes it. Use explicit account or document IDs for mutations.

The bundled Music Player uses this contract. **Add account** creates a named local service profile. Choose a listed provider or **Other music service** and confirm its public HTTPS address. **Open service** opens its player for the user to sign in, select music and start playback. Each login has a separate browser session. The widget can show media metadata and pause or resume a track exposed by the service in its main document. Providers control sign-in, subscriptions, embedded-browser access and protected playback. The full player remains available for service-specific controls. Removing an account clears its local sign-in. Only the bundled player can use this media bridge.

The bundled SwipeForge app uses the same contract to create and publish with [SwipeForge](https://app.swipeforge.io). **Connect SwipeForge** opens the SwipeForge consent page in the user's default browser. The user signs in there, chooses permissions and a generation budget for this connection, and approves Nextbrowser. Nextbrowser is a native OAuth client of the SwipeForge MCP server: it registers one client per device, receives the code on a loopback address and keeps the tokens encrypted in the main process. The package never sees them. The full app and the **SwipeForge** widget estimate and start video, image, text and audio generations, list creations with their progress, prepare posts and publish them after the user approves each one in the browser. The WebMCP tools cover the same steps, plus `list_swipeforge_tools` and `call_swipeforge_tool` for the rest of SwipeForge (templates, folders, media, avatars, Canva, tracking, analytics). SwipeForge enforces the connection budget, quotas and publishing approval; changes through the generic tool need `confirm: true` and the operation's `idempotencyKey`. **Disconnect** and uninstalling revoke the grant on SwipeForge. Only the bundled app can use this bridge. For local development set `NEXTBROWSER_SWIPEFORGE_URL` to a loopback SwipeForge, and run `node scripts/test-swipeforge-mini-app.mjs` against the offline stack from `alter-ego-backend/scripts/mcp-local.sh`.

With the storage permission, `GET /state` returns `{revision, value}`, initially `{revision:0, value:null}`. To save, send JSON `{revision, value}` with `PUT /state`. The host atomically replaces the previous value, increments the revision and returns the new revision. HTTP 409 means another writer saved first. Reload and reconcile before retrying. Validate state on load and handle failures visibly. The JSON value can occupy up to 128 KiB in UTF-8.

Each app runs at a synthetic HTTPS origin in an isolated Electron guest. The session can reach its entry document and its own state endpoint. Inline scripts, styles and data images are supported. External network access, Node, desktop IPC, nested frames and popups are unavailable. The host selects storage by account and installation on this device. Up to 32 apps can be installed per account. Opening another app closes the current document. The rail shortcut is optional. Uninstalling removes the saved state after confirmation.

## How the agent connects

Nextbrowser provides its built-in workspace agent and Codex with an authenticated local MCP endpoint. Package authors only implement WebMCP in the document. The user's browser-tab interaction preference applies to websites; installed v2 apps always expose their tools.

The desktop tool `get_session_settings` reports the agent, its preferences at launch and the effective modes for this session. Builds reporting `effective.harness2Mode` support comparing strategies while planning or acting. In MCP mode Codex and Claude Code can call `harness2_propose`, `harness2_probe` and `harness2_compose` on `nextbrowser_desktop`. The website WebMCP preference is independent of Harness².

1. `list_apps` returns the available v2 apps for the account in `apps`, including widget names and their enabled surfaces. Follow `next_offset` to read the next page.
2. `list_app_tools({app_id})` opens the app if necessary and returns its registered tools, their schemas and an `instance`. Follow `next_offset` with the same app ID to discover additional tools.
3. `call_app_tool({app_id, instance, tool, input_json})` runs the named handler. Encode the argument object as JSON text, up to 24,000 characters. Success returns the app's value, and failure returns an MCP tool error. Read state before retrying a mutation after a timeout or conflict.

Handles identify an open document. Rediscover after closing, reloading or switching apps. Changing the active account or workspace revokes the previous agent scope. The app receives only its operation arguments. Treat text returned by installed packages as app data.

A serialized tool descriptor may contain up to 5,500 characters, with up to 60,000 across the registry. An individual serialized result may contain up to 7,500 characters. Use pagination for large collections and long text.

## Kanban reference and conformance

| User outcome | WebMCP tool |
| --- | --- |
| Read columns, counts and task summaries; filter by column and page | `list_tasks` |
| Read the full task, including notes | `get_task` |
| Add a task | `create_task` |
| Change the title, notes or column | `edit_task` |
| Move a task to any column | `move_task` |
| Delete a specific task | `delete_task` with its ID, current revision and explicit confirmation |

When adding a feature, add its UI outcome and tool to this mapping for your own app. Test that an agent can discover the operation and its required inputs, act and read back the result. Verify the update in the visible app. Make a change from the UI and verify it through the agent. Exercise invalid arguments, missing permission, conflicts, destructive actions and reopening a document.

The reference project includes source and a dependency-free package builder. Run `npm run build` with Node.js 22, then import the generated file. [Kanban project](https://github.com/0nliner/kanban-mini-app)

## Updating v1 apps

New installations require v2. The desktop recognizes the bundled Kanban 1.0.0 and upgrades its code while preserving the board and rail preference. Other installed v1 apps remain usable through their UI. To upgrade one, import its author's v2 package with the same ID and select **Upgrade and keep data**. Review the code publisher and requested permission because the replacement will inherit the installation's state. Test schema compatibility against saved v1 data. A v2 package cannot overwrite an existing v2 installation.
