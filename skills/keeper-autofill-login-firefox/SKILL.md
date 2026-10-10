---
name: keeper-autofill-login-firefox
description: Autofill a saved Keeper login into the currently focused sign-in form using the Keeper browser extension's KeeperFill in-field autofill. Use when a user asks to log in, sign in to, or fill saved credentials into a website with Keeper, including when the vault turns out to be locked or the site requires a second factor.
---

# Keeper Autofill Login

## Goal

Fill a website's sign-in form with the correct saved Keeper record using the KeeperFill
browser extension, and report a clear, honest final state. The agent must never read,
type, guess, or reconstruct a password, master password, PIN, or multi-factor code
itself — Keeper is the only thing that ever touches the actual secret.

Tested against Keeper Password Manager extension 18.1.1 (Firefox 155). The skill targets
the latest Keeper extension release; do not pin a minimum version, but re-verify
selectors if the extension updates.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email
   and password fields, or a password field alone). If no login form is visible,
   navigate only if the user named a specific site; otherwise report
   `no_login_form_found`.
2. Click into the username or password field so KeeperFill's in-field icon attaches —
   Keeper's content script reveals the in-field lock icon on field focus, not on page
   load. Do not type anything into the field.
3. Trigger KeeperFill by clicking the Keeper in-field icon next to the focused field
   (primary path). The extension's `Alt+K` command (`_execute_browser_action`) is the
   fallback when the icon is not visible. Never open the vault UI and never look up,
   read, or retype a credential yourself.
4. If KeeperFill shows a record picker popover, do not choose automatically. Stop and
   report `multiple_matches` together with the visible record names (or labels) so the
   user can pick. Never autofill an arbitrarily chosen record.
5. If Keeper shows the vault in a logged-out or locked state, do not attempt to log in
   or unlock it yourself under any circumstances: never type a candidate master
   password, never open Keeper's settings, and never attempt a "forgot password" or
   account-reset flow on the user's behalf. Stop and report `vault_locked`, and ask
   the user to unlock Keeper themselves.
6. After a successful fill, only click the visible sign-in/submit button if the user
   asked for a full login (not just filling the form). After submitting, verify an
   actual signed-in signal — an account name, avatar, redirect to a dashboard, or a
   logout link — before calling the login successful. A submitted form without one of
   these signals is not a confirmed login.
7. If the site asks for an MFA code, device-verification prompt, authenticator push, or
   hardware key tap, do not generate, guess, retrieve, or wait indefinitely for one.
   Stop and report `mfa_required`, and ask the user to supply or approve it
   themselves.
8. On two-step sign-in pages (Google and Microsoft accounts: email first, then
   password), the first KeeperFill pass fills the email step; after the site advances
   to the password step, focus the password field and trigger KeeperFill again with
   the same record. Do not treat the intermediate step as a failure.
9. If the site shows a "Save this password?" / "Update saved login?" prompt after
   submission, leave it as-is and surface it to the user rather than clicking Save,
   Update, or Never automatically — that decision belongs to the person, not the
   agent.

## Recovery

- If the in-field icon did not appear after focusing the field, click into the
  password field once and re-focus the username field, then retry the icon click a
  single time. If it still does not appear, report `autofill_failed` — do not fall
  back to typing credentials manually.
- If the site or the browser refuses the flow (for example Google's "This browser or
  app may not be secure" interstitial), do not try to bypass it. Report
  `autofill_failed` with what was shown, so the user can decide.
- If the page navigates or the form is replaced mid-flow (for example a redirect after
  a failed attempt), re-identify the current form on the page rather than continuing
  to act on a form that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`; do not
  attempt to solve it.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, master
  password, or MFA code in any response, tool call, or intermediate reasoning shown to
  the user.
- Do not retry a locked vault or a failed MFA challenge more than once in a single
  run; repeated attempts can trigger account lockout or fraud flags, and are the
  user's call to make, not the agent's.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site and what was attempted. Never
include the credential values, master password, or MFA code in the final answer, even
in redacted or partial form.
