---
name: nextbrowser-skill-contribution-review
description: Review a community pull request that adds or changes a public browser skill under skills/<skill-id>/. Checks scope, manifest, SKILL.md, acceptance cases and run evidence against CONTRIBUTING.md and writes a review the contributor can act on. Use when asked to review, triage or approve a browser skill contribution, or to tell a contributor what is missing before merge; do not use for app code, README or translation changes.
---

# NextBrowser skill contribution review

Most browser skills in this repository come from outside contributors, often first-time ones. A good review keeps broken or unsafe skills out of the catalog and tells the contributor exactly what to change, so the next push is the last one.

## What CI covers and what it doesn't

`npm run validate:skills` runs first in CI, followed by the build on macOS and Windows. It catches structure. Behavior is the reviewer's job.

| Area | Caught by CI | Needs a reviewer |
| --- | --- | --- |
| Directory | Lowercase kebab-case slug, required files present | Only `skills/<skill-id>/` changed, no captured output or media |
| `manifest.json` | Required fields, allowed values, `id` matches the directory | `target_mode`, `permissions` and `domains` fit what the skill really does |
| `SKILL.md` | Frontmatter present, `name` matches, at least 400 characters, simple credential pattern | Clear trigger, reliable workflow, recovery, safe final actions, no private data |
| `tests/cases.json` | At least three cases with `task` and `expects` | Cases are distinct and each expectation is backed by an instruction |
| Evidence | Nothing | Every acceptance task was run in the app from a fresh chat |

## Review at a glance

| Step | Check | Passes when |
| --- | --- | --- |
| 1 | Scope | A maintainer-confirmed issue names one website and one workflow; the PR touches only the skill directory |
| 2 | Checks | Validator, tests and build pass locally or in CI, and the PR lists what was run |
| 3 | Manifest | Launch target, permissions, domains and category match the workflow |
| 4 | `SKILL.md` | A fresh agent could complete the job safely from the file alone |
| 5 | Acceptance cases | Three or more genuinely different tasks, all backed by instructions |
| 6 | Evidence | Every task has a redacted in-app run, or the gap is explained |
| 7 | Own run | At least the first task works for you in `npm run dev` |
| 8 | Review | Verdict, blocking findings and suggestions with exact fixes |

## 1. Scope

1. Find the linked **Browser skill contribution** issue (template `05-skill-contribution.yml`, label `skill`). It should name one website, one coherent workflow and at least three acceptance tasks, with the scope confirmed by a maintainer. If there is no issue, ask for one before reviewing the details.
2. List the changed files. Only `SKILL.md`, `manifest.json` and `tests/cases.json` under `skills/<skill-id>/` belong in a skill PR. Evidence goes in the PR description or comments, never in the directory.
3. Compare with the existing skills in `skills/`. A second skill for the same site is fine for a distinct job or a different browser engine, as with `bitwarden-autofill-login` and `bitwarden-autofill-login-firefox`. If it repeats an existing skill, ask whether extending that one would be clearer for users.

## 2. Checks

```bash
git fetch upstream pull/<number>/head:pr-<number>
git switch pr-<number>
npm ci
npm run validate:skills
npm test
npm run build
```

Some contributors cannot run `npm test` or `npm run build` locally. Accept that when the PR says so plainly and CI is green. An empty validation block is not acceptable.

## 3. Manifest

| Field | What to confirm |
| --- | --- |
| `target_mode` | `current_tab` when the skill works on the page the user already has open, such as filling a saved login. `fixed_domain` when it always works on one site. Anything other than `current_tab` launches on `domains[0]` (`src/repositorySkills.ts`), so a wrong value sends the user to the wrong page. |
| `permissions` | Complete and no wider than needed: `login` to sign in, `publish` to post, comment or message, `save_local_artifact` to write files. Ask about anything else. |
| `domains` | Every host the workflow actually touches, and nothing added only to satisfy the validator. |
| `operations` | Match the workflow from the allowed list. |
| `category` | Copied from an existing manifest (`id`, `title`, `icon`, `order`). A new category or icon needs maintainer approval. |
| `author` | The contributor's GitHub username, so the work stays attributed to them. |
| `verification` | `community` unless a maintainer verified the skill. `verified` also requires `min_nextctl_version`. |

The example manifest in `CONTRIBUTING.md` omits `target_mode` and `permissions`, but the validator requires both. If a contributor copied that example, point them to an existing manifest with the same kind of workflow.

## 4. `SKILL.md`

Read it as a fresh agent that knows the browser tools and nothing about the site.

| Area | What good looks like |
| --- | --- |
| Trigger | The frontmatter `description` says what the skill does and which requests should select it. Trigger guidance only in the body arrives too late. |
| Workflow | Outcome, relevant inputs, the shortest reliable path, what to verify and what the final answer contains. |
| Session | Reattaches one named profile instead of opening another, and verifies a requested proxy country before touching the site. |
| Targets | Controls found by role, label, text or a stable selector. Element IDs from earlier sessions are hints only. |
| Consequential actions | Posting, messaging, submitting a login, deleting or buying is separated from preparation and never repeated after an uncertain response without checking the result. |
| Final states | Named outcomes used consistently, with each failure path mapped to one of them. The merged autofill skills are a good model. |
| Fallbacks | No silent fallback to a default session or an unverified proxy. |
| Safety | No credentials, cookies, tokens, personal data, private URLs or captured results. The validator's credential check is only a pattern match, so read the file. |
| Claims | Nothing about the site that wasn't verified, and no implied support for sites that weren't tested. |

## 5. Acceptance cases

- At least three genuinely different tasks: the main path, a meaningful variation (a proxy, "fill but don't submit", a second site) and a failure or recovery case. Rewordings of one task don't count.
- Each `expects` entry is something you can observe in a run.
- Every expectation has a matching instruction in `SKILL.md`. An expectation with nothing behind it is a gap the agent won't fill on its own.

## 6. Evidence

| For each acceptance task | Example |
| --- | --- |
| Where it ran | NextBrowser app, fresh chat |
| Environment | OS, app version or commit, agent |
| Session | Profile name and proxy country |
| Result | Outcome and the final state reported |
| Proof | Redacted screenshot, transcript or short recording |

Runs in a standalone script or test harness help with debugging but don't replace a run in the app. If a task wasn't run, the PR should say which one and why.

## 7. Your own run

With the PR branch checked out, start `npm run dev`, connect an agent, open **Skills**, find the card marked **Repository** and press **Run**. Restart the dev process if the skill directory appeared while the app was running. Try at least the first acceptance task from a fresh chat. A green CI run does not replace browser review.

## 8. Writing the review

Open with a verdict: **approve**, **request changes** or **blocked**. Then separate the findings.

| Type | Use for |
| --- | --- |
| Blocking | Wrong `target_mode`, missing or excessive permissions, a consequential action without confirmation, secrets or personal data, an acceptance task with no evidence |
| Suggestion | Anything that would improve the skill but shouldn't hold it back |

For every finding name the file and field or line, what's wrong and the exact change you expect. Ask for fixes in the same pull request. Be direct and friendly; many contributors are opening their first pull request here.

```markdown
**Verdict:** request changes

**Blocking**
1. `manifest.json`, `target_mode`: the skill fills the login form on the page the user already has open, so this should be `current_tab`. With `fixed_domain` it opens github.com instead.
2. Evidence: acceptance task 3 (vault locked) has no run. Please run it from a fresh chat and add the result, or say why it can't be tested.

**Suggestions**
- `SKILL.md`, Recovery: say what to report when the extension icon never appears, so the agent doesn't retry forever.

Checks run: `npm run validate:skills` ✅, CI ✅, first acceptance task in `npm run dev` ✅.
```

## Common blockers

| Problem | What to ask for | Seen in |
| --- | --- | --- |
| Skill acts on the current page but launches on a fixed site | Set `target_mode` to `current_tab` and stop navigating away unless the user names a site | #221 |
| Evidence comes from a harness, not the app | Re-run each task in NextBrowser from a fresh chat and attach the results | #299 |
| Manifest copied from the `CONTRIBUTING.md` example | Add `target_mode` and `permissions` based on a similar existing skill | — |
| Acceptance task with no instruction behind it | Add the missing step or recovery path to `SKILL.md` | — |
| Empty validation section in the PR | List the commands run and their results, or why one couldn't run | — |

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
