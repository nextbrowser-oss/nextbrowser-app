---
name: 1password-autofill-login
description: Autofill a saved 1Password login into the currently focused sign-in form using the 1Password browser extension's native autofill (inline field icon, toolbar popup, or a user-configured keyboard shortcut) in Firefox. Use when a user asks to log in, sign in to, or fill saved credentials into a website with 1Password, including when the vault turns out to be locked, a saved one-time code is available, or the site requires a second factor.
---

# 1Password Autofill Login

## Goal

Fill a website's sign-in form with the correct saved 1Password item using the extension's
own autofill UI, and report a clear, honest final state. The agent must never read, type,
guess, or reconstruct a password, Secret Key, master password, or verification code itself —
1Password is the only thing that ever touches the actual secret.

## Setup and prerequisites

- Firefox with the 1Password browser extension ("1Password – Password Manager") installed
  and already signed in to an unlocked vault. This workflow does not install, configure,
  sign in, or unlock the extension on the user's behalf.
- Supported version: the current 1Password 8 extension for Firefox. Its inline field icon
  and toolbar popup behavior are what this skill relies on. Keyboard shortcuts are
  user-configurable per browser (Firefox: `about:addons` → gear icon → Manage Extension
  Shortcuts), so never assume a specific key combination is bound.
- Known limitation: there is no official 1Password API or CLI that can trigger browser-form
  autofill from outside the browser. See "API/CLI vs UI-only automation" below.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and they specified which to use.

## Detecting the extension and vault state

1. Confirm the 1Password extension is present: look for its toolbar icon in Firefox, or the
   inline 1Password glyph that appears inside a recognized username/password field on a page
   with a login form. If neither is present, stop and report `extension_not_found` — do not
   attempt to install it.
2. If the toolbar icon shows a locked-padlock state, or focusing a field / opening the popup
   surfaces an "Unlock 1Password" master-password or biometric prompt instead of item
   suggestions, the vault is locked. Handle this as described under "Vault locked" below.
3. If the popup shows a sign-in screen instead of vaults and items, stop and report
   `not_signed_in` — do not attempt to sign in on the user's behalf.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a password field alone). If no login form is visible, navigate only
   if the user named a specific site; otherwise report `no_login_form_found`.
2. Click into the username or password field so the browser has an active form context and
   the inline 1Password icon appears inside the field.
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
   - **One-time code available** — after filling, the site shows a verification-code field and
     1Password's inline icon offers a stored one-time password for that same item.
   - **MFA / second factor without a stored code** — the site asks for a push approval, SMS
     code, hardware key tap, or authenticator code that 1Password has no saved one-time
     password for.
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
   one-time password for that same item, clicking it to autofill the code is an allowed
   native-autofill action — it is 1Password filling its own stored secret, not the agent
   generating or guessing one. Only take this path when the suggestion comes from 1Password's
   own inline autofill; never type a code yourself.
8. If the site instead asks for a push approval, SMS code, hardware key tap, or any second
   factor 1Password has no saved item for, do not generate, guess, retrieve, or wait
   indefinitely for one. Stop and report `mfa_required`, and ask the user to supply or approve
   it themselves.
9. If the site shows a "Save this password?" / "Update login?" popup after submission, leave
   it as-is and surface it to the user rather than clicking Save, Update, or Never
   automatically — that decision belongs to the person, not the agent.
10. Only click the visible sign-in/submit button if the user asked for a full login (not just
    filling the form). After submitting, verify an actual signed-in signal — an account name,
    avatar, redirect to a dashboard, or a logout link — before calling the login successful. A
    submitted form without one of these signals is not a confirmed login.

## API/CLI vs UI-only automation

- 1Password publishes an official CLI (`op`) and a Connect / Service Accounts API. These read
  and write vault items and inject secrets into environment variables, config files, the
  1Password SSH agent, and git-commit signing — all outside the browser.
- Neither the CLI nor the Connect/Service Accounts API exposes a way to trigger the browser
  extension's autofill, detect a page's login form, or drive the extension's popup. Browser
  form-fill is UI-only: the inline field icon, the toolbar popup, and an optional
  user-configured keyboard shortcut are the only supported entry points.
- Do not use `op` (or any other vault-reading tool) to fetch a password's value and type it
  into a page as a substitute for native autofill. That defeats the point of this skill —
  the agent never seeing or handling the raw secret — and must not be done.

## Recovery

- If no suggestion appeared after clicking the inline icon or opening the toolbar popup,
  click directly into the password field once and retry. If it still does nothing, report
  `autofill_failed` — do not fall back to typing credentials manually.
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
`multiple_matches`, `vault_locked`, `not_signed_in`, `extension_not_found`, `mfa_required`,
`no_login_form_found`, `autofill_failed`, or `captcha_required`. Name the site and what was
attempted. Never include the credential values, master password, Secret Key, or one-time
code in the final answer, even in redacted or partial form.
