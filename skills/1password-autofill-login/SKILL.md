---
name: 1password-autofill-login
description: Autofill a saved 1Password login into the currently focused sign-in form of a Chromium-based (ClawBrowser) profile using the 1Password browser extension's own in-page sign-in prompt and inline menu, then verify the result. Use when a user asks to log in, sign in to, or fill saved credentials into a website with 1Password in a Chromium or ClawBrowser profile, including when the extension turns out to be locked, several logins match, or the site asks for a second factor.
---

# 1Password Autofill Login

## Goal

Fill a website's sign-in form with the correct saved 1Password item using the extension's
native filling UI, and report a clear, honest final state. The agent must never read, type,
guess, or reconstruct a password, account password, or one-time code itself. 1Password is
the only thing that ever touches the secret; the agent only drives the extension's visible
controls and reads the page's state.

## Setup and supported versions

- Chromium-based browser (Chrome, Edge, Brave, or the Clawbrowser runtime) with the
  **1Password – Password Manager** extension (1Password in the browser, version 8.x)
  installed from the Chrome Web Store.
- The extension is signed in directly with the 1Password account and unlocked. This skill
  targets the extension running on its own; it does not require or use the 1Password
  desktop app.
- Leave the extension's defaults in place unless the user asks for fill-only behaviour: by
  default 1Password signs in automatically after filling. Fill-only runs need
  **Settings › Autofill & save** in the extension with automatic sign-in after filling
  turned off. The agent must not change extension settings itself.
- At least one Login item saved for the target site.

## Official interfaces versus UI-only automation

- **No automation API in the extension.** 1Password in the browser exposes no scripting
  interface, no DOM-accessible fill function, and no page-level events. Its prompts render
  in closed extension frames, so page JavaScript cannot read or click them. Everything in
  this skill is UI automation of the extension's own controls: focusing fields, pressing
  keys, and clicking what the extension draws.
- **Keyboard shortcuts that exist for the extension:** Ctrl+Shift+X (Cmd+Shift+X on macOS)
  opens or closes the pop-up; inside the pop-up, Ctrl+Shift+F opens the selected item's
  site and fills it; Enter or Space fills the selected item in the sign-in prompt; Down
  Arrow opens **Other options**; Esc closes the prompt. Those are for a person at the
  keyboard. The browser tools available to the agent send single keys only, and in
  practice those keys reach the page rather than the extension's prompt, so the agent
  does not drive the prompt by keyboard.
- **What the agent can and cannot click:** the page-state click tool only sees page
  elements, and the prompt is not one. The CLI's `click-xy X Y` command clicks a viewport
  coordinate and does reach the prompt, with the coordinates read from a screenshot. That
  is the agent's way to operate 1Password.
- **Shortcuts that must not be used:** Ctrl+Shift+L (Cmd+Shift+L) **locks** 1Password. It is
  the Bitwarden autofill shortcut, so never reuse that habit here. Ctrl+\ (Cmd+\) is
  Universal Autofill / Auto-Type of the 1Password desktop app and does nothing with the
  extension alone.
- **Official programmatic routes exist only outside the extension:** the 1Password CLI
  (`op`), SDKs, Connect server, and service accounts read vault items for scripts, and
  **1Password for Claude** (agentic autofill, macOS with the desktop app, Claude desktop or
  Claude in Chrome) fills logins for an AI agent with a per-login approval prompt. None of
  them drive the standalone browser extension, and reading a secret through `op` is outside
  this skill's scope and permissions.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and signed in.
- Browser profile, if the user's setup uses more than one and specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a single email or password step). If no login form is visible,
   navigate only if the user named a specific site; otherwise report
   `no_login_form_found`.
2. Confirm the extension is present and unlocked before touching the form. A 1Password
   icon inside the focused field, or a sign-in prompt appearing at the top of the page,
   means it is installed and unlocked. If the icon or prompt shows a lock or asks for the
   account password, go to step 8. If nothing from 1Password appears at all after
   clicking the field and waiting two seconds, take a screenshot and look again: the
   prompt is drawn by the extension and is invisible to page state, so only a screenshot
   shows it. Still nothing means the extension is missing, disabled or not signed in,
   which is `autofill_failed` with that reason.
3. Click into the **password** field whenever the page shows one, even if the username
   field is empty or already holds a value: 1Password fills both fields from either, its
   prompt is most reliable on the password field, and a key that slips through to the
   page there cannot submit a half-filled form. Use the username or email field only on
   a step that has no password field. Never treat a username the page itself pre-filled
   as something 1Password did. Wait three seconds, then take a screenshot. Do not press any key until the
   screenshot shows 1Password's sign-in prompt at the top of the page (site name,
   username, **Sign in**) or its item list under the field. The first keypress right
   after a page load is the one that goes astray: the extension has not attached yet,
   the page receives the key, and an empty form gets submitted. If the screenshot shows
   no prompt, wait three more seconds, click the field again, and screenshot again, up
   to three times, before deciding anything.
4. Fill by clicking 1Password's own UI, not by keyboard. Keys sent by the browser tools
   land in the page, not in the extension: ArrowDown dismisses the prompt and Enter
   submits the page's form. So, from the screenshot, locate one of these targets and
   click it with the CLI at its screenshot coordinates:
   - the item row in the 1Password list that opens under the focused field (site logo,
     title, username), the largest and most reliable target; if the list is not open,
     click the small 1Password icon at the right end of the field once to open it, then
     screenshot again;
   - or the **Sign in** link in the 1Password bar at the top of the page.
   The command is `nbc click-xy X Y --profile <profile> --json`, with X and Y taken from
   the screenshot. Check the screenshot's pixel size against the viewport size reported
   by the page state and scale the coordinates if they differ. Read the item title first:
   if it is the login the user asked for, or the only sensible one, click it. With
   default settings 1Password fills both fields and submits the form; with automatic
   sign-in turned off it only fills. Take a screenshot afterwards to confirm the fields
   filled or the page moved on.
5. Two-step sign-in pages (Google, Microsoft and similar: email first, the password on a
   second screen) are two fills, not one. After 1Password fills the email step, advance
   with the page's own **Next** or **Continue** button, a normal page element. When the
   password step appears, click the password field and run the same fill routine again.
   An interstitial such as Microsoft's "Stay signed in?" is part of the site's flow: pick
   **No**, then continue the check. If the site offers to email or text a code *instead
   of* the password and shows a link such as **Use your password** or **Sign in with
   password instead**, click that link and continue with the password step; that is a
   choice of sign-in method, not a second factor. A code demanded *after* the password
   was accepted is a second factor and is reported as `mfa_required`. Report `filled_and_submitted` only after the
   signed-in signal of step 11; a filled first step is never a success on its own.
6. If the prompt offers several items, or the suggested item is not the one the user
   named, click **Other options** in the prompt with `click-xy`, as in step 4, to open the
   list. If the user named the account to use, click exactly that item's row by its title
   or username. Otherwise do not choose: click nothing more, stop, and report
   `multiple_matches` with the visible item titles so the user can pick. Never fill an
   arbitrarily chosen item.
7. Wait briefly for the page to react, then check which of these states resulted before
   doing anything else:
   - **Filled** — the username and password fields now hold values (the password shows
     as masked dots) and, with automatic sign-in on, the page is submitting.
   - **Locked** — 1Password asks for the account password or shows a lock screen.
   - **MFA / second factor** — the site asks for a code, push approval, security key, or
     passkey after the credentials were submitted.
   - **Confirmation prompt** — 1Password asks the user to approve the fill (the
     **Ask before filling** setting). Leave it to the user; do not click Approve.
   - **Nothing changed** — no prompt, no inline icon, and empty fields.
8. If 1Password is locked, do not attempt to unlock it under any circumstances: never type
   a candidate account password, never use a "forgot password" or recovery flow on the
   user's behalf. Stop and report `vault_locked`, and ask the user to unlock 1Password
   themselves. The standalone extension locks on its own after the idle time set in
   **Settings › Security**, when the device sleeps, and always when the browser quits, so
   this state is normal and not an error.
9. If the site then asks for an MFA code, authenticator push, security key tap, or
   passkey, do not generate, guess, retrieve, or wait indefinitely for one. 1Password may
   offer to fill a one-time code from the item; only accept that if the user asked for a
   full login and the extension offers it on its own. Otherwise stop and report
   `mfa_required`, and ask the user to supply or approve it themselves.
10. If 1Password shows its in-page **Save** or **Update** prompt after sign-in, leave it
   as-is and tell the user it appeared rather than clicking Save, Update, or Never. That
   decision belongs to the person, not the agent.
11. Only submit the form yourself (click the visible sign-in button) if the user asked for
    a full login and 1Password filled without submitting. After any submission, verify an
    actual signed-in signal, such as an account name, avatar, dashboard redirect, or
    logout link, before calling the login successful. A submitted form without one of
    these signals is not a confirmed login.

## Recovery

- Try the fill routes in this order, one attempt each, and take a screenshot after each
  to see whether the fields filled or the page submitted:
  1. the coordinate click on the item row under the field (step 4);
  2. the coordinate click on **Sign in** in the top bar;
  3. keyboard, last and once: click the password field, wait three seconds, confirm the
     prompt in a screenshot, press Enter alone. Never press ArrowDown; it closes the
     prompt. Keyboard is unreliable with these tools, which is why it comes last.
- Judge "the page submitted" only by a URL change, a loading state, or a new page in the
  screenshot. A red validation message such as "Please enter your email address" is not
  evidence of a submission: many pages show it as soon as a field is focused and left
  empty, with nothing submitted. If the fields are still empty and the URL did not
  change, nothing happened yet; go to the next route on the same page without reloading.
- Only if the URL changed or the page clearly reloaded with empty fields did the Enter
  go to the page. Then reload the login page before the next route.
- Two-step forms (username first, then a Continue button, then the password on a new
  step) are handled one step at a time: run the same routine on the username step, let
  1Password or the page move to the password step, then click the password field and
  run the routine again. A filled username with the password step still pending is not
  a failure.
- Every failed Enter that reaches the page is a failed login attempt against the site,
  and sites throttle those. Stop after the three routes; do not loop.
- If clicking the field produced no prompt and no inline icon, click directly into the
  password field once and retry. If still nothing, report `autofill_failed`; do not fall
  back to typing credentials manually.
- If the prompt disappears before Enter is pressed, click the field again to bring it
  back; do not press Enter blindly, because the page's own submit handler would run on an
  empty form.
- If the login page says the account is already signed in (for example "You are already
  logged in as …" with a Continue button), do not submit the form and do not report
  `filled_and_submitted`. Tell the user the browser already holds a session for that site
  and stop, unless the user asked to sign in as a different account.
- If the page navigates or the form is replaced mid-flow (for example a two-step login
  that shows the password field only after the email), re-identify the current form and
  repeat from step 3 on the new field. Do not restart the browser profile.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it.
- Never log, echo, caption, or otherwise repeat the password, account password, or a
  one-time code in any response, tool call, or intermediate reasoning shown to the user.
  Copying the password from the pop-up (Ctrl+Shift+C) is forbidden.
- Do not retry a locked extension or a failed MFA challenge more than once in a single
  run; repeated attempts can trigger account lockout or fraud flags, and that is the
  user's call to make, not the agent's.

## Known limitations

- Fill-only requests depend on the extension setting for automatic sign-in after filling.
  If the site submitted anyway, report `filled_and_submitted`, not `filled_only`.
- Sign-in prompts for passkeys and "Sign in with Google/Apple/…" providers are shown by
  the same prompt; this skill only covers username and password Login items.
- Business accounts can enforce **Ask before filling** and auto-lock rules that make the
  user's approval mandatory on every fill.
- The extension's frames are invisible to page scripts and to page-state tools, so
  detection relies on screenshots and on the field values, not on DOM access.
- Keys sent by the browser tools usually reach the page, not the prompt, so on some pages
  Enter submits the form before 1Password can take it. That is why the keyboard route
  comes last and runs once.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site, the item title that was used (never
its password), and what was attempted. Never include credential values, the account
password, or a one-time code in the final answer, even in redacted or partial form.
