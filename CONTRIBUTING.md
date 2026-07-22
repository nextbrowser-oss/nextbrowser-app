# Contributing to NextBrowser

Thank you for helping improve NextBrowser. Contributions of all sizes are welcome: bug reports, documentation fixes, tests, design improvements, and new features.

Please keep contributions focused, factual, and easy to review. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small bug fix, documentation correction, or test improvement, feel free to open a pull request directly.
- For a large feature, architectural change, or new dependency, open an issue first so the approach can be discussed before significant work begins.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Git, a current Node.js LTS release, and npm. Platform packaging may also require the native tools expected by Electron Builder.

Fork the repository, clone your fork, and install the exact locked dependencies:

```bash
git clone https://github.com/YOUR-USERNAME/nextbrowser-app.git
cd nextbrowser-app
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
- `scripts/` — build and maintenance helpers.
- `public/` and `build/` — application assets and packaging resources.
- `docs/` — product documentation and README translations.

The managed browser runtime is an external dependency. Do not copy its implementation into this repository or describe its behavior as native NextBrowser behavior without a verified source.

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
