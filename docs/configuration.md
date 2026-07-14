# Configuration and repository development

[Back to README](../README.md) · [Product guide](product-guide.md) · [Troubleshooting](troubleshooting.md)

This repository contains the runnable Nextbrowser desktop application built with Electron, React, TypeScript, and Vite.

## Repository boundaries

| Path | Purpose |
| --- | --- |
| <code>src/</code> | React UI, application state, agent adapters, browser-session control, analytics, and tests. |
| <code>electron/</code> | Electron main process, preload bridge, process execution, persistence, updates, and SSH configuration discovery. |
| <code>scripts/</code> | Icon generation, release-version synchronization, and documentation validation. |
| <code>build/</code> | Desktop icons and macOS entitlements used by Electron Builder. |
| <code>docs/</code> | Product, browser-control, configuration, troubleshooting, and translated README documentation. |
| <code>.github/</code> | CI, release automation, Issue Forms, and pull-request guidance. |

Desktop source and release automation are maintained in this repository.

## Application setup

Use the current [product documentation](https://docs.nextbrowser.com/) and the setup flow included with the installed release to configure the browser environment, local agent, and API key. Restart Nextbrowser after changing a runtime or agent path.

Do not commit an API key, place it in a reusable prompt, or paste it into an issue. Redact credentials, account identifiers, cookies, tokens, private URLs, and personal data before sharing diagnostics.

## Local state

| State | Owner |
| --- | --- |
| Browser account and profiles | Browser environment configured for the installed release. |
| Browser sessions | Browser runtime selected by Nextbrowser. |
| Conversations and schedules | Nextbrowser application data. |
| Custom scripts | Nextbrowser application data and skill synchronization. |
| Agent skills | Agent-specific skill or plugin directories. |
| Application update state | Nextbrowser application data. |

The Electron main process stores app-owned state in the platform application-data directory returned by <code>app.getPath("userData")</code>. Do not remove that directory unless you intend to delete local app state.

## Analytics notes

The desktop build enables its configured GA4 stream by default. Events include an application instance identifier and operational metadata described in [<code>ANALYTICS.md</code>](../ANALYTICS.md). The analytics implementation does not send prompt text, target URLs, or page domains.

Override the measurement stream for a special build with <code>VITE_GA4_MEASUREMENT_ID</code>. A blank value disables collection for that build.

## Development

Install dependencies and start the Electron/Vite development process:

~~~bash
npm ci
npm run dev
~~~

Before submitting application changes, run:

~~~bash
npm test
npm run build
npm run pack
~~~

CI runs install, tests, build, and unpacked packaging on macOS and Windows. Release automation publishes platform artifacts for tags matching <code>v*</code>.
