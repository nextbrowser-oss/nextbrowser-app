# Isolated development storage

For manual QA of the desktop app without importing an existing account, set
`NEXTBROWSER_DEV_DATA_ROOT` to an absolute, dedicated directory when running
`npm run dev` (or `npm start` after `npm run build`). Do not change `HOME`.

The opt-in development mode places Electron user/session data under `app/`,
managed browser state under `runtime/`, and the managed CLI under
`managed-nextctl/`. It skips legacy data and credential migration and leaves
the user's deep-link handler unchanged. Packaged builds reject this override;
ordinary launches without it retain their existing paths and migrations.

Use `NEXTCTL_BIN` to select an explicitly built CLI when testing an unreleased
CLI contract. Use `CLAWBROWSER_BIN` for the intended browser artifact and the
documented backend environment overrides for QA services. Do not copy production
credentials into the test root or claim a production-like pass from this setup.

This is storage separation, **not a security sandbox**: it still discovers local
agent/browser executables, can access user-selected workspaces, and can contact
configured services. Do not test agent installs, global settings, or account
mutations without checking their own scope. Do not use a shared directory or a
symlink into real user data as the dedicated root.

## Initial smoke observation (2026-09-16)

With a fresh root on macOS, the visible dev app showed zero projects/profiles,
`Sign in`, and `Update nextctl to check account`. Its discovered older CLI was
rejected by the mandatory verification-capability guard. No browser was started,
no login was attempted, and the dev app was stopped after inspection. This proves
only the initial storage/UI smoke, not successful account pairing, browser
lifecycle, runtime updates, or cross-platform acceptance.

The same rejection reproduced with the CLI built from nextctl PR26, not just an
older installed CLI. Root cause: the capability probe executed `version`, whose
API-key gate rejects an unsigned-in user. It now parses both safety flags via
`version --help`, which does not execute that authenticated pre-run. Unknown
flags still fail, as verified by a real Cobra regression; browser commands keep
their existing API-key and verification gates.

After restarting the visible app with the same fresh storage and explicit PR26
CLI, `Update nextctl to check account` changed to `Browser account not connected`
and `Sign in` remained available. Zero projects/profiles remained. No credentials
were injected and no browser was launched. The CLI version label still showed
`...`; version metadata and the post-install version check require follow-up.
The app was stopped after this bounded smoke. OAuth and profile lifecycle remain
untested.
