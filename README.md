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

## Analytics

GA4 is enabled by default for the NextBrowser stream (`G-GH09J7KP5R`). Set
`VITE_GA4_MEASUREMENT_ID` only when you need to override the stream for a
specific build:

```sh
VITE_GA4_MEASUREMENT_ID=G-GH09J7KP5R npm run dev
```

In Google Analytics, find this value under **Admin → Property settings → Data
streams → Web stream → Stream details → Measurement ID**. The value starts with
`G-`. Events use a generated anonymous app instance ID and do not send API keys,
prompt text, target URLs, or page domains.

Production checks and packages:

```sh
npm run build
npm run pack
npm run dist:mac
npm run dist:win
```

Use `CLAWCTL_BIN`, `CLAUDE_BIN`, `CODEX_BIN`, and corresponding agent variables
to override platform-specific binary discovery.
