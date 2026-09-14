# Proxy connection loss: application and CLI protection

This implementation changes NextBrowser and nextctl only. It does not establish a network firewall and does not prove that a browser runtime cannot leak traffic directly. That requires testing the exact runtime or adding browser/OS enforcement.

## Implemented

- External Chromium proxy launches additionally disable non-proxied WebRTC UDP and QUIC, and remove Chromium's implicit loopback proxy bypass. These launch flags are defence in depth, not a firewall or packet-level proof.
- Strict ClawBrowser verification creates a fresh diagnostic document rather than accepting an existing green page. The temporary tab is closed afterwards and the previous tab is restored. Cross-process locks serialize these probes; lock contention is not treated as proxy failure. Camoufox identity probes use unique query parameters to avoid reusing cached responses.
- Electron checks running profiles independently of renderer focus. The timer runs every 10 seconds, with overlapping polls suppressed. Checks have their own timeout, so detection is not instantaneous; total latency also depends on the number of profiles and running checks.
- Discovery reads profiles through the CLI and saved runtime metadata; a successful app-owned start or status also registers the profile. The monitor runs while the desktop process is alive, including when its window is hidden.
- A failed action verification or background check writes `proxy-safety-block.json` in the application data directory. Native action entry points and app-owned CLI/MCP processes respect this durable interlock. An app restart does not silently clear it. Corrupt/unreadable safety state also blocks work.
- The app cancels local command, automation, recording and picker work, terminates managed agents/terminals, and stops the affected browser. A failed safety-file write still blocks native actions in memory and attempts to stop the browser. Agent cleanup failure cannot skip the browser-stop attempt. If persistence or cleanup fails, no replacement browser is launched until safe recovery can proceed. The CLI also attempts shutdown when persistence fails or strict standalone mode has no interlock file.
- Recovery performs up to three diagnostic starts using the same profile and runtime. Each requires a new verification; unsuccessful attempts are stopped. A manual stop cancels recovery. There is no automatic direct connection or profile conversion.
- Successful recovery leaves work paused. The user reviews the interrupted action and explicitly resumes queued tasks; another fresh check is required before clearing the interlock. The interrupted action is not automatically requeued because its side effect may already have happened. The recovered browser continues to be checked while waiting.
- The existing startup flow can separately ask for explicit consent to create a direct profile after three startup failures. A running-task outage does not silently transfer its queue, cookies or browser data to a direct profile. Its recovery panel keeps the queue paused and offers retry with the original connection.

The shared interlock intentionally pauses local work broadly when ownership is uncertain. It does not attempt to infer which unrelated task can safely continue.

## Validation

`npm run test:critical` includes the monitor tests: ordering of block/cleanup/recovery, three failures, failed cleanup, persistent CLI faults, background discovery, healthy sessions, manual stop, re-verification on resume and concurrent verification.

`python3 scripts/check-critical.py` in nextctl requires tests for fresh proof creation, interprocess serialization and persistent action blocking, alongside the existing startup verification tests and compiled CLI smoke test. Full repository tests still run in CI/release workflows.

The orchestration tests use controlled browser/process responses. A separate nextctl gate, `python3 scripts/check-proxy-outage.py`, now exercises real browser traffic against controlled local HTTP/HTTPS origins, including background fetches and WS/WSS reconnections. It first proves that deliberately direct traffic is detected, then injects 407, 502 and proxy listener shutdown while both origins remain reachable directly. Each fault is observed for ten seconds, with the browser left running. The nextctl CI and release workflows require this gate against the runner's Chrome and retain JSONL evidence; a missing browser or skipped case fails the gate.

This is destination-side evidence for a bounded scenario, not a packet-level guarantee. See nextctl's `scripts/PROXY_OUTAGE_TEST.md` for launch commands and coverage limits. The full authenticated fingerprint/backend path, all shipped runtime/OS combinations, SOCKS5, DNS, WebRTC, IPv6 and longer timeout scenarios still require release validation. Direct network access outside app-owned CLI/MCP cannot be blocked solely by this implementation.

### Local outage results — 2026-09-14, macOS arm64

| Runtime | Result | Scope |
| --- | --- | --- |
| ClawBrowser 1.0.5 | Passed; zero direct requests in all three faults; direct negative control detected 14 requests | Installed binary with explicit fixed HTTP proxy flags and isolated configuration. The normal authenticated fingerprint-loading path was not exercised. |
| Camoufox 152.0.4-beta.30 | Passed; zero direct requests in all three faults; direct negative control detected 34 requests | Installed runtime using the persistent-context proxy option; test-only controller with GeoIP disabled and an isolated runtime selector. |
| DasBrowser 144.0.7559.109 | Not passed: CDP did not become ready, including with a 45-second launch timeout | No conclusion about outage routing. Resolve launch and obtain passing evidence before release. |

The ClawBrowser executable SHA-256 was `4e45fc347e6889a475315d73c9f8cbbae1e669cdc3521d44910e2ae37f60ae9f`; the DasBrowser executable SHA-256 was `38d332ccf779c124fa994c31cb74541fecb4bfc3019e39f5cc8e5165d2f05f8c`. The Camoufox installation metadata identified archive SHA-256 `3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3` (metadata, not a fresh archive-integrity verification). These local results do not imply that the new remote CI workflows have already run.
