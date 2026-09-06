---
name: bitwarden-autofill-login
description: Autofill a saved Bitwarden login into the currently focused sign-in form using the Bitwarden browser extension's native autofill keyboard shortcut. Use when a user asks to log in, sign in to, or fill saved credentials into a website with Bitwarden, including when the vault turns out to be locked or the site requires a second factor.
---

# Bitwarden Autofill Login

## Goal

Fill a website's sign-in form with the correct saved Bitwarden item using the extension's
native autofill shortcut, and report a clear, honest final state. The agent must never
read, type, guess, or reconstruct a password, PIN, or multi-factor code itself — Bitwarden
is the only thing that ever touches the actual secret.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a password field alone). If no login form is visible, navigate only
   if the user named a specific site; otherwise report `no_login_form_found`.
2. Click into the username or password field so the browser has an active form context —
   Bitwarden's shortcut fills relative to focus, not the page as a whole.
3. Trigger Bitwarden's native autofill shortcut instead of typing or looking up anything
   from the vault: **Ctrl+Shift+L** on Windows/Linux, **Cmd+Shift+L** on macOS.
4. Wait briefly for the page to react, then check which of these states resulted before
   doing anything else:
   - **Filled successfully** — username and password fields now show masked/populated
     values.
   - **Multiple matches** — Bitwarden shows a list of saved items for the domain.
   - **Vault locked** — Bitwarden prompts for the master password or unlock method.
   - **MFA / second factor** — the site itself asks for a code, push approval, or
     hardware key after submission.
   - **Nothing changed** — no visible reaction at all.
5. If multiple items matched, do not choose one automatically. Stop and report
   `multiple_matches` together with the visible item names (or labels) so the user
   can pick. Never autofill an arbitrarily chosen item.
6. If the vault is locked, do not attempt to unlock it yourself under any circumstances:
   never type a candidate master password, and never attempt a "forgot password" or reset
   flow on the user's behalf. Stop and report `vault_locked`, and ask the user to unlock
   Bitwarden themselves.
7. If the site then asks for an MFA code, authenticator push, or hardware key tap, do not
   generate, guess, retrieve, or wait indefinitely for one. Stop and report `mfa_required`,
   and ask the user to supply or approve it themselves.
8. If the site shows a "Save this password?" / "Update saved login?" popup after
   submission, leave it as-is and surface it to the user rather than clicking Save,
   Update, or Never automatically — that decision belongs to the person, not the agent.
9. Only click the visible sign-in/submit button if the user asked for a full login (not
   just filling the form). After submitting, verify an actual signed-in signal — an
   account name, avatar, redirect to a dashboard, or a logout link — before calling the
   login successful. A submitted form without one of these signals is not a confirmed
   login.

## Recovery

- If the shortcut produced no visible change, click directly into the password field once
  and retry the shortcut a single time. If it still does nothing, report `autofill_failed`
  — do not fall back to typing credentials manually.
- If the page navigates or the form is replaced mid-flow (e.g. a redirect after a failed
  attempt), re-identify the current form on the page rather than continuing to act on a
  form that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, master
  password, or MFA code in any response, tool call, or intermediate reasoning shown to the
  user.
- Do not retry a locked vault or a failed MFA challenge more than once in a single run;
  repeated attempts can trigger account lockout or fraud flags, and are the user's call to
  make, not the agent's.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site and what was attempted. Never
include the credential values, master password, or MFA code in the final answer, even in
redacted or partial form.
