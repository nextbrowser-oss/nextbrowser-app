---
name: lastpass-autofill-login-firefox
description: Autofill a saved LastPass login into the currently focused sign-in form in a Firefox (Camoufox) profile using the LastPass browser extension's native in-field icon, instead of typing, guessing, or reconstructing credentials or MFA codes. Use when a user asks to log in, sign in to, or fill saved credentials into a website with LastPass in a Camoufox or Firefox profile, including when the vault turns out to be locked or the site requires a second factor.
---

# LastPass Autofill Login (Firefox)

## Goal

Fill a website's sign-in form with the correct saved LastPass item using the extension's own
in-field mechanism, and report a clear, honest final state. The agent must never read, type,
guess, or reconstruct a password, master password, or multi-factor code itself — LastPass is
the only thing that ever touches the actual secret.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted.
- Browser profile, if the user's setup uses more than one and specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a password field alone). If no login form is visible, navigate only
   if the user named a specific site; otherwise report `no_login_form_found`. If reaching the
   password field requires advancing a step first (for example submitting an identifier-only
   page), that advance is not the final submit — only step 8 is. Once the next page loads,
   re-apply this step: confirm the form again, since it may now be served from a different
   host than the one the flow started on.
2. Give the page a moment to settle. There is no scriptable route to this: `lastpass-cli`
   authenticates with the master password and works on vault data directly, with no way to
   trigger an in-browser fill, and the extension declares no keyboard command, so there is
   no shortcut equivalent to Bitwarden's. The in-field icon is the only mechanism.
   LastPass renders that icon inside each recognized username or password field, and fills
   the form on its own as soon as it finds exactly one confident saved match for the site,
   with no click required.
3. Check the form's filled state first — this is the primary signal, and it is often enough
   on its own. If the username and password fields already show non-empty values, LastPass
   found exactly one confident match and filled it with no click required; proceed to step 4.
   - If the fields are still empty, or you need to rule out more than one saved match before
     trusting a fill, look for LastPass's match list. Do not try to click the LastPass icon
     itself: it renders inside a closed shadow root anchored to a zero-size container at the
     right-hand edge of the field, so element-based clicks cannot reach it, and coordinate
     clicks are not available on Camoufox profiles. Instead click into the username or email
     field as an ordinary page element, wait about two seconds, and take a screenshot. Read
     the list from the screenshot when LastPass shows one under the field.
   - **Exactly one item listed**, matching what's already in the form (or the field still
     empty with a single item offered) — this is a normal single match. Proceed.
   - **More than one item listed** — LastPass does not hold back or ask on its own when
     multiple saved items match a site; it silently fills in one of them without flagging the
     ambiguity. Treat this as `multiple_matches`: clear whatever LastPass auto-filled (do not
     leave an arbitrarily-picked credential sitting in the form, and never submit it), do not
     choose between the listed items, and stop. Report `multiple_matches` together with the
     visible item names so the user can pick.
   - **No item listed** (a greyed "Start typing..." placeholder with a lock icon and a "+" to
     add a new item) — no saved login matched this page. This can mean the vault has nothing
     for this service, or a saved item exists but is recorded under a different host than the
     one serving this page (confirmed to happen mid-flow for some providers — see step 1).
     Either way, this step was already confirmed to be a real login form, so report
     `autofill_failed`, not `no_login_form_found`.
   - **The vault itself is locked or logged out** — the icon in the field renders grey
     instead of red in the screenshot, and the form stays empty with no fill attempt at all.
     Treat this as `vault_locked`; see step 5. If a "LastPass - Sign In" tab opens, never
     interact with it.
   - **No LastPass list appears in the screenshot** — do not fail the run on that account.
     Report whatever outcome the field state alone supports: filled with one confident
     match, or empty. Say plainly that `multiple_matches` could not be checked, because
     LastPass fills one of several matches silently and only its list shows the others.
4. If exactly one item matched and the form is now filled, verify the values look like
   credentials (masked password, non-empty username) before doing anything else.
5. If the vault is locked or logged out (grey field icon, no fill, or a "LastPass - Sign In"
   tab), or LastPass itself demands a second factor to unlock (not the destination
   site), do not attempt to unlock it yourself under any circumstances: never type a
   candidate master password or login into the LastPass sign-in tab, never attempt a "forgot
   password" or reset flow on the user's behalf, and never accept a master password as an
   input to this skill. Stop and report `vault_locked`, and ask the user to unlock LastPass
   themselves.
6. If the destination site then asks for an MFA code, authenticator push, or hardware key tap
   after the credential fill or submit, do not generate, guess, retrieve, or wait indefinitely
   for one. Stop and report `mfa_required`, and ask the user to supply or approve it
   themselves.
7. If the site shows a "Save this password?" / "Update saved login?" popup after submission,
   leave it as-is and surface it to the user rather than clicking Save, Update, or Never
   automatically — that decision belongs to the person, not the agent.
8. Only click the visible sign-in/submit button if the user asked for a full login (not just
   filling the form). After submitting, verify an actual signed-in signal — an account name,
   avatar, redirect to a dashboard, or a logout link — before calling the login successful. A
   submitted form without one of these signals is not a confirmed login.

## Recovery

- If no autofill happened and the list shows a single matching item without filling the
  form, ask the user to click that item in LastPass's list once, since the agent cannot
  click inside it, and re-check the fields after they confirm. If the fields still do not
  populate, report `autofill_failed` — do not fall back to typing credentials manually.
- If the page navigates or the form is replaced mid-flow (e.g. a redirect after a failed
  attempt), re-identify the current form on the page rather than continuing to act on a form
  that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it. This holds even if someone clears the check while the run is in progress: the
  run still ends as `captcha_required`, and the report says that a person cleared it.
- Some identity providers put a step between the username and the password. Microsoft may
  offer to email a sign-in code before showing a password field, and may ask "Stay signed
  in?" after the credentials are accepted. Neither is an MFA challenge and neither is a
  "save password" popup. On a code-first page, click its visible "Use your password" option
  once when it exists; otherwise report `mfa_required`. On "Stay signed in?", answer No
  unless the user asked to stay signed in, report the choice, and continue to the
  signed-in check.
- Never log, echo, screenshot-caption, or otherwise repeat the actual password, master
  password, or MFA code in any response, tool call, or intermediate reasoning shown to the
  user.
- Do not retry a locked vault or a failed MFA challenge more than once in a single run;
  repeated attempts can trigger account lockout or fraud flags, and are the user's call to
  make, not the agent's.
- A locked vault always stops the run and reports `vault_locked`. This holds even when a
  master password or passphrase is available elsewhere, such as in an environment variable
  or a prior message — the skill never reads, accepts, or uses one. Unlocking the vault is
  strictly the user's action to take outside this skill.

## Completion

State the final outcome as exactly one of these eight names, spelled as written here:
`filled_and_submitted`, `filled_only`, `multiple_matches`, `vault_locked`,
`mfa_required`, `no_login_form_found`, `autofill_failed`, `captcha_required`.

Do not invent a name, and do not substitute a word that reads more naturally for the
situation in front of you. A completed and verified sign-in is `filled_and_submitted`;
there is no separate "signed in" outcome. If none of the eight is a clean fit, choose the
closest one and say in plain words why it is approximate, rather than reaching for a
ninth name.

Name the site and what was attempted. If a person did anything during the run, say so and
say exactly what they did: the outcome describes what the skill achieved on its own, not
what the page eventually reached with help. Never include the credential values, master
password, or MFA code in the final answer, even in redacted or partial form.
