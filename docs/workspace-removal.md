# Large workspace removal (CLAW-461)

Workspace removal stops and removes exclusive profiles with at most three
concurrent operations. Profiles referenced by another workspace are excluded.
Each profile keeps the existing pending-launch cancellation, stop confirmation
and one retry after SESSION_ACTIVE. Each local profile is a separate file; no
shared profile-index rewrite is introduced.

After the first failure, no additional removals start. Already active removals
settle before the error is returned and the deletion guard is released. The
workspace and its cloud row remain available for a safe retry. Cloud workspace
deletion follows successful profile and local-artifact cleanup. Existing
idempotency, in-flight-sync barriers, shared profiles and progress remain intact.

Verification covers 60-profile concurrency, preservation of a shared profile,
one-time removal, partial failure and waiting for active operations. The manual
QA script exercises Copy diagnostics in a real Electron window with a separate
development storage root, then 120 profiles in the actual renderer/store with
mocked IPC at a fixed 25 ms latency. It compares the old sequential loop with
the bounded implementation and confirms renderer timer responsiveness:

```sh
NEXTCTL_BIN=/absolute/path/to/CLAW-522/nbc node scripts/test-support-workspaces.mjs
```

Evidence is written under ignored `e2e-out/`. The first Windows fixture run took
4,134 ms sequentially and 1,291 ms with three workers. This is a controlled IPC
benchmark, not a production filesystem or network performance guarantee. No
personal workspace/profile or production account is deleted by the script.
