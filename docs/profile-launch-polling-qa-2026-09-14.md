# Profile launch polling follow-up

The packaged local app initially available for this branch was from September
10, older than commit `5ce23e0`. It is not evidence for that commit. A fresh
macOS arm64 package was built with Electron 43 and ad-hoc signing; the packaged
main process and runtime configuration matched the source bytes. No release
was published and the installed application was not replaced.

## Visible reproduction and diagnosis

Through the desktop UI, an existing stopped profile was started. It showed
Starting, then Stopped, but a subsequent app opening showed Running. This is
not proof of a browser crash. A regression test independently demonstrated
that `loadProfiles()` can overwrite Starting with Stopped while the launcher
promise is still pending. The existing timer guard does not protect a status
request already in flight or another explicit refresh.

The fix tracks the pending launch's operation epoch. At refresh commit time,
non-running statuses retain Starting only while that same launch is pending.
Running remains authoritative, a newer stop supersedes the launch, and settling
the launcher removes the guard. This does not declare a stopped browser ready
or introduce an immediate failure for an eventually consistent status query.
An experimental immediate-readiness assertion was discarded, not shipped.

## Retest and limits

The packaged fix was launched through the UI, with the same profile initially
stopped. Observed transitions were Starting → Running and, after the test,
Stopping → Stopped. No intermediate Stopped was observed on that retest; this
single sampled journey does not prove absence of every timing race.
Checking official runtime updates while the profile ran did not stop it.
All runtimes were already current, so no actual update-install/defer transition
was exercised. The environment used installed nextctl 1.2.10 and ClawBrowser
1.0.5, not the isolated Linux privacy candidate or patched nextctl build.

The full test run before the additional stop-supersession regression passed
581 Vitest tests and 271 Node tests, including the macOS PTY smoke test.
Build and packaging passed. Focused tests cover stopped/unknown/running polls
and cleanup after launcher settlement, plus a newer stop operation.

Live View separately reported Live with tabs but its video element reported
media playback failure. It is not a passed remote-control journey. No viewer
URLs, credentials or private account details are included here. This follow-up
does not close the PixelScan, all-platform Chromium, or real update-install
acceptance gates.
