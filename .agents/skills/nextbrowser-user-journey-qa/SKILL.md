---
name: nextbrowser-user-journey-qa
description: Test NextBrowser Automation Studio, Recorder, Workflow Builder, browser profiles, replay, AI repair, and Artifact Center through real visible user journeys. Use for end-to-end QA, regression testing, release readiness, UX audits, or debugging behavior that users experience in the desktop app; do not use for isolated unit/API-only verification.
---

# NextBrowser User Journey QA

Validate the product a user experiences, not merely the services behind it.

## Operating contract

- Begin with the packaged or dev desktop app and its visible UI. Do not use internal APIs, IPC calls, database edits, localStorage edits, or direct backend requests to perform the scenario.
- Use a real public website unless the requested behavior specifically requires a fixture. A mock-site pass never substitutes for a real-site pass.
- Before reading implementation details, perform one clean first-user pass whenever the current app can run safely. Record the first point of confusion, silent wait, misleading success, or unexpected state.
- After reproducing a defect through the UI, inspect logs, code, stored state, or APIs to diagnose it. Diagnostics may explain the bug but do not count as the user-facing retest.
- Treat a vertical journey as one indivisible test. A passing component, API response, agent statement, or unit test does not make the journey pass.
- Do not claim perfect reliability from a finite test set. Report the tested states, evidence, residual risks, and anything not exercised.

## Define the user oracle first

For every scenario, write down:

1. **User goal** — what a non-technical user intends to accomplish.
2. **Starting state** — workspace, profile/runtime state, app state, and whether artifacts or prior automations exist.
3. **Visible success** — what the user must see in the app and controlled browser.
4. **Data success** — exact fields, row count, file format, or external effect that must be verified.
5. **Time and feedback expectation** — maximum acceptable silent interval and reasonable total duration for this task.

A run passes only when all three outcome layers pass:

- **UI:** the user can find the action, understand progress, stop it, and recognize completion or recovery.
- **Execution:** the selected browser profile performs the intended actions without unexplained restarts or substitutions.
- **Data:** replay and artifacts contain correct, non-empty, semantically valid results.

## Execute the complete vertical journey

For Recorder-to-Workflow scenarios, exercise the visible chain:

1. Open Automation Studio.
2. Start recording from the UI.
3. Follow the navigation the product presents; do not jump directly to an internal route.
4. Submit the task in Project Chat or perform the intended manual browsing.
5. Observe the selected profile and browser while work happens.
6. Stop recording from the visible global control.
7. Confirm the completed recording appears without a refresh workaround.
8. Inspect recorded steps and verify they describe the successful task, not exploratory or failed probes.
9. Run the recording again.
10. Verify the browser result and open the created artifact.
11. Convert the recording to a workflow.
12. Edit a concrete step through Workflow Builder.
13. Modify the workflow through its AI instruction path when that capability is in scope.
14. Run the edited workflow and verify the edit changed the result.
15. Restart the app, reopen the entity, and replay it again when persistence is in scope.

If any link fails, the scenario fails. Continue downstream only when doing so is safe and produces useful evidence; label dependent failures rather than counting each symptom as an independent bug.

## Observe like a user

Track:

- time until the first visible progress;
- longest interval with no visible feedback;
- total time;
- browser launches and unexpected restarts;
- profile name and runtime actually used;
- exploratory/failed browser calls versus saved replay steps;
- whether Stop remains discoverable and responsive;
- whether errors explain what happened and what the app will do next;
- whether automatic AI repair is truly automatic and returns to a validated success state.

Do not accept “Saved”, “Completed”, or an agent answer as proof. Open the artifact through the app and verify its contents against the browser page or requested external effect.

## Recorder and replay invariants

- The recording must retain the starting navigation, final successful deterministic data/action step, and requested artifact output.
- Failed calls, selector probes, HTML diagnostics, duplicate navigations, and recovery noise must not become replay steps.
- Replay must use the chosen profile and must not silently fall back to a default or runtime label.
- Empty strings, null-only rows, ordinal-only rows, zero placeholders, invalid URLs, or too few rows fail data validation.
- Deterministic replay runs first. AI repair may take over only after an observable deterministic failure, must preserve the original user goal, and must validate the final output.
- A repaired run is not complete until the repaired recipe is usable on a subsequent deterministic replay.

## State and boundary testing

Test important boundaries through the UI, especially:

- running profile;
- profile stopped in the app;
- browser window manually closed while the app still believes it is running;
- fresh workspace versus existing workspace;
- app restart and reopened project;
- slow or dynamically rendered page;
- removed local artifact file;
- current dev nextctl versus the released nextctl used by the production build.

Never infer production readiness from a dev-only dependency combination.

## Diagnose and fix

Once the UI reproduction is captured:

1. Identify the first incorrect observable state, not the last error banner.
2. Trace the boundary that produced it: renderer → Electron host → agent context → nextctl/MCP → browser → Recorder compiler → backend metadata/local artifact.
3. Add a regression test for the smallest broken invariant.
4. When authorized to fix, keep the change domain-general unless the site has a genuinely unique contract.
5. Rebuild and restart the same app users exercise.
6. Repeat the original visible journey from a clean relevant state.
7. Run adjacent real-site scenarios that use a different DOM or interaction pattern.

Unit, integration, and API tests support this process; they never replace the final UI retest.

## Completion report

Report:

- exact build/dependency versions or branches tested;
- scenarios and starting states;
- observable timings;
- verified artifacts/external effects;
- defects found and fixed;
- regression coverage added;
- remaining risks and untested states.

For a full audit, release check, or multi-scenario regression, read [references/acceptance-matrix.md](references/acceptance-matrix.md) before testing.
