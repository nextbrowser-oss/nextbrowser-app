# Incremental Feature-Sliced Design

The renderer is migrating gradually. New context-free UI lives in `src/shared/ui`; legacy product components can remain in `src/components` until their feature is migrated. Do not manufacture empty `entities`, `features`, `widgets` or `pages` directories.

Before implementing UI, inspect and reuse the shared components. Put product decisions, store access and Electron calls in the caller; pass content, state and callbacks to the shared primitive. Dependency direction is from application/product code towards shared, never back upwards.

Import `Tooltip`, `TooltipProvider` and `TooltipContent` from `shared/ui` (using a relative path appropriate to the caller). Each shared component has a directory `index.ts`; implementation files stay private. Internal imports within a component use relative file paths. There is no root `shared/index.ts`.

The existing palette in `src/palette.css` remains the color source during migration. Tooltip rendering, interaction, placement and glass styling belong to the shared tooltip module; features supply their own text or rich content. Keep one provider at the renderer entry point. See the [tooltip usage guide](../../src/shared/ui/tooltip/README.md).

Project folders reuse existing `Conversation` records. The original project's ID and history remain its main session; independent sessions reference it through `projectId` in the same persisted/synced document. `ProjectTree` renders that relationship in the permanent rail's Projects popover and the workspace management dialog. It is product UI and stays outside `shared`; generic popover, dialog, icon actions and glyphs come from `shared/ui`. The titlebar workspace switcher uses the existing workspace selection and creation/deletion flows.

The reusable `shared/ui/tree` adapts FractalUI's MIT-licensed Tree at a pinned revision (see its `UPSTREAM.md`), using our CSS/palette rather than importing the kit's theme. `ProjectTree` maps folders/sessions to generic nodes. Store-side move validation enforces workspace boundaries and keeps the original main session in its folder; ordering is persisted in the same conversation document through `projectOrder`/`sessionOrder`. Tree handles search/filter pruning internally, and product persistence stays outside shared.

## Agent guidance evaluated

Use the [official Feature-Sliced Design skill](https://github.com/feature-sliced/skills/tree/master/feature-sliced-design) as the primary FSD reference. It is maintained in the methodology's own organization and recommended by the [official LLM documentation](https://fsd.how/docs/llms/). The reviewed revision is `5e95aaebb84541742686e56352b7569acf4306f1`; its package includes layer, public-API and migration references plus evaluation cases. It covers FSD v2.1 and is a better starting point than unmaintained copies of generic architecture prompts.

The skill has been reviewed, not globally installed by this change. Its guidance supports incremental adoption; project instructions additionally require reuse of existing shared UI. Keep these repository instructions as the durable rules regardless of the agent's installed skills.

Further primary references: [layer structure](https://fsd.how/docs/reference/layers/), [public APIs](https://fsd.how/docs/reference/public-api/) and [Steiger architecture linter](https://github.com/feature-sliced/steiger). Steiger is a linter, not a skill. Evaluate it when more layers are migrated rather than applying a full FSD lint policy to the entire legacy tree now.
