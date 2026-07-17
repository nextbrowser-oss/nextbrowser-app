# Contributing

Thank you for helping improve this repository. Contributions should be focused, factual, and easy to review.

## Choose the right scope

- The repository contains the Nextbrowser Electron desktop application, its tests, packaging configuration, documentation, and community files.
- Keep UI work in `src/`, Electron integration in `electron/`, build tooling in `scripts/`, and product documentation in `README.md` or `docs/`.
- Search existing issues before opening a new one, then use the relevant structured Issue Form.
- Never report a vulnerability in a public issue, discussion, or pull request. Follow [SECURITY.md](SECURITY.md).

## Validate changes

Run the relevant desktop checks from the repository root:

```bash
npm ci
npm test
npm run build
npm run pack
```

Use `npm run dev` for interactive application testing. For documentation-only changes, also check headings, code blocks, and relative links. Changes to the canonical README must keep every translation and the i18n manifest synchronized as described in [AGENTS.md](AGENTS.md).

## Documentation standards

- Preserve commands, paths, URLs, product names, and technical terminology unless the underlying source changes.
- Do not add unverified features, integrations, metrics, platform support, installation steps, or licensing claims.
- Keep Nextbrowser and the external browser runtime responsibilities distinct.
- Use repository-relative links and verify them from the file being edited.

## Pull requests

Keep each pull request limited to one coherent change. Explain what changed, why it changed, and how it was verified. Include real screenshots for visible application changes when practical, and disclose any checks that could not be run.

Before requesting review, confirm that:

- relevant tests, lint, and build checks pass;
- documentation links and examples work;
- README translations are synchronized when required;
- no credentials, tokens, personal data, or generated build output are included.
