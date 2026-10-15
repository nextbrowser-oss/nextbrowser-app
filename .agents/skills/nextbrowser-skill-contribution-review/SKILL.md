---
name: nextbrowser-skill-contribution-review
description: Review a community pull request that adds or changes a public browser skill under skills/<skill-id>/. Checks scope, manifest, SKILL.md, acceptance cases and run evidence against CONTRIBUTING.md and writes a review the contributor can act on. Use when asked to review, triage or approve a browser skill contribution, or to tell a contributor what is missing before merge; do not use for app code, README or translation changes.
---

# NextBrowser skill contribution review

Most browser skills in this repository come from outside contributors, often first-time ones. A good review does two things: it keeps broken or unsafe skills out of the catalog, and it tells the contributor exactly what to change so the next push is the last one.

`npm run validate:skills` and CI catch structural mistakes. They do not catch a skill that opens the wrong site, asks for too many permissions, or was never run inside the app. That part is the reviewer's job.

## Inputs

- Pull request number or URL.
- The linked **Browser skill contribution** issue, if there is one.

## 1. Check scope before reading the details

1. Find the linked issue (template `05-skill-contribution.yml`, label `skill`). It should name one website, one coherent workflow and at least three acceptance tasks, and a maintainer should have confirmed the scope. If there is no issue, ask for one rather than reviewing a scope nobody agreed to.
2. List the changed files. A skill PR should touch only `skills/<skill-id>/`: `SKILL.md`, `manifest.json` and `tests/cases.json`. Screenshots, recordings, captured pages, generated output and unrelated edits do not belong in the directory. Evidence goes in the PR description or comments.
3. Compare with the existing skills in `skills/`. A second skill for the same site is fine when it is a distinct job or a different browser engine (for example `bitwarden-autofill-login` and `bitwarden-autofill-login-firefox`). If it repeats an existing skill, ask whether improving that skill would be clearer for users.

## 2. Run the checks

```bash
git fetch upstream pull/<number>/head:pr-<number>
git switch pr-<number>
npm ci
npm run validate:skills
npm test
npm run build
```

CI runs the skill validator first and then builds on macOS and Windows. A contributor may be unable to run `npm test` or `npm run build` locally; accept that when the PR says so plainly and CI is green. Do not accept a validation block that is left empty.

## 3. Review `manifest.json` beyond the validator

The validator enforces the directory slug, a matching `id`, non-empty `name`, `description` and `author`, real hostnames in `domains`, the allowed `operations`, `target_mode`, `permissions`, `verification`, `logo` and `category` values. Judge what it cannot:

- **`target_mode`.** Use `current_tab` when the skill works on the page the user already has open, such as filling a saved login. Use `fixed_domain` when the skill always works on one site. A skill that acts on the current page but is declared `fixed_domain` will open the first entry in `domains` instead of the user's page. This exact problem blocked an earlier autofill skill until it was fixed.
- **`permissions`.** They should be complete and no wider than the skill needs. A skill that signs in needs `login`. A skill that posts, comments or messages needs `publish`. A skill that saves files needs `save_local_artifact`. Ask why for anything else.
- **`domains`.** Every host the workflow really touches, and nothing added only to satisfy the validator.
- **`category`.** Reuse an existing one by copying its `id`, `title`, `icon` and `order` from another manifest. New categories and icons need maintainer approval.
- **`author`.** The contributor's GitHub username, so the work stays attributed to them.
- **`verification`.** `community` unless a maintainer has verified the skill. `verified` also requires `min_nextctl_version`.

The example manifest in `CONTRIBUTING.md` does not show `target_mode` or `permissions`, but the validator requires both. If a contributor copied that example, point them to an existing manifest with the same kind of workflow.

## 4. Review `SKILL.md`

Read it as a fresh agent that knows the browser tools but nothing about this site.

- The frontmatter `name` matches the directory. The `description` says what the skill does and which requests should trigger it. Trigger guidance placed only in the body comes too late.
- The body gives the outcome, the inputs that matter, the shortest reliable path, what to verify, how to recover and what the final answer contains.
- It reattaches one named profile instead of opening a second session, and it verifies a requested proxy country before the site is touched.
- It targets controls by role, label, text or a stable selector. Element IDs from an earlier session are hints, never the plan.
- Consequential actions (posting, messaging, submitting a login, deleting, buying) are separated from preparation, and the skill never repeats one after an uncertain response without checking the result first.
- When the skill can end in several ways, the final states are named and used consistently, and every failure path says which one to report. Merged autofill skills are a good model.
- It does not fall back to a default session or an unverified proxy when the requested one fails.
- No credentials, cookies, tokens, personal data, private URLs or captured results that will go stale. The validator's credential check is a simple pattern match, so read the file yourself.
- No claims about the site that the contributor did not verify. Instructions written for one site should not quietly claim to work everywhere.

## 5. Review `tests/cases.json`

- At least three tasks that are genuinely different: the main path, a meaningful variation (proxy, "fill but don't submit", a second site) and a failure or recovery case. Three rewordings of the same task do not count.
- Each `expects` entry describes behavior someone can observe in a run.
- Every expectation is backed by an instruction in `SKILL.md`. An expectation with nothing behind it in the skill is a gap the agent will not fill on its own.

## 6. Check the evidence

For every acceptance task the PR should show:

- a run inside the NextBrowser app, from a fresh chat;
- OS, app version or commit, agent, profile and proxy;
- the outcome and the final state reported;
- a redacted screenshot, transcript or short recording.

Runs in a standalone script or test harness are useful for debugging but do not replace a run in the app. A contributor once replaced harness runs with in-app runs during review, and that was the right call. If a task was not run, the PR should say so and why. A missing task is a reason to ask, not to guess.

## 7. Run it yourself when you can

With the PR branch checked out, start `npm run dev`, connect an agent, open **Skills**, find the card marked **Repository** and press **Run**. Restart the dev process if the skill directory appeared while the app was already running. Try at least the first acceptance task from a fresh chat. A green CI run does not replace browser review.

## 8. Write the review

Start with a verdict: approve, request changes, or blocked. Then split the findings:

- **Blocking.** Must change before merge: wrong `target_mode`, missing or excessive permissions, a consequential action without confirmation, secrets or personal data, an acceptance task with no evidence.
- **Suggestions.** Would make the skill better but should not hold it back.

For each finding give the file, the line or field, what is wrong and the exact change you expect. Ask for fixes in the same pull request so the history stays in one place. Be direct and friendly; many contributors are opening their first pull request here.

```markdown
**Verdict:** request changes

**Blocking**
1. `manifest.json`, `target_mode`: the skill fills the login form on the page the user already has open, so this should be `current_tab`. With `fixed_domain` it opens github.com instead.
2. Evidence: acceptance task 3 (vault locked) has no run. Please run it from a fresh chat and add the result, or say why it can't be tested.

**Suggestions**
- `SKILL.md`, Recovery: say what to report when the extension icon never appears, so the agent doesn't retry forever.

Checks run: `npm run validate:skills` ✅, CI ✅, first acceptance task in `npm run dev` ✅.
```

## Before approving

- [ ] A maintainer-confirmed issue defines one website and one workflow.
- [ ] The PR changes only `skills/<skill-id>/`.
- [ ] Directory, manifest `id` and frontmatter `name` match.
- [ ] `target_mode`, `permissions`, `domains` and `category` fit what the skill actually does.
- [ ] `SKILL.md` covers profile reuse, proxy checks, recovery, final states and confirmation before consequential actions.
- [ ] `tests/cases.json` has at least three distinct tasks, each backed by instructions.
- [ ] Every acceptance task has redacted evidence from a fresh in-app chat, or the gap is explained.
- [ ] `npm run validate:skills` passes and CI is green.
- [ ] No secrets, personal data, captured output or unrelated changes.
