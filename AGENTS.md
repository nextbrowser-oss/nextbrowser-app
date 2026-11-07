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

## Live architecture

Live viewing and control must go through the Nextbrowser backend. A profile may run on a separate VPS, so do not add a direct desktop-to-profile stream or a local fallback that bypasses the backend.

## Renderer architecture and shared UI

- We are migrating to Feature-Sliced Design incrementally. Follow `docs/architecture/fsd.md`; do not move unrelated legacy code or create empty layers for symmetry.
- Before writing UI, inspect `src/shared/ui` and reuse its components. Extend an existing generic component when appropriate instead of duplicating its behavior or styling in a feature.
- Import shared components through their public API (`shared/ui` or the component's directory index), not internal implementation files.
- Keep `shared` independent of product state, entities, features, legacy components and Electron integrations. Pass product-specific content and callbacks from callers.
- Use `Tooltip` for element hints and `TooltipContent` for controlled rich hints such as charts. Mount one `TooltipProvider` at app initialization. Do not introduce native HTML `title` hints or CSS pseudo-element tooltip implementations; semantic iframe titles remain valid.
- Shared UI colors must use the tokens in `src/palette.css`, including both themes. See `src/shared/AGENTS.md` for local rules.

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
