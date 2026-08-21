# Automation Studio: Recordings and Workflows Audit

Last verified: 2026-08-21

## Product model

Automation Studio records successful **agent-driven browser runs**, not arbitrary manual mouse and keyboard activity. Replay itself is deterministic: the desktop app executes the saved recipe directly through one persistent NextBrowser MCP session and does not invoke an AI agent. A workflow is a versioned, backend-owned recipe of up to 100 browser actions. ClawBrowser is one supported browser toolset alongside Camoufox, DasBrowser, and future compatible runtimes.

The recorder supports:

- browser runs whose agent exposes structured tool events;
- workflows launched from Automation Studio, including Codex runs whose raw tool events are unavailable (the executed structured recipe is captured instead);
- ordered navigation, interaction, wait, form, upload, and extraction actions;
- direct execution on the selected runtime, step-level backend status, structured output, progress, and cancellation;
- CSS locators, stable runtime element IDs, and accessible role/name locators resolved through semantic browser state;
- replay, conversion to a workflow, deletion, workspace/agent isolation, and explicit Start/Stop.

It does not currently support:

- manual clicks performed by the user in Live view;
- Terminal-mode commands;
- pausing a recording (page state can change while paused);
- reliably reconstructing an arbitrary natural-language Codex browser run when it exposes neither tool events nor an embedded workflow recipe;
- secret replay: credentials and payment data are redacted and the resulting recording cannot become a workflow.

## Ten end-to-end scenarios

| # | Scenario | Verification | Result |
|---|---|---|---|
| 1 | First-run examples | Seed two recordings, two workflows, and two artifacts twice | Pass; idempotent and upgraded by example version |
| 2 | Live recording replay | Run the Quotes to Scrape example directly on profile `ллл` | Pass; 10 + 4 results, visible progress, successful completion without an agent |
| 3 | Complex workflow | Navigate, wait, extract, selector click, and paginate across Books to Scrape | Pass; 20 + 12 records across three pages without an agent |
| 4 | Record to workflow | Start recording, run a two-step live workflow, Stop, convert | Pass; backend recording and editable two-step workflow created |
| 5 | Stop during preflight | Stop before an agent reply exists | Pass after fix; no permanent `Stopping…` state, backend run cancelled |
| 6 | Incomplete recording | Start and immediately Stop | Pass; attempt remains local while active and is never persisted as a recording |
| 7 | Isolation | Competing workspace, agent, and pre-start runs | Pass; only the owning workspace, agent, and time window are captured |
| 8 | Security | Password, bearer token, API key, card/security-code contexts | Pass; values redacted client-side and raw secrets rejected by workflow API |
| 9 | Builder lifecycle | Duplicate, invalidate domain, block Save/Run, save revision, delete | Pass; inline validation and optimistic revisions work |
| 10 | Persistence lifecycle | PostgreSQL CRUD for recordings/workflows/runs; local CRUD for artifacts | Pass; terminal run states cannot revert, steps close with the run, and artifacts remain in per-workspace app storage until the user deletes them |

## Defects found and corrected

- Complex recordings previously retained only one “best” action per category. All successful replayable actions are now preserved in order.
- Failed retries could leak into recipes. Failed actions are excluded.
- Recordings could capture another workspace or agent. Capture is now scoped by workspace, agent, and start time.
- Recorder completion happened before the user pressed Stop. Stop is now the only commit point.
- Empty recording attempts were previously persisted and exposed as Recording/Stopped categories. Only successful recordings are now stored or shown in the library.
- A second automation could overwrite the first execution indicator. Concurrent starts are blocked.
- Failed executions were sometimes presented as stopped. Completed, failed, cancelled, preparing, running, and stopping are distinct.
- Stop during browser preflight could remain stuck forever. A missing reply now terminates Stop cleanly or produces an immediate launch error.
- Real Codex runs contain no raw browser tool events. Automation-launched runs are now reconstructed from the exact recipe sent to Codex.
- Extracted content containing words such as “failed” could be misclassified as a tool error. Only the immediate tool result is scored.
- Secrets could be persisted in recordings or recipes. Sensitive values are redacted; backend recipes reject raw credentials, authorization data, payment data, and secret-bearing URLs.
- Default workflows used `example.com` and could never succeed. They now use the public Books to Scrape and Quotes to Scrape sandboxes.
- Automation CRUD traffic hit the captcha-provider rate limit and returned 429. Authenticated automation persistence is now excluded from that paid-provider limiter.
- Run and step states could race or revert from terminal states. Conditional transitions and terminal step reconciliation were added.
- Recording-in-progress state is local UI state and is never represented as an incomplete backend entity.
- Background timer throttling made duration and progress appear frozen. The Electron window keeps automation timers active.
- Workflow progress counted setup/inspection calls as completed actions. Only replayable recipe actions count; long-running work shows the agent's live activity label.
- Backend runs existed but were invisible in the builder. The selected workflow now shows its five most recent backend runs.

## Design conclusions

The primary UI should continue to describe capture as an **agent run recorder**, because it is not equivalent to a browser DevTools recorder. Playback is a deterministic browser runner. Targets prefer visible role/name semantics, with CSS selectors and recorded element IDs as supported alternatives. The AI agent is an explicit repair path after failure, never a hidden dependency of ordinary replay. Execution always exposes global status and Stop outside Automation Studio.

The next product increments, in order, should be:

1. A first-class nextctl/MCP action-event bridge so arbitrary Codex tasks can be recorded without an existing recipe.
2. Assertions/checkpoints (`text exists`, `URL matches`, `count > 0`) and explicit failure messages.
3. Per-run parameter forms generated from `parametersSchema`, with secrets injected at runtime and never persisted.
4. Retry-from-step, breakpoints, screenshots on failure, and an approval flow for saving AI-repaired locators.
5. Workflow import/export and portable file parameters instead of machine-specific upload paths.

These priorities follow the strongest patterns in Playwright Codegen, Chrome DevTools Recorder, and Selenium IDE: resilient locators, editable ordered steps, assertions, visible recording state, replay controls, and debuggable run history.
