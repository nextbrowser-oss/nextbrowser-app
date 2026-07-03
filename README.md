# NextBrowser

Cross-platform Electron desktop agent console for macOS and Windows. It provides
the complete ClawDesk workflow with official NextBrowser branding.

## Features

- API-key login and automatic credential discovery through `clawctl`
- proxy usage/history, profiles, sessions, rotation and country selection
- complete multi-agent catalog, authorization, login checks and streamed runs
- isolated persisted conversations, queue management, editing, cancellation and forks
- scheduled runs, onboarding, guide, official skills and private custom scripts
- deterministic browser/session preflight and interactive CDP Live view
- macOS DMG and Windows NSIS packaging through GitHub Actions

All browser operations go through `clawctl`; the desktop app does not duplicate
the service API client.

The product mark is the official asset published by [NextBrowser](https://www.nextbrowser.com).

## Development

```sh
npm ci
npm test
npm run dev
```

Production checks and packages:

```sh
npm run build
npm run pack
npm run dist:mac
npm run dist:win
```

Use `CLAWCTL_BIN`, `CLAUDE_BIN`, `CODEX_BIN`, and corresponding agent variables
to override platform-specific binary discovery.
