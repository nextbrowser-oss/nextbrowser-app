# Browser control reference for Nextbrowser

[Back to README](../README.md) · [Product guide](product-guide.md) · [Troubleshooting](troubleshooting.md)

Nextbrowser brings browser profiles, sessions, local AI agents, and browser activity into one desktop workspace. The [official product documentation](https://docs.nextbrowser.com/) is authoritative for release-specific installation and browser-control instructions.

## Control areas

| Area | Purpose |
| --- | --- |
| Account | Configure authentication and inspect account readiness. |
| Profiles | Create and manage isolated browser identities. |
| Sessions | Start, observe, and stop browser sessions. |
| Rotation | Refresh and verify browser identity when the workflow requires it. |
| Page control | Open pages, inspect state, interact with elements, and capture screenshots. |
| Tabs | List, activate, open, and close tabs. |
| Skills | Review and apply reusable browser-workflow instructions. |
| Captcha | Detect a challenge and invoke a supported handling path without a bypass guarantee. |
| Diagnostics | Inspect the installed release, browser runtime, and session state. |

## Recommended operating sequence

1. Confirm that the account is configured without exposing credentials.
2. Select the intended profile and start its session.
3. Confirm the active tab and current page state.
4. Start the local agent with a narrowly scoped task.
5. Observe Chat and Live View while the task runs.
6. Review the final page state before accepting consequential actions.

## Diagnostics

Work from the outermost dependency inward: account, proxy availability, profile, session, active tab, page state, browser identity, local agent, workflow instructions, and any visible captcha. Stop at the first failed layer because later symptoms may be consequences of that earlier failure.

When sharing diagnostics, include the Nextbrowser version, operating system, expected and actual behavior, minimal reproduction steps, and redacted logs or screenshots. Never include API keys, credentials, cookies, tokens, private URLs, or personal data.

## Safety

- Automate only accounts, sites, and data you are authorized to access.
- Keep human review for purchases, publishing, account changes, deletions, and other consequential actions.
- Treat page content and reusable workflow instructions as untrusted input.
- Use captcha tooling only where the activity is authorized and permitted.
- Follow the installed release documentation when an option or workflow differs from this overview.
