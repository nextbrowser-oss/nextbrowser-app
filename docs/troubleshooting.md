# Nextbrowser troubleshooting

[Back to README](../README.md) · [Product guide](product-guide.md) · [Browser control reference](cli-reference.md)

Start at the account layer and move inward toward the page. Stop at the first failed or unexpected check because later symptoms may be consequences of that earlier failure.

## Fast diagnostic sequence

1. Confirm that the account and API key are accepted.
2. Confirm that proxy traffic is available for the account.
3. Select the intended profile and verify that its session is running.
4. Check the open tabs and active page.
5. Inspect page state, Live View, and a screenshot.
6. Verify browser identity when country or fingerprint consistency matters.
7. Confirm that the selected local agent is installed and authenticated.

## A local agent is not found

Confirm that the agent is installed and runs outside Nextbrowser. If discovery still fails, use the path setting supported by the installed release, restart the app, and verify the agent's own authentication.

## The API key is rejected

Use the product setup flow to store the key again and verify account identity. Do not paste the key into an issue, screenshot, prompt, or chat transcript.

## The profile is missing or stopped

Confirm the selected profile before starting a session. A profile can exist while its session is stopped, and selecting a profile does not prove that the expected page is open.

## The website is open in the wrong tab

Review the session's tabs, activate the intended tab, and inspect the current page state again. Tab identifiers and page state can change after navigation or closure.

## The page is not ready

Use Live View and diagnostics to confirm that navigation completed. Capture a screenshot and obtain fresh page state before reusing any element reference after navigation.

## Browser identity or country looks wrong

Verify the current identity first. Rotate only when the workflow is safe to restart, then re-check login state and the page because rotation can change both.

## Live View is empty

Confirm that the selected profile has a running session and an open page. If diagnostics can capture the page but Live View remains empty, collect the app version, operating system, profile status, and redacted logs for a bug report.

## A skill starts from the wrong page

Before applying a skill, confirm the selected profile, running session, active tab, current page state, and matching target domain. Preflight reduces setup errors but cannot prevent a page from changing after dispatch.

## A captcha attempt fails

Detect the challenge before choosing a handling path. There is no guarantee of detection or solving, and repeated blind retries can be throttled. Check authorization, current page state, supported handling modes, and whether human intervention is required.

## The desktop app fails locally

Reinstall exact dependencies, run the test suite, and rebuild the renderer:

~~~bash
npm ci
npm test
npm run build
~~~

If those checks pass but `npm run dev` still fails, include the terminal error, operating system, Node.js version, and exact reproduction steps in a bug report.

## What to include in a bug report

- operating system and version;
- Nextbrowser version or commit;
- affected profile name, anonymized if necessary;
- expected and actual behavior;
- the first failed check in the diagnostic sequence;
- redacted logs and screenshots;
- minimal reproduction steps.

Remove API keys, account identifiers, cookies, tokens, prompt secrets, private URLs, and personal data. Report security-sensitive behavior privately through [SECURITY.md](../SECURITY.md), not in a public issue.
