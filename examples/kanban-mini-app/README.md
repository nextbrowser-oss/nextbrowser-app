# Kanban mini app

A standalone Nextbrowser Mini Apps v1 example. Create tasks, edit titles and notes, move tasks between To do, In progress and Done, or delete them. Moving works by drag-and-drop or through the task buttons and the edit dialog. Each board is private to the installation and account on this device.

Run `npm run build` in this directory using Node.js 22. The build has no npm dependencies. In Nextbrowser, open **Extensions → Mini Apps → Install from file**, select `kanban.nbmini.json` and grant access to the app's own storage.

To make your own app, change `id`, `name`, `description` and `version` in `manifest.json`. Edit `index.html`, `board.css` and `board.js`. The builder inlines the assets into a portable package. Applications use standard DOM APIs and the host's revisioned JSON storage at `/state`. Read the [v1 authoring guide](../../docs/mini-apps.md) for the package contract, quotas and error handling.

The bundled catalog version is reproducible from the desktop repository root with:

```sh
node examples/kanban-mini-app/build.mjs electron/mini-apps/catalog/kanban.nbmini.json
```
