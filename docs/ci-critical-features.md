# Critical feature checks

## Implemented gates

`npm run test:critical` runs before the full test suite in CI, release, and manual installer builds, on both macOS and Windows. A failure stops that job before packaging/publishing. No credentials or external websites are required. Explicit suite paths fail when a critical suite disappears. `npm test` also discovers every Electron Node test automatically.

| Invariant | Automated coverage |
| --- | --- |
| No browser work without successful verification | `src/preflight.test.ts`: missing, pending, empty, contradictory, failed and timed-out results stop before action dispatch; same-proxy restart can recover; three failures stop the profile before the consent dialog; stop failure blocks recovery; direct access requires explicit consent and successful verification of a separate direct profile |
| Old CLI cannot ignore verification | `electron/agent-workspace.test.cjs`: capability rejection; automation runner/picker tests assert mandatory MCP launch arguments |
| Logout cannot leave queued work running | `src/store.conversations.test.ts`, `src/agent-login-status.test.ts`: external logout, uncertain identity, queue pause and recovery |
| Each project uses its selected agent | `src/store.conversations.test.ts`, `src/components/AgentConnectionGate.test.tsx`: selection, switching and preserving history |
| Background work cannot hold the startup screen indefinitely | `src/store.bootstrap.test.ts`: pending updates/setup, deadline and recovery |
| Update now invokes the selected runtime updates | `src/components/BrowserRuntimeUpdatePrompt.test.tsx`, `electron/browser-runtime-updates.test.cjs` |
| Automations execute and report failure/cancellation | `src/lib/automationExecution.test.ts`, `electron/automation-runner.test.cjs`; trust disclosure helpers in `src/lib/automationTrust.test.ts` |
| Profile deletion and manual proxy behavior remain covered | `src/store.profileDeletion.test.ts`, `electron/manual-proxy-runtime.test.cjs` |

The CLI repository has its own `python3 scripts/check-critical.py` gate before CI builds and GoReleaser publication. It requires named verification tests to pass (skips/missing tests fail), builds the CLI, and checks that both the flag and mandatory environment reject an action when diagnostics fail. An explicit false flag must not override the mandatory environment.

These are unit/integration and CLI process checks, not a complete installed-desktop journey. Some native wiring checks inspect source; they do not prove runtime UI behavior. Repository branch protection is configured separately: require the CI platform checks before merging. Changes to workflows must be reviewed. Nothing here changes GitHub repository rules automatically.

## Next coverage, in priority order

1. **Installed app smoke, every PR:** launch the packaged Electron app with an isolated user-data directory and controlled backend/CLI fixtures. Create a project, select an agent, simulate logout, verify the visible login prompt and queue pause, then recover. Exercise Update now from the actual DOM, including download failure and retry. Save screenshots and logs on failure. This catches IPC and UI wiring gaps that helper tests cannot.
2. **App + exact CLI version contract, before release:** test the app against the CLI artifact selected for distribution, including old CLI rejection, invalid MCP configuration, failed verify and successful verify followed by a harmless local-page action. Pin the artifact version/checksum in the job; testing two independent repository HEADs is insufficient. Currently the CLI is downloaded externally, so app-only tests cannot guarantee a published CLI is compatible.
3. **Real browser/proxy canary, nightly and before promotion:** use a dedicated runner/profile and test credentials. Start/stop/restart/rotate the profile, check expected country/IP, deliberately invalidate the proxy, and prove that site actions stop. Run only trusted revisions; never expose these secrets to fork PRs. A failed canary blocks promotion; keep ordinary PR tests independent of provider uptime.
4. **Automation journey on a controlled fixture site:** record, replay, cancel, save/reopen, recover after an interrupted run, and validate exported artifacts. Assert extracted values and file contents, not just an exit code. Keep public-site probes separate because their content and markup change independently.

For live runs, keep the real mandatory verification enabled. Do not add skip-verify or automatic direct fallbacks to make CI green. After three failed proxy attempts, the UI may offer a separate direct profile only with explicit user consent. The original proxy profile cannot be converted to direct. A skipped live check must be reported as untested, never as a successful release gate.

Connection-loss checks are described in [Proxy connection safety](proxy-connection-safety.md). The mandatory Node suite now exercises the background monitor, and the CLI gate verifies fresh proof and a durable cross-process interlock. A real-runtime network outage test remains a separate release-validation requirement.
