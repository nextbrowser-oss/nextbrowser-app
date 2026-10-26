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

## Error reports

When something breaks, the desktop app sends an error report to the Nextbrowser backend (<code>POST /v1/client-errors</code> on the same API base as browser-runtime calls, <code>api.nextbrowser.com</code> by default). The request is signed with the connected account's key when there is one and is anonymous otherwise.

A report contains what failed (error name, message, stack, nbc error code, or HTTP status), the screen and action it happened in, the app and nbc versions, the operating system, a per-launch session id, a random install id, and the last 30 breadcrumbs: screens, IPC command names, backend calls (method, host, path, status), nbc command names with their exit status, and UI action names. Every backend request carries a W3C <code>traceparent</code> header, so a failed call is reported with the trace id of the matching server trace, and <code>X-Client-Name</code>/<code>X-Client-Version</code>, so the backend's request log names the app version that made the call.

Reports are scrubbed before they are stored: the home directory becomes <code>~</code>, URLs lose their query, fragment, and credentials, and emails, bearer tokens, account keys, and API keys are removed. Reports never include page contents, prompts, typed text, terminal output, cookies, proxy credentials, nbc output, or nbc command arguments.

What is reported:

- renderer exceptions, unhandled promise rejections, and React render errors;
- main-process exceptions and unhandled rejections, crashed or unresponsive app processes;
- backend calls that fail on the network or return a 5xx status;
- app commands (the calls the app window makes to the main process) that fail. The report names the command and carries the error's code, stack frames, and message; the message loses file paths, URLs, and names in quotes first. A JavaScript error (<code>SyntaxError</code>, <code>TypeError</code>, …) is named by its class, and its message, cut to 200 characters, loses every value it quotes: a JSON parse error says where it stopped, never what it read. Commands that handle credentials, prompts, or file contents (personal proxies, sign-in pairing, feedback, app data, skills, file reads, agent runs, terminal input) send no message. A backend 4xx response is reported with its status, except 401 and 403. Not reported: errors the user caused (a missing field, a file over a size limit, an agent CLI that is not installed, open profiles that block a browser update), cancellations, a signed-out account, an offline computer, and failures already reported as a backend call or an nbc call;
- failures the app shows only as a status: app update checks, downloads, and installs; nextctl installs; browser runtime installs, update checks, and updates;
- nbc calls that crash, cannot start, return no JSON when JSON was requested, or fail with an error code that means nbc or a backend broke. Also reported: a failed browser verification (<code>VERIFY_FAILED</code>, <code>VERIFY_REQUIRED</code>), classified by the code nextctl wraps in <code>VERIFY_FAILED</code> when the browser failed before its check; timeouts of commands the user waits on (start, stop, profile creation, Live View, update, install, and the CLI compatibility check); and a non-zero exit of the commands the app runs without JSON output (update, <code>config set</code>, declining a profile request, closing a Live View session, the agent skill install, and the compatibility check). Outcomes the app already explains to the user — invalid input, missing profiles, sign-in, the profile's own proxy, traffic limits, site-flow results, an offline computer, an update nbc refuses while profiles still use the browser, cancellations, and other timeouts — are breadcrumbs only;
- agent runs (Codex, Claude Code, …), including Automation Studio's AI edits, that exit with an error the user did not cause, exit without a reply, or run past the app's own time limit: the report names the agent, its exit code, and the one line of its error output that says why it stopped, which the chat also shows. A run the user stopped, a run cut short by quitting, and a sign-in the chat already asks for are not reported. The rest of the agent's output, its reply, and the prompt are never sent;
- an agent terminal that ends with a non-zero exit code or a crash signal, unless the app closed it or the user pressed Ctrl+C. The report names the agent, the exit code or signal, and how long the terminal ran;
- a profile start or stop an agent asked for that failed for a reason other than the user's setup (sign-in, the profile's proxy, traffic, a missing profile). The report carries the Ref the agent shows the user, the failure code, and the browser runtime, never the profile name;
- Automation Studio replays that fail: the step number, the tool, and an error code, never the step's output or error text. A JavaScript error the replay runner itself threw is reported by its class and its message without the values it quotes. A browser runner (<code>nbc mcp</code>) for a replay, a recording, or element selection that cannot start or ends on its own is reported like any other nbc call;
- errors the app caught and showed the user: every message with a Ref, and failures that show only on a splash, a schedule, a panel note, or not at all — a startup that stalls or fails, a scheduled run that cannot start, the first-run setup falling back to the manual gate, a watch pass that waits more than 15 minutes for its agent, a failed X reply or monitoring pass, and Automation Studio, recorder, replay, and AI repair failures. Such a report (kind <code>command_failed</code>, source <code>renderer</code>) carries only where the error was shown (a kebab-case surface such as <code>agent-turn</code> or <code>scheduled-run-start</code>), its error code, and the Ref, never the message text. A startup that stalls or fails also carries how long it ran (<code>elapsed_ms</code>) and what it was waiting for (<code>stage</code>, such as <code>cli_download</code> or <code>account_identity</code>). A first run that is still downloading and checking the Nextbrowser CLI is not a stall: the splash says it is setting up and waits up to three minutes before it reports. A reason the user has to fix, such as a deleted profile or a signed-out account, is not reported.

A Ref looks like <code>NB-25647DEA-3F1A</code>. The first part is a hash of the error code, the same for everyone who hits that error; the second part is random and names one occurrence. The report of that occurrence carries the Ref in <code>context.ref</code>. Refs shown before this format have the first part only. A failed profile start that an agent relays from the app carries a fully random Ref: <code>NB-</code> and eight hex digits.

Repeats of the same error are folded into one report with a count; a folded report keeps the latest Ref in <code>context.last_ref</code>. A launch sends at most 200 reports, and at most 20 for one error.

Turn reports off with **Settings → Send error reports**. <code>NEXTBROWSER_ERROR_REPORTING=0</code> disables them in any build; development and unpackaged builds send nothing unless <code>NEXTBROWSER_ERROR_REPORTING=1</code>. Unsent reports wait in <code>client-errors/</code> in the application-data directory (at most 200, for up to seven days), and the reporter's own failures are logged to <code>client-errors/reporter.log</code> there.

## Device data

While you are signed in, the desktop app sends a snapshot of the computer and app it runs on to the Nextbrowser backend (<code>POST /v1/client-environment</code> on the same API base as error reports). Nextbrowser uses it to answer support requests faster, to tune browser fingerprints to real environments, and to decide which systems, languages, and regions to support. The snapshot belongs to your account and to this installation (the same random install id as error reports).

The data comes in five groups. Each group is a separate switch under **Settings → Device data**:

| Group | Fields |
| --- | --- |
| Language and region | OS interface language, preferred languages, regional format (for example <code>de-DE</code>), time zone, and UTC offset in minutes. |
| Keyboard layouts | Keyboard layouts and input methods enabled in the OS settings (id, name, language) and the default one. The app reads the list of layouts only, never keystrokes or typed text. |
| Device | OS family, OS name, version and build, architecture (an emulated app reports the machine's own architecture), CPU model and number of logical cores, memory size, GPUs (name, vendor, driver version), and displays (resolution in physical pixels, scale factor, which one is primary). |
| App setup | App, nbc, and installed browser runtime versions, which agent types are connected (for example <code>claude</code>, <code>codex</code>), whether a Multilogin account is connected, and the number of workspaces and profiles. Never workspace, profile, or account names. |
| Network location | Country, region, city, and internet provider. The backend looks them up from the address the report comes from; the IP address itself is not stored or logged. |

Where the values come from: Electron and Node.js system APIs on every platform; on Windows also the language list, keyboard layout names, version and update revision from the registry, and video controllers (one read-only PowerShell call); on macOS <code>defaults read com.apple.HIToolbox</code> and <code>sw_vers</code>; on Linux <code>/etc/os-release</code>, GNOME input sources, or <code>setxkbmap -query</code>. Only the groups that are on are read.

When it is sent:

- shortly after launch, once you are signed in, if 24 hours have passed since the last report for your account;
- while the app is running, an hourly check sends a report when 24 hours have passed and something changed;
- at once when you change a switch, so turning a group off deletes its data right away (if you are signed out then, at your next sign-in);
- at once after you sign in to an account this installation has not reported for. The 24-hour clock is kept per account; the app stores only a hash of the account key.

A report always carries every group that is on. A group that is missing is off, and the backend deletes what it stored for that group for your account and this installation. Installations that have not reported for 12 months are deleted.

All groups are on by default. In countries where the law requires consent before reading such data from a device (by default the EU and the EEA, decided by the backend from the request's location), every group stays off until you turn it on; the app asks the backend's <code>GET /v1/client-environment/policy</code> for groups you have not set yourself, and if it cannot get an answer those groups count as off for that attempt. Your own choice always wins.

Device data never includes the computer name, the OS user name, file paths, installed programs other than the browser runtimes listed above, browser history, clipboard contents, keystrokes, or typed text. See the [Privacy Policy](https://nextbrowser.com/privacy-policy).

Development and unpackaged builds send no device data unless <code>NEXTBROWSER_CLIENT_ENVIRONMENT=1</code>, and <code>NEXTBROWSER_CLIENT_ENVIRONMENT=0</code> turns it off in any build. Your choices are kept in <code>client-environment/state.json</code> in the application-data directory, and failures (never the collected values) are logged to <code>client-environment/report.log</code> there.

## Development

Install dependencies and start the Electron/Vite development process:

~~~bash
npm ci
npm run dev
~~~

For a dev build that must use a non-production API/backend, set the backend base URL before launching:

~~~bash
NEXTBROWSER_DEV_API_BASE_URL=http://127.0.0.1:18098 npm run dev
~~~

`NEXTBROWSER_DEV_API_BASE_URL` has priority over production API settings in the desktop process.
For a dedicated non-production entity service without changing browser runtime traffic, use
`NEXTBROWSER_ENTITY_API_BASE_URL`. `NEXTBROWSER_RUNTIME_API_BASE_URL` controls only browser
runtime traffic. Production defaults remain `core.nextbrowser.com` for workspace/Automation
entities and `api.nextbrowser.com` for browser sessions.

Before submitting application changes, run:

~~~bash
npm test
npm run build
npm run pack
~~~

CI runs install, tests, build, and unpacked packaging on macOS and Windows. Release automation publishes platform artifacts for tags matching <code>v*</code>.
