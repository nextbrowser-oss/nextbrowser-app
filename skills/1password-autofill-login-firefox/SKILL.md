---
name: 1password-autofill-login-firefox
description: Autofill a saved 1Password login into the currently focused sign-in form in Firefox using the 1Password browser extension's native autofill UI. Use when a user asks to log in, sign in to, or fill saved credentials into a website with 1Password, including when the vault turns out to be locked or the site requires a second factor.
---

# 1Password Autofill Login

## Goal

Fill a website's sign-in form with the correct saved 1Password item using the extension's
native Firefox autofill UI, and report a clear, honest final state. The agent must never
read, type, guess, or reconstruct a password, Secret Key, master password, PIN, or
multi-factor code itself — 1Password is the only thing that ever touches the actual secret.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and they specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a password field alone). If no login form is visible, navigate only
   if the user named a specific site; otherwise report `no_login_form_found`.
2. Click into the username or password field so the browser has an active form context and
   the inline 1Password icon can appear inside the field.
3. Trigger 1Password's native autofill instead of typing or looking up anything from the
   vault, trying these in order of preference:
   a. Click the inline 1Password icon inside the field and choose the matching item from the
      suggestion list. This is the most reliable path and does not depend on any keyboard
      binding.
   b. If no inline icon appears, open the 1Password toolbar popup, find the item matching the
      page's domain, and use its fill action.
   c. Only use a keyboard shortcut if the user has told you they have one configured; never
      assume a default combination is bound, since it is reassignable per browser and can be
      taken by another extension.
4. Wait briefly for the page to react, then check which of these states resulted before doing
   anything else:
   - **Filled successfully** — username and password fields now show masked/populated values.
   - **Multiple matches** — 1Password's suggestion list shows more than one saved item for the
     domain.
   - **Vault locked** — 1Password prompts for the master password, Secret Key, or biometric
     unlock.
   - **MFA / second factor** — the site asks for a code, push approval, hardware key tap, or
     another verification step after submission.
   - **Nothing changed** — no visible reaction at all.
5. If multiple items matched, do not choose one automatically. Stop and report
   `multiple_matches` together with the visible item names (or labels) so the user can pick.
   Never autofill an arbitrarily chosen item.
6. If the vault is locked, do not attempt to unlock it yourself under any circumstances:
   never type a candidate master password or Secret Key, never respond to a biometric prompt
   on the user's behalf, and never attempt a "forgot password" or account-recovery flow. Stop
   and report `vault_locked`, and ask the user to unlock 1Password themselves. Treat a
   master-password re-entry timeout mid-flow (1Password re-locking after its configured idle
   timeout) the same way: stop and report `vault_locked` rather than retrying blindly.
7. If a verification-code field appears and 1Password's own inline icon offers a saved
   one-time password for the same item, clicking it is allowed because the extension is still
   performing native autofill. Never read, copy, or type the code yourself. If the site asks
   for any second factor that 1Password does not offer through its own autofill UI, stop and
   report `mfa_required`, and ask the user to supply or approve it themselves.
8. If the site shows a "Save this password?" / "Update login?" popup after submission, leave
   it as-is and surface it to the user rather than clicking Save, Update, or Never
   automatically — that decision belongs to the person, not the agent.
9. Only click the visible sign-in/submit button if the user asked for a full login (not just
   filling the form). After submitting, verify an actual signed-in signal — an account name,
   avatar, redirect to a dashboard, or a logout link — before calling the login successful. A
   submitted form without one of these signals is not a confirmed login.

## Recovery

- If no suggestion appeared after clicking the inline icon or opening the toolbar popup,
  click directly into the password field once and retry. If it still does nothing, report
  `autofill_failed` — do not fall back to typing credentials manually.
- If the 1Password extension is missing, signed out, or cannot be opened from Firefox, report
  `autofill_failed` and ask the user to install, sign in to, or enable 1Password themselves.
- If the page navigates or the form is replaced mid-flow (e.g. a redirect after a failed
  attempt), re-identify the current form on the page rather than continuing to act on a form
  that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, Secret Key,
  master password, or one-time code in any response, tool call, or intermediate reasoning
  shown to the user.
- Do not retry a locked vault or a failed MFA challenge more than once in a single run;
  repeated attempts can trigger account lockout or fraud flags, and are the user's call to
  make, not the agent's.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site and what was attempted. Never
include the credential values, master password, Secret Key, or one-time code in the final
answer, even in redacted or partial form.
