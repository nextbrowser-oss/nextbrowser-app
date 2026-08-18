# Contributing to NextBrowser

Thank you for helping improve NextBrowser. Contributions of all sizes are welcome: bug reports, documentation fixes, tests, design improvements, and new features.

Please keep contributions focused, factual, and easy to review. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small bug fix, documentation correction, or test improvement, feel free to open a pull request directly.
- For a large feature, architectural change, or new dependency, open an issue first so the approach can be discussed before significant work begins.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Git, Node.js 22, and npm. Testing a browser skill in the desktop app requires macOS or Windows, a NextBrowser account, a connected agent, and a working browser profile. Platform packaging may also require the native tools expected by Electron Builder.

Fork the repository, clone your fork, and install the exact locked dependencies:

```bash
git clone https://github.com/YOUR-USERNAME/nextbrowser-app.git
cd nextbrowser-app
git remote add upstream https://github.com/nextbrowser-oss/nextbrowser-app.git
git fetch upstream
npm ci
```

Create a focused branch from the latest default branch:

```bash
git switch -c fix/short-description
```

Start the Vite development server and Electron application:

```bash
npm run dev
```

## Repository structure

- `src/` — React renderer, product UI, state, and renderer tests.
- `electron/` — Electron main process, preload bridge, and native integration.
- `skills/` — public browser skills contributed through focused pull requests.
- `scripts/` — build and maintenance helpers.
- `public/` and `build/` — application assets and packaging resources.
- `docs/` — product documentation and README translations.

The managed browser runtime is an external dependency. Do not copy its implementation into this repository or describe its behavior as native NextBrowser behavior without a verified source.

## Contributing a browser skill

Repository skills are public, reviewed browser workflows that ship in the NextBrowser catalog. They are source-controlled so improvements remain attributable to their GitHub contributors. Do not use the in-app **Save as skill** flow for repository contributions; that flow is for a user's private or local workflows.

#### Freelancer quick start

1. Open a **Browser skill contribution** issue with one website, one coherent workflow, and at least three acceptance tasks. Wait for a maintainer to confirm the scope before substantial work.
2. Create `skills/<skill-id>/` from the latest `upstream/main` and use [`skills/999-car-search/`](skills/999-car-search/) as the model.
3. Write `SKILL.md`, `manifest.json`, and `tests/cases.json` as described below.
4. Run `npm run dev`. If the skill directory was added while the app was already running, restart the dev process. Connect an agent, open **Skills**, find the card marked **Repository**, and press **Run**.
5. Run every acceptance task in a fresh chat with the required profile and proxy, then run the automated checks and attach redacted evidence to the pull request.

### 1. Choose and claim a workflow

Open a **Browser skill contribution** issue before starting substantial work. Specify one primary website, the concrete workflows you intend to support, and at least three acceptance tasks. This prevents two contributors from unknowingly working on the same skill.

A skill should solve one coherent, repeatable job. Good scopes include:

- searching and extracting vehicle listings from one marketplace;
- publishing a draft listing on one classifieds site;
- collecting product data across paginated search results;
- posting or replying through a specific site's composer.

Avoid vague scopes such as “use example.com,” and avoid combining unrelated operations merely because they share a domain. Multiple skills may support the same domain when they represent distinct jobs, for example:

```text
skills/
├── example-product-search/
├── example-product-posting/
└── example-order-status/
```

Before implementing a second skill for a domain, confirm that extending an existing skill would not be clearer for users.

### 2. Create the skill directory

Create one lowercase kebab-case directory under `skills/`:

```text
skills/<skill-id>/
├── SKILL.md
├── manifest.json
└── tests/
    └── cases.json
```

The directory name, manifest `id`, and YAML frontmatter `name` must be identical. Do not add generated output, screenshots, recordings, credentials, cookies, or captured website data to this directory.

Use [`skills/999-car-search/`](skills/999-car-search/) as a complete working example.

### 3. Write `SKILL.md`

`SKILL.md` has two distinct parts:

1. **YAML frontmatter** is always visible to the agent and determines when the skill is selected. Its `description` must say both what the skill does and which user requests should trigger it.
2. **Markdown body** is loaded only after the skill is selected. It tells a fresh agent how to execute the workflow without relying on the contributor's chat history, memory, or a previously captured page state.

Begin with YAML frontmatter:

```markdown
---
name: example-product-search
description: Search, filter, paginate, and extract product listings from example.com. Use when a user asks to find or compare products on example.com.
---

# Example product search
```

The `name` must match the directory and manifest `id`. Keep all trigger guidance in `description`; a body section named “When to use this skill” is too late to help selection. The validator currently requires the complete `SKILL.md` to contain at least 400 characters. That is only a sanity check, not a target: write enough to make the workflow reliable, but do not pad the file with generic browser advice.

#### What belongs in the Markdown body

Write for an agent that knows how to operate a browser but knows nothing about this particular website or workflow. The body should answer these questions where they apply:

- What outcome must the agent produce?
- Which user inputs matter, such as query, filters, proxy country, profile, or content to publish?
- Which site surface should it open, and what is the shortest reliable happy path?
- Which fields must it collect or fill, and what is the stopping condition?
- How should it verify completeness, relevance, and successful submission?
- Which site-specific failures are common, and how should it recover without restarting working sessions or repeating consequential actions?
- What should the final answer contain?

Use this recommended skeleton as a starting point. The headings are not validator requirements; omit irrelevant sections and add site-specific guidance when it improves reliability.

```markdown
---
name: example-product-search
description: Search, filter, paginate, and extract product listings from example.com. Use when a user asks to find or compare products on example.com.
---

# Example product search

## Goal

Find every relevant listing that matches the user's criteria and return verified,
deduplicated results with canonical URLs.

## Inputs

- Search query and requested filters
- Browser profile and proxy country, when specified
- Result limit or the instruction to collect all results

## Workflow

1. Start or reattach one named profile and verify the requested proxy country.
2. Open the product search surface and apply the user's filters.
3. Confirm the visible filter state before collecting results.
4. Extract title, canonical URL, price, and the requested details.
5. Paginate or scroll until the requested limit or a confirmed end.
6. Deduplicate canonical URLs and reject irrelevant matches.

## Recovery

- Resolve changed controls by role, label, text, or a stable selector.
- If navigation detaches the page, reattach to the matching tab instead of
  starting another browser session.
- Do not repeat a final publish, purchase, message, or deletion after an
  uncertain response; inspect the resulting state first.

## Completion

Return the matching results and state the stopping condition, pages inspected,
and any filters or fields that could not be verified.
```

Make instructions concrete enough to change the agent's behavior. “Search the website and return results” is not useful; naming the exact fields, relevance rules, pagination end condition, and recovery behavior is. Include only behavior that is specific or especially useful for this workflow. Cover the following when relevant:

1. Start or reattach one named browser profile instead of creating duplicate sessions.
2. If the user requested a proxy country, verify that country successfully before interacting with the website.
3. Navigate to the correct search, form, or content surface.
4. Apply the requested filters and wait for navigation or page settlement when necessary.
5. Extract the requested fields and canonical URLs.
6. Traverse pagination or infinite scrolling to the required stopping condition.
7. Deduplicate results and reject irrelevant matches.
8. Recover from stale elements, navigation, detached tabs, or changed page structure.
9. Return a concise result or request confirmation before a consequential publishing action.

Prefer semantic targets such as roles, labels, text, and stable selectors. Treat browser `element_id` values as short-lived hints; never design a workflow that depends on an element ID captured in an earlier session. Reuse a proven fast path where it remains valid, but require the agent to inspect and adapt when the page changes.

For posting, commenting, messaging, purchases, deletion, or other user-visible actions, distinguish preparation from final submission. Do not silently broaden the user's request or publish unintended content.

Never include:

- API keys, passwords, bearer tokens, cookies, or session data;
- personal information or private URLs;
- captured search results that will become stale;
- instructions to bypass access controls or conceal consequential actions;
- claims about a website that were not verified during testing.

### 4. Add `manifest.json`

The manifest supplies catalog metadata and determines where the skill appears in the UI:

```json
{
  "id": "example-product-search",
  "name": "Example Product Search",
  "description": "Search, filter, paginate, and deduplicate products on example.com.",
  "author": "your-github-username",
  "domains": ["example.com"],
  "operations": ["search", "scrape", "paginate"],
  "category": {
    "id": "marketplaces",
    "title": "Marketplaces",
    "icon": "globe",
    "order": 30
  }
}
```

Fields:

- `id` — the exact lowercase kebab-case directory name;
- `name` — concise user-facing catalog name;
- `description` — one sentence explaining the practical outcome;
- `author` — the contributor's GitHub username or organization;
- `domains` — one or more hostnames the workflow directly supports;
- `operations` — one or more supported operation identifiers;
- `category.id` — lowercase kebab-case category identifier;
- `category.title` — user-facing category name;
- `category.icon` — an icon name already supported by the app;
- `category.order` — integer controlling category order in the catalog.

Allowed operation identifiers are:

```text
search, scrape, paginate, post, comment, message, form
```

Reuse an existing category when it fits, copying its `id`, `title`, `icon`, and `order` from an existing manifest. Ask for maintainer approval before introducing a new category or icon. Do not create nearly identical categories solely to give one skill a custom heading.

### 5. Add acceptance cases

`tests/cases.json` must contain at least three distinct, realistic tasks:

```json
[
  {
    "task": "Find every matching product and include its price and canonical URL.",
    "expects": [
      "applies the requested filters",
      "paginates to the end",
      "deduplicates canonical URLs"
    ]
  },
  {
    "task": "Run the same search through a US proxy.",
    "expects": [
      "verifies the US proxy before search",
      "does not restart a verified profile"
    ]
  },
  {
    "task": "Recover when the saved selector no longer matches.",
    "expects": [
      "resolves the control semantically",
      "completes without using a stale element id"
    ]
  }
]
```

Cases are reviewable acceptance criteria, not a substitute for running the browser. Include meaningful variation: filters, pagination, proxy use, recovery, or confirmation behavior as applicable. Do not submit three cosmetic rewrites of the same task.

### 6. Validate and test locally

Install the locked dependencies and run all required checks from the repository root:

```bash
npm ci
npm run validate:skills
npm test
npm run build
```

Then test every acceptance task from a fresh agent chat so the result does not depend on hidden conversation context. For each task, record:

- operating system and NextBrowser version or commit;
- agent used;
- task text exactly as submitted;
- requested browser profile and proxy country, if any;
- pass or fail outcome;
- relevant result count or final state;
- unexpected retries, duplicate tabs, permission prompts, or recovery steps;
- elapsed time when performance is part of the skill's value.

Scraping skills should be checked for pagination, canonical URL deduplication, irrelevant-result rejection, and a clear stopping condition. Posting skills should be checked for correct field mapping, draft preservation, explicit final submission behavior, and recovery after navigation or validation errors.

Attach a redacted terminal transcript, screenshot, or short recording to the pull request as evidence. Evidence belongs in the pull request, not in the skill directory.

### 7. Open the pull request

Fork the repository, branch from the latest upstream `main`, commit the skill, and push your branch:

```bash
git fetch upstream
git switch -c skill/example-product-search upstream/main
git add skills/example-product-search
git commit -m "Add example product search skill"
git push -u origin skill/example-product-search
```

Open a focused pull request containing only one coherent skill or one clearly related improvement to an existing skill. Link the contribution issue and include:

- the supported website and workflow;
- why a separate skill is appropriate;
- all acceptance tasks and their outcomes;
- the exact validation, test, and build commands run;
- redacted evidence of successful browser runs;
- known limitations, regional behavior, or fragile website areas.

CI validates the directory, manifest, frontmatter, acceptance-case structure, and build on macOS and Windows. A green CI run does not replace browser review.

### 8. Review and release

Reviewers may request changes when a skill is too broad, duplicates an existing skill, relies on transient selectors, omits pagination or recovery, exposes sensitive data, or has not been demonstrated from a fresh chat. Keep review fixes in the same pull request.

After merge, the repository loader includes the skill in the NextBrowser catalog. Users can run it but cannot modify the public repository copy from the app. Subsequent improvements should be submitted as another focused pull request so history and authorship remain visible.

#### Contributor completion checklist

- [ ] The contribution issue identifies one website and coherent workflow.
- [ ] Directory name, manifest `id`, and frontmatter `name` match.
- [ ] Instructions verify a requested proxy before website interaction.
- [ ] Instructions avoid persistent reliance on captured element IDs.
- [ ] Pagination, deduplication, stopping conditions, and recovery are covered where relevant.
- [ ] Consequential posting actions require the intended user confirmation behavior.
- [ ] `tests/cases.json` contains at least three genuinely distinct tasks.
- [ ] Every acceptance task was run from a fresh agent chat.
- [ ] Evidence is redacted and attached to the pull request.
- [ ] `npm run validate:skills`, `npm test`, and `npm run build` pass.
- [ ] No secrets, private data, generated output, or unrelated changes are committed.

## Making changes

- Keep each contribution limited to one coherent concern.
- Match the existing TypeScript, React, CSS, and Electron conventions.
- Prefer clear product language and accessible controls with labels, keyboard behavior, focus states, and sufficient contrast.
- Preserve existing behavior unless the change intentionally replaces it.
- Add or update tests for bug fixes and behavior changes.
- Avoid unrelated formatting or dependency updates.
- Never commit credentials, API keys, personal data, dependency directories, release artifacts, or generated `dist/` output.

For visible UI changes, test both light and dark themes where applicable. Check narrow layouts, long content, loading states, errors, keyboard navigation, and disabled controls—not only the happy path.

## Required checks

Run the relevant checks from the repository root:

```bash
npm test
npm run build
npm run pack
```

Use `npm ci` when validating a clean installation. Platform-specific distribution commands are only necessary when the contribution affects packaging:

```bash
npm run dist:mac
npm run dist:win
```

If a check cannot be run on your platform, state that clearly in the pull request. Do not claim a check passed if it was skipped.

## Documentation and translations

`README.md` is the canonical English README. A semantic README change must also update all supported translations under `docs/i18n/<locale>/README.md` and the i18n manifest.

After changing the README or translation manifest, run:

```bash
node scripts/validate-i18n.mjs
```

Preserve commands, paths, URLs, product names, and technical terminology across translations. Verify relative links from the location of each translated file.

Do not add unverified features, integrations, metrics, platform support, installation instructions, screenshots, or licensing claims.

## Commits

Write concise commit messages in the imperative mood. A useful message explains the outcome rather than the activity:

```text
Fix queued message actions
Render agent replies as Markdown
Add Windows SSH config coverage
```

Keep fixups and unrelated changes out of the final history when practical. Do not rewrite history after review has started unless the reviewers expect it.

## Pull requests

A pull request should include:

- a short explanation of the problem and the chosen solution;
- links to related issues;
- the checks you ran and their results;
- screenshots or a short recording for visible UI changes;
- notable risks, limitations, migrations, or follow-up work.

Before requesting review, confirm that:

- the change is focused and contains no accidental files;
- relevant tests and builds pass;
- new behavior has appropriate test coverage;
- UI changes are usable with keyboard and assistive labels;
- documentation and translations are synchronized where required;
- no secrets, personal data, or generated build output are included.

Reviewers may request changes for correctness, maintainability, product consistency, accessibility, security, or scope. Please keep discussion constructive and resolve review threads only after the concern has been addressed or an agreement has been reached.

## Reporting bugs

A useful bug report includes the NextBrowser version, operating system, reproduction steps, expected behavior, actual behavior, and relevant logs or screenshots with sensitive information removed.

Thank you for making NextBrowser better.
