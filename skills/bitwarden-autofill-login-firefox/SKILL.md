---
name: bitwarden-autofill-login-firefox
description: Autofill a saved Bitwarden login into the sign-in form on the current tab of a Camoufox (Firefox) profile, using Bitwarden's own autofill-on-page-load so Bitwarden fills the form and the agent never handles the secret. On a single-page form such as GitHub it fills automatically; on a two-step page such as Google or Microsoft the agent asks the user to pick the item from Bitwarden's inline menu. Use when a user asks to log in, sign in, or fill saved credentials with Bitwarden in a Camoufox or Firefox profile, including when the vault is locked, several saved logins match, or the site asks for a second factor.
---

# Bitwarden Autofill Login (Firefox)

This skill drives the Bitwarden extension in a Camoufox (Firefox) profile. Camoufox runs
through Playwright (Juggler): the agent's key events do not reach extension shortcuts, and
Bitwarden's inline menu is drawn in a closed extension frame the agent cannot click. So the
agent never presses Bitwarden's shortcut or clicks its menu. Instead it relies on
Bitwarden's **Autofill on page load**, which the user turns on once:

- In the Camoufox profile, install Bitwarden and log in to the vault.
- Open the Bitwarden extension, go to Settings, Autofill, and turn on **Autofill on page
  load**. Bitwarden keeps this off by default for security, so this is a required setup
  step for this skill.

On a single-page sign-in form (for example GitHub) Bitwarden fills both fields on load. On
a page that asks for the email first and the password on a later page (Google, Microsoft),
the later steps load as client-side transitions, so autofill-on-load does not fire on them;
there the agent asks the user to click the saved item in Bitwarden's inline menu for each
step it cannot fill (often both the email and the password step). This two-step case is a
known limitation.

## Goal

Fill a website's sign-in form on the current tab with the correct saved Bitwarden item,
submit it only when the user asked for a full login, and report one honest final state. The
agent must never read, type, guess, or reconstruct a password, master credential, PIN, or
multi-factor code: Bitwarden is the only thing that ever touches the secret.

## Inputs

- The target tab or site. Default: the sign-in form already open on the current tab.
  Navigate only when the user named a specific site.
- Whether the user wants the form filled only, or filled and submitted. Default: fill only.
- Which saved account to use, when the user named one (item name or username).

## Workflow

1. Confirm the current tab shows a recognizable sign-in form (a username or email field, a
   password field, or both). If none is visible and the user did not name a site, report
   `no_login_form_found`.
2. Decide the match before trusting any auto-filled value. Autofill-on-load fills the
   last-used item by itself, which hides how many logins match, so first make the username
   or email field empty (clear only that field, never the password field, and never read
   its value), click into it, wait about two seconds, and take a screenshot of Bitwarden's
   inline menu:
   - "Unlock your account to view autofill suggestions", an "Unlock account" button, or a
     prompt to log in to Bitwarden: report `vault_locked` and ask the user to unlock
     Bitwarden themselves. Do not attempt to unlock it.
   - Two or more saved items, and the user did not name one: report `multiple_matches` with
     the visible item names so the user can choose, and do not submit.
   - "No items to show" or an empty menu: report `autofill_failed`; there is no saved login
     for this site.
   - Exactly one item, or the user named the exact item: continue.
3. Fill the confirmed item:
   - Single-page form (username and password on one page, such as GitHub): reload the page
     with `open` on the current URL so Bitwarden's autofill-on-load fills the form again,
     wait a couple of seconds, and confirm both fields are non-empty by testing their length
     with `evaluate` (never read or print the values). If they are still empty, see Recovery.
   - Two-step page where only the email field is present (Google, Microsoft): autofill-on-
     load does not fill the email step, and the agent cannot click the inline menu. Ask the
     user to click the single item in Bitwarden's menu to fill the email, then continue once
     they confirm it is filled. This manual click is the known limitation for two-step sites.
4. For a two-step page, after the email is filled click Next once and wait for the password
   page. The match is already decided from the email step, so do not clear or inspect the
   password field. Let autofill-on-load fill the password and confirm it is non-empty by
   length only (never read it). If it is still empty, ask the user to click the same item in
   Bitwarden's menu to fill the password, then continue. Microsoft may offer an emailed
   code, app approval, or passkey first; click its visible "Use your password" option once
   when it exists, otherwise report `mfa_required`.
5. If the user asked only to fill the form, stop here and report `filled_only`.
6. Only when the user asked for a full login, click the visible sign-in or submit button
   once. Then check the result before doing anything else:
   - A second factor (authenticator code, SMS, push approval, security key, emailed code,
     device verification, "Verify it's you"): report `mfa_required` and ask the user to
     complete it. Do not generate, fetch, or wait indefinitely for a code.
   - A captcha, bot check, or automation block (for example Google's "Couldn't sign you in.
     This browser or app may not be secure"): report `captcha_required`, quote what the page
     says, and do not attempt to solve, retry, or get around it.
   - The site reports wrong credentials: report `autofill_failed` and name the item used.
   - Never try to get around a site's sign-in, bot, or automation checks; when a site
     blocks or challenges the sign-in, stop and report what it shows.
7. If a "Save this password?" or "Update saved login?" prompt appears after submission,
   leave it as-is and surface it to the user rather than clicking anything. For Microsoft
   "Stay signed in?", answer No unless the user asked to stay signed in, and report the
   choice.
8. Before calling a login successful, verify a real signed-in signal: an account avatar, a
   dashboard or account page, or a sign-out control. Describe it without quoting the account
   name or email. A submitted form without such a signal is not a confirmed login.

## Recovery

- If a single-page form is still empty after the reload, clear the username field once more,
  reload the page a single time, and re-check. If it is still empty, report `autofill_failed`;
  do not fall back to typing credentials or to the Bitwarden CLI, and do not read any item
  from the vault.
- If the page navigates or the form is replaced mid-flow, re-identify the current form by
  role, label, or visible text rather than acting on a form that no longer exists.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, master
  credential, or multi-factor code in any response, tool call, or reasoning shown to the
  user.
- Do not retry a locked vault or a failed second factor more than once in a single run;
  repeated attempts can trigger account lockout and are the user's call, not the agent's.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site and the Bitwarden item that was
used. Never include the credential values, master credential, or multi-factor code in the
final answer, even in redacted or partial form, and do not repeat the account's username or
email.
