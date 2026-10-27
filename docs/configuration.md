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

## Built-in Nextbrowser agent

Nextbrowser works with an agent CLI installed on the computer (Claude Code, Codex, OpenCode, and others), or with its own built-in agent, "Nextbrowser agent", which needs nothing else installed. The built-in agent runs inside the app: it sends the task to a model provider's OpenAI-compatible chat-completions API with tool calling and runs the browser tools the model asks for through the Nextbrowser CLI's MCP server (<code>nbc mcp</code>), the same tools an agent CLI uses. It offers the model a short list of them: <code>profiles_list</code>, <code>start</code>, <code>open</code>, <code>state</code>, <code>click</code>, <code>input</code>, <code>press</code>, <code>select</code>, <code>scroll</code>, <code>wait</code>, <code>extract</code>, <code>tabs_list</code>, <code>tabs_activate</code>, <code>save_artifact</code>, and <code>screenshot</code> for models that can read images. It has no shell, no file access, and no terminal: its projects open in Chat only, and it works with profiles on this computer, not on a VPS.

Set it up in **Settings → Agent** (choose "Nextbrowser agent"), or with **Use a free model** in the first-run agent setup:

| Provider | Base URL | Free use | Data |
| --- | --- | --- | --- |
| NVIDIA (default) | <code>https://integrate.api.nvidia.com/v1</code> | A free key from [build.nvidia.com](https://build.nvidia.com), about 40 requests a minute. Nextbrowser preselects a Nemotron model: Super, else Ultra, else Nano, the newest first. | NVIDIA offers its hosted models for development and testing. |
| OpenRouter | <code>https://openrouter.ai/api/v1</code> | Free models end in <code>:free</code>; <code>openrouter/free</code> picks a free model with the features a request needs. About 50 requests a day on a free account. | Free models can come from providers that log or train on prompts. |
| Google Gemini | <code>https://generativelanguage.googleapis.com/v1beta/openai</code> | The free tier of Gemini Flash, with daily limits. | On the free tier, Google may use prompts to improve its products. |
| Custom | Any OpenAI-compatible base URL | Groq, Ollama (<code>http://localhost:11434/v1</code>), LM Studio, or a paid key. The key is optional. | Up to the provider; a local model keeps everything on the computer. |

**Test** sends one short request with one dummy tool and says whether the key works and whether the model calls tools. A model that cannot call tools cannot use the browser; pick another one.

The task, the chat's recent history, the names and runtimes of the workspace's profiles, and the page text and screenshots the agent reads are sent to the chosen provider. The provider, base URL, and model are stored in <code>app-settings.json</code> in the app data directory. The API key is stored only by the main process, encrypted with the operating system's credential storage (Electron safeStorage: Keychain on macOS, DPAPI on Windows), in <code>credentials/builtin-agent.json</code> in the app data directory, one key per provider. The window never reads it back, and it is never written to <code>localStorage</code>, logs, error reports, or analytics. Without secure storage (Linux without a keyring) no key is saved.

A task runs for at most 40 model requests and 30 minutes, and Stop ends it at once. Errors say what to do: a rejected key, a free limit (Nextbrowser waits out a short per-minute limit by itself), a model the provider does not have, a model without tool calling, or a provider it cannot reach. Chats, scheduled runs, X reply drafts, and Automation Studio's AI edits can all use the built-in agent; the provider calls follow the system proxy like the app's other requests.

## Proxies and VPNs

Nextbrowser follows the operating system's proxy settings, including a PAC file, the way the app window does. A VPN app in "system proxy" mode sets such a proxy (usually <code>127.0.0.1:&lt;port&gt;</code>) without changing the computer's routes. For each backend address the main process asks Chromium how it would reach it (cached for 30 seconds): when the answer is a proxy, backend calls, error reports, and downloads of the app's own files (the Nextbrowser CLI, browser runtimes, update checks of browser runtimes) go through Electron's network stack and so through that proxy; when it is a direct connection, nothing changes. Starting Nextbrowser with Chromium's <code>--proxy-server=&lt;scheme&gt;://&lt;host&gt;:&lt;port&gt;</code> switch has the same effect, and the app logs <code>[network] &lt;origin&gt;: main-process requests go through the system proxy (…)</code> when it starts using a proxy for an address.

The Nextbrowser CLI (nbc) and agent CLIs read only proxy environment variables, never the system proxy. Unless you set <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code> or <code>ALL_PROXY</code> yourself (in any case; yours always win), the app passes the proxy it resolves for the API to the processes it starts: an HTTP proxy as <code>HTTP_PROXY</code> and <code>HTTPS_PROXY</code> (<code>http://</code>, or <code>https://</code> for an HTTPS proxy), a SOCKS proxy as <code>socks5://</code> in both and <code>socks5h://</code> in <code>ALL_PROXY</code>, always with <code>NO_PROXY=localhost,127.0.0.1,::1,local.adspower.com,local.adspower.net,launcher.mlx.yt</code> so the browser's DevTools port and local app APIs stay direct. A direct connection leaves the environment unchanged. The app logs <code>[network] nbc and agents get HTTP_PROXY, HTTPS_PROXY for the system proxy (…)</code> when this changes. Browser profiles are not affected: nbc starts them with their own proxy (<code>--proxy-server</code>, a Camoufox proxy file) or explicitly without one.

That is also why a VPN in system-proxy mode does not help browser profiles: a profile connects to its proxy (the NodeMaven gateway, <code>gate.nodemaven.com</code>) directly, and Chromium cannot put the VPN's proxy in front of it. When a profile start fails with a proxy connection, tunnel, or timeout error and the system proxy runs on this computer, the message (in the app and the one an agent relays) adds: "Your VPN works as a system proxy, and browser profiles connect to their proxy directly. Turn on TUN (VPN) mode in your VPN app, or let gate.nodemaven.com bypass the VPN."

## Local state

| State | Owner |
| --- | --- |
| Browser account and profiles | Browser environment configured for the installed release. |
| Browser sessions | Browser runtime selected by Nextbrowser. |
| Conversations and schedules | Nextbrowser application data. |
| Custom scripts | Nextbrowser application data and skill synchronization. |
| Agent skills | Agent-specific skill or plugin directories. |
| Built-in agent settings and key | <code>app-settings.json</code> (provider, base URL, model) and <code>credentials/builtin-agent.json</code> (API keys, encrypted) in Nextbrowser application data. |
| Application update state | Nextbrowser application data. |

The Electron main process stores app-owned state in the platform application-data directory returned by <code>app.getPath("userData")</code>. Do not remove that directory unless you intend to delete local app state.

## Analytics notes

The desktop build enables its configured GA4 stream by default. Events include an application instance identifier and operational metadata described in [<code>ANALYTICS.md</code>](../ANALYTICS.md). The analytics implementation does not send prompt text, target URLs, or page domains.

Override the measurement stream for a special build with <code>VITE_GA4_MEASUREMENT_ID</code>. A blank value disables collection for that build.

## Error reports

When something breaks, the desktop app sends an error report to the Nextbrowser backend (<code>POST /v1/client-errors</code> on the same API base as browser-runtime calls, <code>api.nextbrowser.com</code> by default). The request is signed with the connected account's key when there is one and is anonymous otherwise.

A report contains its kind, what failed (error name, message, stack, nbc error code, or HTTP status), the screen and action it happened in, the app and nbc versions, the operating system, a per-launch session id, a random install id, and the last 30 breadcrumbs: screens, IPC command names, backend calls (method, host, path, status), nbc command names with their exit status, and UI action names. Every backend request carries a W3C <code>traceparent</code> header, so a failed call is reported with the trace id of the matching server trace, and <code>X-Client-Name</code>/<code>X-Client-Version</code>, so the backend's request log names the app version that made the call.

The kind says what sort of failure a report is: <code>exception</code>, <code>unhandled_rejection</code>, <code>react_render</code>, <code>process_gone</code>, <code>api_error</code> (a backend call answered with a 5xx, or an app command failed with a backend 4xx), <code>command_failed</code> (an app command, nbc call, agent run, or a failure the user saw), and <code>network</code>: a request that got no answer because of the user's connection (a refused or reset connection, a failed TLS handshake, no answer in time, a host name that did not resolve), counted apart from product failures. Leave out <code>kind = 'network'</code> to count product failures. A <code>network</code> report from a backend call has the Node.js error code in <code>context.network_error</code> (for example <code>ECONNRESET</code>, <code>ENOTFOUND</code>, <code>TimeoutError</code>); one from an nbc call has nbc's reason there: <code>dns</code>, <code>connect</code>, <code>reset</code>, <code>tls</code>, <code>timeout</code>, or <code>other</code>. The backend has to list <code>network</code> among the kinds it accepts; until it does, it refuses every batch that holds a network report, so the app sends network reports in batches of their own and loses only those.

Reports are scrubbed before they are stored: the home directory becomes <code>~</code>, URLs lose their query, fragment, and credentials, and emails, bearer tokens, account keys, and API keys are removed. Reports never include page contents, prompts, typed text, terminal output, cookies, proxy credentials, nbc output, or nbc command arguments.

What is reported:

- renderer exceptions, unhandled promise rejections, and React render errors;
- main-process exceptions and unhandled rejections, crashed or unresponsive app processes;
- backend calls that return a 5xx status, and, with kind <code>network</code>, backend calls that get no answer through the user's connection, including a host name that does not resolve (<code>ENOTFOUND</code>, <code>EAI_AGAIN</code>): with a VPN, our domains can fail to resolve while the rest of the internet works. A computer without a network route (<code>ENETUNREACH</code>) is offline, and that is not reported. A computer that is offline altogether cannot send reports until it is back online, so repeats of each failure are folded into one report with a count;
- app commands (the calls the app window makes to the main process) that fail. The report names the command and carries the error's code, stack frames, and message; the message loses file paths, URLs, and names in quotes first. A JavaScript error (<code>SyntaxError</code>, <code>TypeError</code>, …) is named by its class, and its message, cut to 200 characters, loses every value it quotes: a JSON parse error says where it stopped, never what it read. Commands that handle credentials, prompts, or file contents (personal proxies, sign-in pairing, feedback, app data, skills, file reads, agent runs, the built-in agent's setup, terminal input) send no message. A backend 4xx response is reported with its status, except 401 and 403. Not reported: errors the user caused (a missing field, a file over a size limit, an agent CLI that is not installed, open profiles that block a browser update), cancellations, a signed-out account, an offline computer, and failures already reported as a backend call or an nbc call;
- failures the app shows only as a status: app update checks, downloads, and installs; nextctl installs; browser runtime installs, update checks, and updates;
- nbc calls that crash, cannot start, return no JSON when JSON was requested, or fail with an error code that means nbc or a backend broke. Also reported: a failed browser verification (<code>VERIFY_FAILED</code>, <code>VERIFY_REQUIRED</code>), classified by the code nextctl wraps in <code>VERIFY_FAILED</code> when the browser failed before its check; timeouts of commands the user waits on (start, stop, profile creation, Live View, update, install, and the CLI compatibility check); and a non-zero exit of the commands the app runs without JSON output (update, <code>config set</code>, declining a profile request, closing a Live View session, the agent skill install, and the compatibility check). Outcomes the app already explains to the user — invalid input, missing profiles, sign-in (including an expired Multilogin token, <code>MULTILOGIN_AUTH_INVALID</code>), the profile's own proxy, traffic limits, site-flow results, an offline computer, an update nbc refuses while profiles still use the browser, cancellations, and other timeouts — are breadcrumbs only. When nbc's JSON error carries <code>network_error</code>, a backend request got no answer through the user's connection: the report has kind <code>network</code> and that reason in <code>context.network_error</code>. A name that did not resolve is reported this way too (<code>dns</code>), also from an nbc that names it only in its message ("no such host"); a computer without a network route is a breadcrumb only, and so is a failed lookup in the commands the app runs without JSON output (update, install);
- agent runs (Codex, Claude Code, …), including Automation Studio's AI edits, that exit with an error the user did not cause, exit without a reply, or run past the app's own time limit: the report names the agent, its exit code, and the one line of its error output that says why it stopped, which the chat also shows. Claude Code prints that line to its regular output instead, so for Claude Code the report takes the last line there that starts with <code>API Error:</code> or <code>Error:</code>, or reads <code>Execution error</code>. A run the user stopped, a run cut short by quitting, and a sign-in the chat already asks for are not reported. The rest of the agent's output, its reply, and the prompt are never sent. A run of the built-in Nextbrowser agent is reported by its failure code instead of an error line (<code>BUILTIN_AGENT_SERVER</code>, <code>BUILTIN_AGENT_MAX_STEPS</code>, …) with the provider and, for a preset provider, the model; a provider it could not reach is a report of kind <code>network</code> (<code>BUILTIN_AGENT_NETWORK</code>). Failures the user fixes in Settings (a rejected key, a free limit, a missing model, a model without tool calling) are not reported, and the key, the base URL, and the provider's answer are never sent;
- an agent terminal that ends with a non-zero exit code or a crash signal, unless the app closed it or the user pressed Ctrl+C. The report names the agent, the exit code or signal, and how long the terminal ran;
- a profile start or stop an agent asked for that failed for a reason other than the user's setup (sign-in, the profile's proxy, traffic, a missing profile), and a start whose message blames a VPN in system-proxy mode (<code>context.hint = vpn_system_proxy</code>). The report carries the Ref the agent shows the user, the failure code, the browser runtime, nbc's own code (<code>context.nbc_code</code>) and the class of the cause (<code>context.cause</code>: <code>migration</code>, <code>proxy_check</code>, <code>launch</code>, <code>install</code>, <code>timeout</code> or <code>other</code>), never the profile name. A proxy account the backend could not set up before the start (the account's NodeMaven migration: <code>PROXY_ACCOUNT_SETUP_FAILED</code>) also carries the backend's code in <code>context.cause_code</code>, such as <code>migration_failed</code> or <code>migration_deferred</code>;
- Automation Studio replays that fail: the step number, the tool, and an error code, never the step's output or error text. A JavaScript error the replay runner itself threw is reported by its class and its message without the values it quotes. A browser runner (<code>nbc mcp</code>) for a replay, a recording, or element selection that cannot start or ends on its own is reported like any other nbc call;
- errors the app caught and showed the user: every message with a Ref, and failures that show only on a splash, a schedule, a panel note, or not at all — a startup that stalls or fails, a scheduled run that cannot start, the first-run setup falling back to the manual gate, a watch pass that waits more than 15 minutes for its agent, a failed X reply or monitoring pass, and Automation Studio, recorder, replay, and AI repair failures. Such a report (kind <code>command_failed</code>, source <code>renderer</code>) carries only where the error was shown (a kebab-case surface such as <code>agent-turn</code> or <code>scheduled-run-start</code>), its error code, and the Ref, never the message text. A startup that stalls or fails also carries how long it ran (<code>elapsed_ms</code>) and what it was waiting for (<code>stage</code>, such as <code>cli_download</code> or <code>account_identity</code>). A profile start that failed in the app window (<code>PROFILE_START_FAILED</code> on the <code>profile-action</code> surface, and <code>VERIFY_FAILED</code> in a chat) also carries what nbc reported, as codes: <code>nbc_code</code>, nbc's error code (<code>VERIFY_FAILED</code> for every failed start of a verified profile); <code>cause_code</code>, the code behind it, which is the code nextctl wraps after "browser stopped:" (<code>LAUNCH_FAILED</code>, <code>VENDOR_UNAVAILABLE</code>, …) or, for a proxy account the backend could not set up before the start, the backend's code (<code>migration_failed</code>, <code>migration_status_failed</code>, <code>migration_unavailable</code>, <code>migration_deferred</code>); and <code>cause</code>, the class of the failure: <code>migration</code> (that proxy account), <code>proxy_check</code> (the browser's proxy check failed), <code>launch</code> (the browser did not start), <code>install</code> (a browser toolset or its Python could not be installed or is outdated), <code>timeout</code>, or <code>other</code>. A first run that is still downloading and checking the Nextbrowser CLI is not a stall: the splash says it is setting up and waits up to three minutes before it reports. A reason the user has to fix, such as a deleted profile or a signed-out account, is not reported.

A Ref looks like <code>NB-25647DEA-3F1A</code>. The first part is a hash of the error code, the same for everyone who hits that error; the second part is random and names one occurrence. The report of that occurrence carries the Ref in <code>context.ref</code>. Refs shown before this format have the first part only. A failed profile start that an agent relays from the app carries a fully random Ref: <code>NB-</code> and eight hex digits.

Repeats of the same error are folded into one report with a count; a folded report keeps the latest Ref in <code>context.last_ref</code>. A launch sends at most 200 reports, and at most 20 for one error.

Turn reports off with **Settings → Privacy → Send error reports**. <code>NEXTBROWSER_ERROR_REPORTING=0</code> disables them in any build; development and unpackaged builds send nothing unless <code>NEXTBROWSER_ERROR_REPORTING=1</code>. Unsent reports wait in <code>client-errors/</code> in the application-data directory (at most 200, for up to seven days), and the reporter's own failures are logged to <code>client-errors/reporter.log</code> there.

### Network diagnostics

A report about the network or the proxy also carries a snapshot of how this computer reaches the internet, so that a failure caused by a VPN or a proxy can be told apart from a failure on our side. Such reports are: kind <code>network</code>; a backend call answered with a 5xx; nbc failures <code>REMOTE_BACKEND_ERROR</code>, <code>VERIFY_FAILED</code>, <code>VERIFY_REQUIRED</code>, <code>LAUNCH_FAILED</code> and <code>PROXY_*</code>, and timeouts of <code>start</code> and proxy commands; a profile start that failed in the app window (<code>PROFILE_START_FAILED</code>) or for an agent (<code>HOST_PROFILE_START_FAILED</code>); and a failed personal proxy test. The main process takes the snapshot when such a report is recorded (never in the app window, and only while reports are on), at most once a minute; later reports reuse it, and the send waits up to five seconds for it. One snapshot takes at most about four seconds. Its fields go into the report's context, prefixed <code>net_</code>, only while the context has room (30 keys; the report's own keys come first):

- <code>net_age_s</code>: seconds since the snapshot was taken (0 for one taken for this report).
- <code>net_default_route</code>: the interface family of the IPv4 and IPv6 default routes and of the route to <code>api.nextbrowser.com</code>, and whether one of them is a tunnel, for example <code>v4=utun;v6=none;api=utun;tunnel=yes</code>.
- <code>net_tunnels</code>: tunnel interfaces that are up, as family and address class, for example <code>utun:fakeip,utun:ipv6-linklocal×2</code>.
- <code>net_dns</code>: the class of the system DNS servers and the interface family they sit on; on macOS also the number of domain-specific resolvers, of those covering our domains, and of resolvers scoped to a tunnel.
- <code>net_resolve_api</code>, <code>net_resolve_gate</code>: what the system resolver answers for <code>api.nextbrowser.com</code> and the NodeMaven gateway <code>gate.nodemaven.com</code> (address classes and time, or the error code).
- <code>net_tcp_api</code>, <code>net_tcp_gate</code>: whether a TCP connection to port 443 and 8080 opens, the class of the address it reached, and how long it took, or the error code.
- <code>net_tls_api</code>: whether a TLS handshake with <code>api.nextbrowser.com</code> succeeds with certificate checks, or the error code (for example <code>SELF_SIGNED_CERT_IN_CHAIN</code> or <code>timeout</code>).
- <code>net_sys_proxy</code>: the operating system's proxy settings: HTTP, HTTPS and SOCKS proxies by class, whether a PAC file or auto-discovery is on, the number of exceptions; on Windows also the WinHTTP proxy.
- <code>net_chromium_proxy</code>: how Chromium (the app window) would reach our API and the gateway, for example <code>api=PROXY loopback:10808,DIRECT;gate=DIRECT</code>.
- <code>net_env_proxy</code>: which of <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code>, <code>ALL_PROXY</code> (scheme and class) and <code>NO_PROXY</code> (number of entries) the app inherited.
- <code>net_mtu</code>: the MTU of the default-route interface, and of the interface on the route to our API when it is another one.
- <code>net_ipv6</code>: whether a global IPv6 address is present, and on which interface families.

Addresses appear only as classes: <code>loopback</code>, <code>fakeip</code> (198.18.0.0/15, used by VPN clients in TUN mode), <code>cgnat</code> (100.64.0.0/10), <code>private</code>, <code>linklocal</code>, <code>public</code>, <code>ipv6-global</code>, <code>ipv6-ula</code>, <code>ipv6-linklocal</code>, and <code>host</code> for a host name. Interfaces appear only as families: <code>utun</code>, <code>tun</code>, <code>tap</code>, <code>wg</code>, <code>ppp</code>, <code>ipsec</code>, <code>physical</code>, <code>loopback</code>, <code>other</code>. A port is kept only for a proxy on this computer. The diagnostics never include an IP or MAC address, the name of a VPN server, proxy, PAC host, DNS domain, Wi-Fi network or network service, an interface or adapter name, a VPN app's or any other program's name, or anything from the user's files; the app reads no process lists. The values come from Node.js and Electron (<code>os.networkInterfaces()</code>, the system resolver, a TCP and a TLS connection, Chromium's proxy resolution) and, read-only, on macOS from <code>route -n get</code>, <code>ifconfig</code>, <code>scutil --proxy</code> and <code>scutil --dns</code>; on Windows from one PowerShell call (<code>Get-NetRoute</code>, <code>Get-NetAdapter</code>, <code>Get-NetIPInterface</code>, <code>Get-DnsClientServerAddress</code>, <code>Find-NetRoute</code>), <code>route print</code>, the Internet Settings registry key, and <code>netsh winhttp show proxy</code>; on Linux from <code>ip route</code>, <code>ip link</code>, <code>/etc/resolv.conf</code> and GNOME proxy settings.

## Device data

While you are signed in, the desktop app sends a snapshot of the computer and app it runs on to the Nextbrowser backend (<code>POST /v1/client-environment</code> on the same API base as error reports). Nextbrowser uses it to answer support requests faster, to tune browser fingerprints to real environments, and to decide which systems, languages, and regions to support. The snapshot belongs to your account and to this installation (the same random install id as error reports).

The data comes in five groups. Each group is a separate switch under **Settings → Privacy → Device data**:

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
