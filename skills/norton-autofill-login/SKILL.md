---
name: norton-autofill-login
description: Autofill a saved Norton Password Manager login into the currently focused sign-in form by opening the Norton extension's inline picker and selecting the saved item (click-to-fill, since Norton has no autofill keyboard shortcut on Chromium). Use when a user asks to log in, sign in to, or fill saved credentials into a website with Norton, including when the vault turns out to be locked, several saved items match, or the site asks for a second factor.
---

# Norton Autofill Login

## Goal

Fill a website's sign-in form with the correct saved Norton Password Manager item through
the extension's own inline picker, and report a clear, honest final state. The agent must
never read, type, guess, or reconstruct a password, vault passphrase, PIN, or multi-factor
code itself. Norton is the only thing that ever touches the actual secret.

## How Norton differs from other managers

- Norton has no autofill keyboard shortcut on Chromium. Filling is click-to-fill: a Norton
  icon sits inside the username field; clicking it opens a picker that lists the saved
  items for the domain; clicking one row fills both fields.
- The picker is a cross-origin extension iframe (`chrome-extension://...`). DOM clicks,
  synthetic events and keyboard navigation do not reach it. Only a real click at viewport
  coordinates works. The NextBrowser CLI provides it:
  `nextctl --profile <profile> click-xy <x> <y> [--frame-url <url>]`
  (`x`, `y` are viewport CSS pixels of the running profile's active tab).
- Run a `click-xy` on its own. Never issue it while another browser tool call (MCP) is
  still in flight; a parallel call fails with "CDP endpoint is not reachable".
- The picker animates its height for about one second after opening. Clicking a row
  before the animation ends lands on nothing.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and specified which to use.
  Reattach to the running profile; do not start a second instance of a profile that is
  already open, because that restarts the browser and locks the vault again.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a password field alone). If no login form is visible, navigate only
   if the user named a specific site; otherwise report `no_login_form_found`. If the site
   already shows a signed-in account, do not open Norton: report `no_login_form_found` and
   say the account is already signed in.
2. Click once into the username (or email) field so it has focus, then take a screenshot
   and locate the Norton icon drawn inside that field, at its right edge. Norton draws the
   icon, and fills, only for a focused field it recognizes; if the icon is still absent,
   wait a moment and screenshot again.
3. Open the picker with one `click-xy` on the icon's centre. A plain click on the field
   through the browser tools may not open it; the coordinate click does.
4. Wait about one second, then screenshot again and read the picker before touching it.
   Decide which state applies:
   - **One saved item listed**: the normal case. Continue with step 5.
   - **Two or more items listed** (several rows, or a badge count above one): stop and
     report `multiple_matches` together with the visible item labels so the user can pick.
     Never click a row when more than one item matches.
   - **"Unlock your vault?" or any unlock prompt**: stop and report `vault_locked`. Never
     type a candidate vault passphrase, never try a recovery or reset flow, and ask the
     user to unlock Norton themselves.
   - **Nothing opened**: go to Recovery.
5. Click the single row with `click-xy`. Read the row's position from the screenshot, or
   from the picker iframe's bounding box in the page (the `chrome-extension://` iframe):
   with the picker at its final size the first row's centre is about 180 px right of the
   iframe's left edge and 103 px below its top edge. Confirm in the screenshot that the
   coordinates fall on the row before clicking.
6. Verify the fill: both the username and the password fields now show values (the
   password masked). Never read, log or repeat the values.
7. If the user asked to fill only, stop here and report `filled_only`.
8. If the user asked for a full login, click the visible sign-in/submit button. On
   username-first sites (Microsoft, Google) the password field appears on a second screen:
   focus it and repeat steps 2 to 6 for it before submitting. Then check what the site
   shows:
   - A signed-in signal (account name, avatar, dashboard, logout link): report
     `filled_and_submitted`. A submitted form without one of these signals is not a
     confirmed login.
   - A code, authenticator push, security-key or passkey prompt: do not generate, guess,
     retrieve or wait indefinitely for it. Report `mfa_required` and ask the user to supply
     or approve it themselves.
9. If Norton shows "Update saved login with new password?" (Update / Save as new) or a
   "this password has been compromised" alert at any point, leave it as it is and surface
   it to the user. Never click Update, Save or Never on the user's behalf.

## Recovery

- If the picker did not open, click once into the username field with the browser tools,
  wait a second, and retry the icon `click-xy` a single time.
- If the row click filled nothing (usually the picker was still resizing), wait a second,
  screenshot, and retry the two clicks (icon, then row) once. If it still fails, report
  `autofill_failed`. Do not fall back to typing credentials manually.
- If the page navigates or the form is replaced mid-flow, re-identify the current form on
  the page rather than continuing to act on a form that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, vault
  passphrase, or MFA code in any response, tool call, or intermediate reasoning shown to
  the user.
- Do not retry a locked vault or a failed MFA challenge more than once in a single run;
  repeated attempts can trigger account lockout or fraud flags, and are the user's call to
  make, not the agent's.

## Completion

State the final outcome plainly, using exactly one of these names, spelled as written:
`filled_and_submitted`, `filled_only`, `multiple_matches`, `vault_locked`, `mfa_required`,
`no_login_form_found`, `autofill_failed`, or `captcha_required`. Do not invent other names
(for example `signed_in` or `2fa_required`). Name the site and what was attempted. Never
include the credential values, vault passphrase, or MFA code in the final answer, even in
redacted or partial form.

## Supported setup and known limitations

- Norton Password Manager extension on a Chromium runtime profile, tested with the Chrome
  Web Store build in October 2026: the NextBrowser release build on Windows 11 with a
  direct-connection profile, and the development build (`npm run dev`) on Windows 11 with a
  managed-proxy profile, on GitHub, Google and Microsoft sign-in pages.
- The coordinate click (`click-xy`) exists in the CLI only; the browser tool set has no
  equivalent, so this skill needs `nextctl` on the agent's PATH.
- Because the picker is an extension iframe, selectors, element ids and keyboard focus
  cannot be used on it; the row position comes from a screenshot or the iframe's bounding
  box, and the picker must have finished resizing.
- Norton draws its icon only in fields it classifies as login fields; unusual forms
  (custom widgets, multi-step username-first flows) may show no icon until the password
  field is reached.
