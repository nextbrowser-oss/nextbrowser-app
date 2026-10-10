---
name: norton-autofill-login-firefox
description: Fill a website's current sign-in form with a saved Norton Password Manager login in a NextBrowser-managed Firefox/Camoufox profile. Use when the user asks to sign in with Norton or fill saved credentials without submitting, including locked-vault, multiple-login, and second-factor cases.
---

# Norton Firefox Autofill Login

## Goal

Use Norton's native autofill controls to fill the intended website login and report
the observed outcome. Norton handles the secrets. Never read, type, copy, reveal,
export, reconstruct, or report a username value, password, vault credential, PIN,
recovery code, or verification code.

## Inputs

- Target tab or website; use the current tab unless the user names another site.
- Fill only, or fill and submit. If the request is ambiguous, fill only.
- The user's selected Firefox/Camoufox profile.
- A non-sensitive saved-item label, if the user has already chosen an account.

The user must have installed Norton, signed in, created a test vault, and saved
the intended website login. Account creation, vault setup, imports, and credential
changes are not part of this skill. Use a verified managed session and the
NextBrowser backend; do not substitute another browser or an operating-system
automation path when managed controls are unavailable.

### Setup and compatibility

Use a dedicated NextBrowser-managed Camoufox profile with only Norton Password
Manager installed from Mozilla's official add-on listing. The user signs into
Norton, creates or unlocks the vault, and saves their own test logins before Run.
Observed setup: Camoufox 156.0.1-beta.34, Camoufox Python 0.5.7, and Norton
8.3.1.1495. Native autofill was observed on GitHub, Google, and personal Microsoft
sign-in forms; Microsoft stopped at email verification. Other versions and
enterprise Microsoft flows were not validated. This is UI-only integration:
no supported Norton autofill API, CLI, or Firefox shortcut was used or validated.
The tested launcher required the extension-tab option described in Recovery.

## Workflow

1. Confirm the selected runtime is Firefox/Camoufox and obtain a finalized,
   passing NextBrowser verification result for this exact session before reading
   or acting on the website. A running status alone is not verification. If the
   result is unavailable, call the managed `verify` tool for the selected profile.
   Preserve the target tab: the runtime may create and close temporary diagnostic
   tabs for its required checks. This is session verification, not a change of
   the requested login website; do not navigate the target tab to another site.
   If necessary, reactivate the original target tab after verification. Stop on
   failed, incomplete, or unsupported verification. Confirm the target hostname and
   a visible username/password, username-only, or password-only sign-in form.
   Navigate only to a site the user requested. If there is no recognizable login
   form, report `no_login_form_found`.
2. Identify Norton's icon inside the sign-in field and open its native fill UI.
   Resolve controls from the current visible state, not saved element IDs. Do not
   use Bitwarden's shortcut: no Norton keyboard command has been verified for
   this Firefox workflow. If Norton's field control is absent, inspect its
   browser-extension control only if the managed backend exposes it. Do not
   derive an extension URL or access extension storage/background APIs.
   Norton 8.3 displays its in-field panel in an extension iframe. A page snapshot
   that lists only the website's controls does not prove the panel is absent.
   The panel can appear after the opening action returns. Wait for the managed
   page to settle and request fresh state. If that snapshot still contains only
   website controls, allow one additional bounded settle (up to five seconds)
   and fresh state before deciding that extension controls are unavailable.
   A saved-item button with the intended neutral label is an exposed Norton
   control; do not report an inaccessible iframe when that button is available.
   Inspect the visible Norton panel without exposing credential fields. If the
   backend cannot target its controls, report `autofill_failed` rather than
   submitting the website form or using a native desktop fallback.
3. Classify the visible Norton state before selecting a saved item:
   - An explicit vault unlock request means `vault_locked`. Stop and ask the user
     to unlock it. A Norton account sign-in or first-run setup screen is an
     incomplete prerequisite; report `autofill_failed` with that reason. In the
     observed signed-out panel, the yellow **Sign In** button belongs to Norton,
     not the website. Do not confuse it with an unlocked vault or website login.
   - More than one matching login, without an explicit user choice, means
     `multiple_matches`. Stop before selecting or submitting. Offer only neutral
     item labels; if labels contain account identifiers, describe them as the
     first/second visible item and let the user choose directly.
   - No matching item means `autofill_failed`. Ask the user to save or correct the
     matching URL themselves. Never search the vault for credential values.
4. For a single intended match, use only an observed Norton action that fills
   the current form. For fill-only, first confirm the action does not submit or
   navigate. Verified on GitHub with Norton 8.3.1.1495: choosing the matching
   saved-item button in the in-field Norton panel fills both required fields
   and leaves `github.com/login` unsubmitted. The website's **Sign in** is a
   separate action. The saved-item button uses its item label, not necessarily
   the word "Fill". Use this verified in-field action for the same workflow;
   **Open Web App** opens the vault and is not the fill action. For an unfamiliar
   action whose automatic submission cannot be ruled out, stop with
   `autofill_failed`; never experiment with a sign-in action on the user's behalf.
   Do not alter vault or item settings to make this possible.
5. Check only masked/populated-state indicators. On required fields, the boolean
   `required` and `validity.valueMissing` properties can confirm a nonempty
   state without reading `.value`; use this only if the field is actually required.
   A false `valueMissing` on an optional field proves nothing. Never inspect input
   values, reveal a password, copy credentials, capture the full form DOM, or
   include credential fields in screenshots or transcripts. If filling succeeds
   and the request is fill-only, report `filled_only`. Do not click Sign in, Next,
   Continue, Submit, or press Enter.
6. For an authorized full login, inspect the current page before clicking its
   sign-in control once. If Norton already caused navigation, inspect the result
   instead of submitting again. On Google and Microsoft identifier-first forms,
   use the page's own **Next** control, identify the newly shown password form,
   and repeat the native Norton fill selection for that step. Advance
   only within the user's requested sign-in flow.
7. After submission, check for these states before declaring success:
   - Verification code, device/email confirmation, authenticator approval, or
     security-key request: stop with `mfa_required`. Do not read an inbox,
     generate or retrieve a code, approve a prompt, or wait indefinitely.
   - CAPTCHA or bot challenge: stop with `captcha_required`.
   - A clear authenticated account view or logout control: report
     `filled_and_submitted`. A changed URL or submitted form alone is insufficient.
   - Rejected credentials, an unchanged form, or an uncertain result: report
     `autofill_failed`, describing only the non-sensitive observation.
8. Leave any Save, Update, Never save, or account-permission prompt for the user.
   Do not create or modify a saved item during the login workflow.

## Recovery

- If the Norton fill UI does not appear, refocus the current field and try its
  visible Norton control once. If still unavailable, report `autofill_failed`.
  Never fall back to typing, the clipboard, a different password manager, or an
  unverified keyboard shortcut.
- If Norton setup closes without opening account sign-in, report the incomplete
  prerequisite as `autofill_failed`; do not keep retrying. A confirmed
  `lastError:createTab: Rejected by Camoufox` diagnostic means the runtime blocked
  the extension's new tab. The supported Camoufox launch option is
  `allow_addon_new_tab=True`; have the runtime owner configure it outside this
  autofill workflow. Do not patch the runtime, inspect extension storage, or
  synthesize authentication URLs during a login task.
- After navigation or replacement of the form, obtain fresh controls. Do not
  reuse indexes or assume that the previous account selection still applies.
- A timeout after a click has an unknown outcome. Inspect the resulting page
  before any further action; do not repeat submission blindly.
- If the extension populated the form before the account choice was resolved,
  do not submit. Stop with `multiple_matches` and explain that a choice is needed.
- Do not retry a rejected login, unlock request, or verification challenge. Do
  not reset the vault or change security settings to get past a blocker.
- If managed browser verification or control fails, stop browser work and report
  `autofill_failed` with the infrastructure blocker. A native-window workaround
  does not count as a successful managed run.

## Completion

Return one outcome: `filled_and_submitted`, `filled_only`, `multiple_matches`,
`vault_locked`, `mfa_required`, `no_login_form_found`, `autofill_failed`, or
`captcha_required`. Name the website hostname, what was attempted, whether the
form was submitted, and any action needed from the user. Never include account
identifiers, credential values, partial secrets, or captured verification data.
