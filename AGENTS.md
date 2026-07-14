# AGENTS.md

## Repository boundaries

- This repository contains the runnable Nextbrowser Electron desktop application.
- Keep renderer and product UI code under `src/`.
- Keep Electron main-process, preload, native integration, and SSH discovery code under `electron/`.
- Keep build and release helpers under `scripts/` and packaging configuration in `package.json`.
- Treat the managed browser runtime as an external dependency; do not copy its implementation into this repository.

## Desktop commands

Run checks from the repository root:

```bash
npm ci
npm test
npm run build
npm run pack
```

Use `npm run dev` for interactive application testing. Use `npm run dist:mac` or `npm run dist:win` only when platform packaging is relevant.

## README internationalization

- `README.md` is the canonical English source.
- A semantic README change must update all 19 translations under `docs/i18n/<locale>/README.md` and the i18n manifest in the same change.
- Required locales are `es`, `pt-BR`, `zh-CN`, `ja`, `ko`, `de`, `fr`, `ru`, `uk`, `ar`, `hi`, `tr`, `id`, `vi`, `th`, `it`, `pl`, `nl`, and `fa`.
- Run `node scripts/validate-i18n.mjs` after any README or i18n manifest change.
- Preserve code blocks, commands, paths, URLs, product names, and technical terminology across translations.
- Recalculate image and documentation links from each nested translation directory; do not copy root-relative assumptions blindly.
- Keep every language selector complete and synchronized.

## Accuracy rules

- Do not invent features, integrations, metrics, installation commands, platform support, release details, screenshots, or licensing claims.
- Use real repository assets and real product screenshots only; label illustrative UI as illustrative.
- Keep long technical material outside the canonical README when a focused document is more appropriate.
- Never describe Clawbrowser behavior as Nextbrowser behavior without an explicit, sourced relationship.

## Change hygiene

Preserve unrelated work in the tree, keep changes narrowly scoped, and verify Markdown links and YAML syntax when relevant. Never commit credentials, API keys, private report contents, dependency directories, or generated build output.
