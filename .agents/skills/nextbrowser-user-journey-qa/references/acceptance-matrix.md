# Automation Studio acceptance matrix

Use this matrix for full audits, release readiness, and regressions after changes to Recorder, Workflow Builder, browser lifecycle, AI repair, or Artifact Center. Select rows relevant to the change, but always include one complete vertical journey.

## Evidence ledger

For each run, capture:

| Field | Record |
|---|---|
| Scenario and user goal | Natural-language task as entered |
| Build | App branch/version and dev or production mode |
| Runtime | nextctl version/branch and browser toolset |
| Starting state | Workspace, selected profile, reported status, actual browser state |
| UI path | Buttons/screens used in order |
| Timing | First feedback, longest silence, total duration |
| Browser behavior | Pages opened, launches/restarts, selected profile |
| Recording | Saved steps and discarded exploratory actions |
| Replay | Deterministic result, repair behavior, cancellation behavior |
| Artifact/effect | File name, format, size, row count, required fields, sampled values |
| Persistence | Result after app restart/reopen |
| Outcome | Pass, fail, blocked, or dependent failure |

Screenshots and terminal transcripts are evidence, but visible UI behavior and the opened output remain authoritative.

## Required state variants

Exercise these when the affected capability can encounter them:

- Fresh project with no prior recordings/workflows.
- Existing project containing prior entities and artifacts.
- Sole selected profile running normally.
- Profile stopped before the task.
- Browser manually closed outside the app while its last known status was running.
- Multiple profiles where the requested profile must be selected explicitly.
- App backgrounded and restored.
- App restarted after save.
- Local artifact deleted outside the app.
- Dev app with local nextctl.
- Production-like app with the released managed nextctl.

## Scenario families

Prefer real sites with distinct behavior rather than many variants of one DOM:

1. Dynamic ranked table: collect N populated rows and save JSON.
2. Static document: extract headings/links from a Wikipedia-like article.
3. Search results: enter a query, wait for results, collect titles and URLs.
4. Pagination or infinite scroll: collect across more than one visible batch.
5. Form interaction: input/select/submit with a verifiable non-destructive result.
6. Manual browsing recording: clicks and inputs performed by the user.
7. Agent browsing recording: task performed from Project Chat.
8. Hybrid recording: user intervention during an agent task.
9. Workflow edit: change count, URL, field set, or artifact format through UI.
10. AI modification and repair: change the goal through AI, then force a safe selector/readiness failure.

Avoid destructive posting, purchases, account creation, or messages unless the user explicitly authorizes them.

## Core acceptance checks

### Discovery and control

- A first-time user can identify where to start.
- Starting Recorder leads to the expected chat/manual path.
- Recording state and Stop are visible outside Automation Studio.
- Workflow library collapse/restore controls communicate their direction.
- Context menus and primary buttons expose consistent actions.

### Browser lifecycle

- The UI status catches an external start/stop within its documented polling interval.
- A manually closed browser is recovered once with the exact listed profile.
- Runtime labels are never used as profile names.
- No unexplained browser restart loop occurs.
- User cancellation stops current execution and returns a stable UI state.

### Recording quality

- Completed recording appears immediately after Stop.
- Incomplete attempts are discarded or explicitly reviewed, never silently saved as healthy.
- Recorded steps contain the final successful action path.
- Exploratory probes, failed attempts, duplicated opens, and shell-only work are absent.
- The website/domain and recorded timestamp are correct.

### Replay and repair

- First replay uses deterministic steps.
- Progress identifies the current step and remains stoppable.
- Empty or incomplete extraction fails before artifact save.
- Eligible deterministic failure launches AI repair without requiring technical user intervention.
- AI repair verifies the original goal and final data.
- A second replay succeeds deterministically from the repaired recipe.

### Artifact Center

- Agent and workflow save through the local app path.
- The artifact appears without reloading.
- Open/reveal actions use the platform-appropriate file manager.
- File contents match the page and requested schema.
- Deleting the file externally reconciles the list without an opaque IPC error.
- Re-running produces a valid new output rather than preserving stale or null data.

### Persistence and sharing

- Recordings/workflows survive app restart and appear in the correct workspace.
- Unsaved/in-progress attempts do not reappear as completed entities.
- Shared entities exclude credentials, transient profile identifiers, and local artifact contents unless explicitly part of the sharing design.

## Data validation examples

For a request for the top five items, require:

- exactly or at least five rows according to the task;
- unique ranks or canonical identifiers;
- required name/title fields populated;
- prices/counts parseable when requested;
- URLs absolute and HTTP(S) when requested;
- no row whose only meaningful value is its ordinal rank;
- a source URL and capture timestamp when the product promises them.

Always inspect the actual file. A card, success toast, or agent summary is insufficient.

## Regression protocol after a fix

1. Reproduce the original failure on the pre-fix build when practical.
2. Apply the fix and add a focused invariant test.
3. Rebuild and restart the desktop app.
4. Repeat the exact original UI journey.
5. Repeat after app restart.
6. Run at least one different real site using the same capability.
7. Exercise one adjacent failure state, such as slow data, stopped profile, or removed artifact.
8. Report residual risks; do not generalize beyond tested states.

## Failure reporting

Describe the first user-visible divergence:

- **Expected:** observable behavior and data.
- **Actual:** what appeared and when.
- **Reproduction:** visible UI actions only.
- **Evidence:** screenshot/transcript/artifact.
- **Boundary:** suspected subsystem after diagnosis.
- **Severity:** effect on task completion or user trust.
- **Retest:** exact build and states that passed after the fix.

Separate the root defect from dependent symptoms. For example, a missing final extraction may cause both a non-reusable recording and a missing artifact; do not count those as two independent root causes without evidence.
