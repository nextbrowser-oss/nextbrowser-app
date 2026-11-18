# Support diagnostics (CLAW-522)

Settings → General → **Copy diagnostics** collects a support report in the main
process and copies it to the local clipboard. No message is sent automatically.
The report includes app and CLI versions, OS/architecture, installed browser
runtime versions, the resolved CLI config source, API-key presence, bounded
authorization validation and recent error codes/Refs.

Only explicitly selected fields are copied. Keys, cookies, proxy credentials,
environment variables, raw stdout/stderr, stacks, logs, chat and page contents are
excluded. Home directories are scrubbed. Error references remain usable even
after the reporter has flushed the original event; the local in-memory metadata
ring is bounded to 20 entries and follows the reporter's existing privacy switch.

Diagnostics do not install or update a CLI/browser. Older CLI releases without
the schema produce an `upgrade_required` partial report. The full report needs
the matching CLAW-522 nextctl release. CLI `debug --check-auth --json` uses a
three-second auth timeout and distinguishes a rejected key from an unavailable
service. The old `install_log` output is preserved for CLI compatibility but is
never copied wholesale into the app's report.
