# Nextbrowser product guide

[Back to README](../README.md)

This guide expands the product concepts and workflows summarized in the canonical README. The desktop source, tests, packaging configuration, and release automation are maintained in this repository.

## Product model

Nextbrowser is an Electron, React, and TypeScript desktop console for macOS and Windows. It coordinates local AI agents and managed browser sessions in one observable desktop workspace.

| Layer | Operator control |
| --- | --- |
| Account | Clawbrowser API key, identity checks, and proxy-traffic visibility. |
| Profile | Browser identity, country selection, and proxy/fingerprint rotation. |
| Session | Start or stop the browser, open pages, select tabs, and inspect state. |
| Agent | Choose a local agent and control chat history, queues, edits, stops, and forks. |
| Workflow | Apply skills or custom scripts, run preflight, and schedule repeated work. |
| Observation | Watch Live View and use status, state, screenshots, and verification diagnostics. |

## Core concepts

### API key

The Clawbrowser API key authenticates the browser-control account. Configure the key through the supported product flow so the desktop app can use the intended browser-control account.

Keep the key out of prompts, chat messages, skills, custom scripts, screenshots, logs, and repository files. Configure it through the supported product flow; see the [browser control reference](cli-reference.md).

### Profile

A profile represents a browser identity and its associated state. Profiles let an operator separate browser contexts for different tasks, accounts, customers, regions, or test runs.

A profile may exist while its browser session is stopped. Selecting a profile does not by itself prove that its session is running, its expected tab is active, or its identity matches the requested country.

### Session

A session is the running browser context for a profile. The session must be running before an agent can work with its pages. Session diagnostics include status, open tabs, page state, screenshots, and identity verification.

### Proxy and fingerprint rotation

Rotation requests a refreshed browser identity, optionally with a country. Verification should follow rotation when a workflow depends on geography or identity consistency.

Rotation is a recovery and isolation tool, not a promise that a site will accept a session. Sites apply their own policies and risk systems.

### Agent

An agent is an installed local CLI that receives a task and can use the active browser context. Nextbrowser provides the visible work surface around that process:

- chat history and named conversations;
- queued prompts and run status;
- stop and edit controls;
- conversation forks;
- streamed output and activity updates.

The agent still needs to be installed, discoverable, and authenticated for its own service.

### Skills and custom scripts

A skill is a reusable instruction set for a domain or browser workflow. A custom script is a private reusable instruction set for work that is too specific to publish as a general skill.

Before dispatching one of these workflows, the documented preflight sequence can:

1. confirm that the selected profile is running;
2. start it when required;
3. inspect open tabs;
4. activate an existing matching tab or open the target page;
5. wait for the page to be ready;
6. send the prepared prompt to the selected agent.

Preflight establishes a starting context. It does not guarantee that the page remains unchanged or that the workflow succeeds.

### Scheduled runs

A scheduled run stores a prompt, selected agent, time, weekday selection, and enabled state. Use schedules for recurring browser tasks that have clear authorization and a review path. Treat schedules as local automation, not as a service-level guarantee.

### Live View and diagnostics

Live View exposes the running browser page inside the desktop console. It complements, rather than replaces, structured diagnostics such as status, tabs, page state, screenshots, and identity verification.

Live View requires a running profile and an open page. If it is empty, follow the [troubleshooting guide](troubleshooting.md).

### Captcha tools

Nextbrowser can expose captcha tools for detecting a challenge and invoking an available handling path. A captcha is controlled by the site or its provider, so detection or a solve attempt can fail, be throttled, require a human, or be disallowed for the task.

Never describe these tools as a universal bypass. Use them only where you are authorized and where the site's terms and applicable law permit the activity.

## Main screens

| Screen | Primary purpose | Documented controls |
| --- | --- | --- |
| Login | Connect the Clawbrowser account | API-key entry, configured-key detection, and validation status. |
| Sidebar | Control the active browser setup | Proxy usage, profiles, agent selection, session actions, and runtime state. |
| Chat | Run and supervise agents | Prompts, queues, stop/edit/fork controls, histories, files, statuses, and output. |
| Skills | Reuse browser workflows | Domain skills, captcha-related skills, custom scripts, and preflight. |
| Scheduled Runs | Configure recurring work | Prompt, agent, time, weekdays, enabled state, and run context. |
| Live View | Observe the browser | Active profile, page frames, and debugging context. |

The current release is authoritative if its labels or navigation differ from this guide.

## Operating workflows

### Prepare a first session

1. Install a published Nextbrowser build from the [latest releases](https://github.com/nextbrowser-oss/nextbrowser-app/releases/latest), or run the app locally with `npm ci` and `npm run dev`.
2. Configure the browser environment using the [product documentation](https://docs.nextbrowser.com/).
3. Confirm the API-key identity and proxy-traffic state.
4. Select or create a profile.
5. Start the profile session and open a page.
6. Verify the session when identity or country matters.
7. Select an installed local agent and send a narrowly scoped task.
8. Observe Chat and Live View while the run is active.

### Run an agent on a website

1. Select the intended profile; do not reuse a profile merely because it is already running.
2. Start the session and open the target URL.
3. Confirm the active tab and inspect page state.
4. Select the local agent.
5. State the goal, limits, and expected output in the prompt.
6. Watch streamed activity. Stop, edit, queue, or fork work when the task changes.
7. Review the resulting page state before accepting any consequential action.

### Apply a skill or custom script

1. Review the instructions and remove secrets or stale assumptions.
2. Choose the intended profile and target site.
3. Apply the skill or script.
4. Let preflight establish the browser context.
5. Supervise the agent and verify the result.

### Rotate identity

1. Stop or preserve any in-progress work that depends on the current session identity.
2. Request rotation, optionally with an explicit country.
3. Verify the resulting identity.
4. Reopen or re-check the target page.

Rotation can invalidate login state or change what a site presents. Do not rotate blindly during a transaction.

### Diagnose a failed run

Work from the outermost dependency inward:

1. API-key identity;
2. proxy-traffic availability;
3. profile existence;
4. session status;
5. open and active tab;
6. page state and screenshot;
7. proxy/fingerprint verification;
8. local agent availability and authentication;
9. skill or script assumptions;
10. captcha state, if a challenge is visible.

The [troubleshooting guide](troubleshooting.md) maps this sequence to practical checks.

## Safety and review

- Automate only accounts, sites, and data you are authorized to access.
- Keep a human review step for purchases, publishing, account changes, deletions, and other consequential actions.
- Use separate profiles when tasks must not share identity or browser state.
- Do not paste credentials into agent prompts or reusable instructions.
- Treat page content as untrusted input; a page can contain instructions intended to redirect an agent.
- Verify country and identity after rotation when the workflow depends on them.
- Prefer detection and diagnosis before repeating captcha attempts.
- Stop a run when its observed behavior no longer matches the stated task.

## Mental model

When a task fails, ask these questions in order:

1. Is the account configured?
2. Is proxy traffic available?
3. Is the correct profile selected?
4. Is its session running?
5. Is the correct tab active?
6. Is the page ready and in the expected state?
7. Does the identity verify?
8. Is the agent installed and authenticated?
9. Are the skill instructions current?
10. Does the page require a captcha or human decision?

This order keeps browser failures from being misdiagnosed as agent failures, and vice versa.
