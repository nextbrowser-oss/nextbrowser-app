# Profile start page

The bundled React entry `start.html` replaces the former `data:` document when
Live opens a blank, verification, or older Nextbrowser start page. Existing
ordinary tabs are preserved. It does not override the browser's new-tab setting.

- Search opens a URL or Google search in the current profile.
- Ask your agent opens an editable draft in the profile's associated chat. It
  never sends a message or starts an agent run automatically.
- Pinned sites are stored per workspace, runtime and browser profile. They can
  be reordered by dragging or with the shortcut menu.
- Continue cards use actual conversations associated with this profile.
- Connection details distinguish recorded exit identity from configured country.
  Refresh updates browser status; it does not rotate the proxy.

## Local delivery

Electron serves compiled public assets and a small API on a random loopback port.
An unguessable token scopes each page to one renderer, workspace and profile.
Data reads and writes recheck authentication and ownership in the desktop store.
Writes require the same origin, JSON and a custom header; foreign origins,
spoofed hosts, arbitrary files and unsafe shortcut URLs are rejected. Browser
pages receive no Electron preload, API keys or proxy credentials.

ClawBrowser deliberately proxies loopback destinations. For Chromium runtimes,
`start-page-transport.cjs` fulfils only this start-page origin through the local
CDP connection, forwarding it to the same authorization-enforcing HTTP server.
It covers existing and new page targets. Other websites are untouched and
continue through the configured profile proxy. Proxy bypass rules are never
changed. Camoufox uses its native loopback handling.

## Checks

Build first, then run:

```sh
node --test electron/start-page-server.test.cjs
node scripts/test-start-page.mjs
node scripts/test-start-page-transport.mjs
```

The transport test reproduces loopback HTTP 403 through a local refusing proxy,
then checks local page delivery, draft actions, new tabs, scope revocation, and
that ordinary website requests still reach that proxy. UI tests use temporary
storage and cover shortcut persistence/reordering, search, themes and mobile
layout. `CHROME_BIN` selects a test browser executable.
