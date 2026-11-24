# Nextbrowser Mini Apps v1

Mini apps are single-page web applications that users can install in the desktop client. Open **Mini Apps** in the rail, choose **Install** in the catalog, review the permissions, and confirm. Each installed app gets a button beside **Catalog**. The host closes the current guest when you switch apps or leave Mini Apps. Save edits before reporting success to the user.

**Download package** saves the catalog entry as a portable file. **Install from file** accepts packages written by other authors. Inspect the name, app ID and permissions before installation. A display name or ID is author-supplied and does not authenticate a publisher. The v1 catalog ships with the desktop release and works offline. Account-specific installs and their data live on this device. Uninstall deletes both after confirmation.

## Build your first app

Copy the standalone [Kanban project](../examples/kanban-mini-app/) to a new directory. Change the ID and name in `manifest.json`. Edit the HTML, CSS and JavaScript, then run `npm run build` in that directory with Node.js 22. Import the resulting `<id>.nbmini.json` through **Install from file**. Authors can share that file directly. Frameworks may also generate the HTML provided that the final document includes all its scripts and styles.

Here is a complete package that needs no build step. Save it as `hello-board.nbmini.json` and import it.

```json
{
  "apiVersion": 1,
  "id": "hello-board",
  "name": "Hello Board",
  "version": "1.0.0",
  "description": "My first mini app.",
  "permissions": [],
  "html": "<!doctype html><html lang='en'><meta charset='utf-8'><title>Hello Board</title><h1>Hello, Nextbrowser!</h1></html>"
}
```

## Package contract

The UTF-8 JSON file is limited to 256 KiB. All seven fields above are required. Unknown fields, permissions and API versions are rejected. The ID matches `^[a-z][a-z0-9-]{1,47}$`. The display name is 1–60 characters, the description at most 240, and the version has three numeric components with up to five digits each. Provide a nonempty HTML string. Allowed permission sets are `[]` and `["storage"]`. A user can install up to 32 apps per account. An occupied ID cannot be overwritten. Use a distinct development ID for testing new builds. Replacing a v1 installation requires uninstalling it and deletes its state.

## State API

The catalog reserves its own package IDs. Importing an exact copy of a catalog package is supported. Give modified copies a new ID before installation.

With the `storage` permission, fetch the relative URL `/state` inside the mini app. The desktop host selects the storage namespace from the guest session. A package cannot supply a file path, account, workspace, or target app ID. The initial response is `{"revision":0,"value":null}`. The value may be any JSON value up to 128 KiB encoded in UTF-8.

```js
const snapshot = await (await fetch('/state')).json();
const response = await fetch('/state', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ revision: snapshot.revision, value: { cards: [] } })
});
if (response.status === 409) {
  // Reload the latest snapshot and reconcile the user's edit.
} else if (response.ok) {
  const { revision } = await response.json();
  // Store this revision for the next edit.
} else {
  // Keep the unsaved edit available and show a save error.
}
```

A successful save atomically replaces the previous value and increments the revision. The host rejects stale writes with HTTP 409. Missing permission returns 403, an unsupported storage method 405, and malformed or oversized writes 400. Removal revokes access. Serialize updates within the UI, render persisted user text as text, and handle save failures before closing an editor.

## Execution environment

The desktop host creates a sandboxed Electron guest in a dedicated in-memory session. It serves the entry document and state endpoint locally at a synthetic HTTPS origin. Ship inline CSS and JavaScript, and use data URLs for images. External scripts, remote HTTP requests, popups, guest downloads, nested frames and navigation to other pages are blocked. Desktop IPC, Node.js, browser profile control, credentials and the shell's store are outside the v1 API. Chromium session storage is temporary. Use `/state` for durable data. Keep destructive confirmations inside your UI using an HTML dialog or inline controls.

For an offline development cycle, rebuild and import under a new ID or remove your disposable test installation first. Test with a second app installed and after a full desktop restart. See the [reference app](../examples/kanban-mini-app/) and [desktop smoke test](../scripts/test-mini-apps.mjs).
