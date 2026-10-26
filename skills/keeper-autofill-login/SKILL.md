---
name: keeper-autofill-login
description: Autofill a saved Keeper login into a site's sign-in form through the KeeperFill extension's own in-page menu, the one its field icon opens, then verify the result. Use when a user asks to log in, sign in to, or fill saved credentials into a website with Keeper, including when the vault turns out to be locked, when more than one saved record matches the site, or when the site asks for a second factor.
---

# Keeper Autofill Login

## Goal

Fill a website's sign-in form with the correct saved Keeper record through KeeperFill's own
controls, and report a clear, honest final state.

The agent must never read, type, guess, or reconstruct a password, master password, or
multi-factor code itself. Keeper is the only thing that ever touches the actual secret.

## Official interfaces versus UI-only automation

- **No API path for the fill.** Keeper Commander is Keeper's official CLI and SDK, but it
  covers the vault and admin functions, not the extension's in-page fill, and reading a
  secret through it is outside this skill. Filling is necessarily UI automation of
  KeeperFill.
- **What KeeperFill offers a person.** Its keyboard shortcut, Command+Shift+K on macOS and
  Alt+K elsewhere unless the user remapped it, opens the toolbar popup with a record picker,
  and nothing fills until a record is highlighted and Enter is pressed. In a field it
  recognises, KeeperFill also draws a small Keeper icon at the right end of the field.
  Clicking that icon opens an in-page menu listing the records that match the site, with a
  **Fill Record** button.
- **What the agent can reach.** The toolbar popup opens outside the page. Page screenshots
  do not show it, a coordinate click on the page cannot reach it, and the browser tools send
  single keys to the page, so the shortcut cannot be pressed through them and nothing can be
  pressed inside the popup. Sent through a raw DevTools connection instead, the shortcut
  does open the popup, but reading or operating it then takes more raw connections to the
  extension's own pages, outside the tools Nextbrowser gives the agent, and an agent that
  checks with a page screenshot sees nothing and presses again, which closes it. The in-page
  menu is drawn inside the page: a page screenshot shows it and the CLI's coordinate click
  reaches it. So this skill fills through the field icon and the in-page menu, never through
  the shortcut. Read the menu from a screenshot.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and submitted. If the request does
  not say, which includes a run started from the skill's card, whose only instruction is to
  use the skill on the current tab, sign in. Fill only when the user asks for it, for
  example with "don't submit".
- Which record to use, if the user named one. Otherwise none is needed up front: the menu
  already lists the records matching the current site.
- Browser profile, if the user's setup uses more than one and they specified which.
- Proxy country, when the user requested one.

## Workflow

1. Nextbrowser has already prepared the session and the profile by the time this skill runs,
   so do not start or prepare a second one. Confirm you are in the named profile the user
   asked for, and if they requested a proxy country, verify that country resolves before any
   request reaches the login site, because signing in from an unexpected country can trigger
   the site's own verification step. Do not touch the page until both are true. If the
   profile is not the one asked for, or the country cannot be confirmed or comes back as a
   different one, stop there and report `autofill_failed`, saying which check failed and that
   nothing was sent to the site. Do not carry on in the default session or an unverified
   country, because the profile and the country are the request the user actually made.
2. Confirm the currently focused tab shows a recognizable sign-in form. Three shapes count:
   username and password together, a password field alone, and an identifier field alone on
   the first screen of a two-step flow, which is what Google and Microsoft show. If no login
   form is visible and the user named a specific site, navigate there once and repeat this
   check. If they did not name a site, or the form is still not there after that one
   navigation, report `no_login_form_found` rather than hunting around the site.
3. Click into the field KeeperFill should fill: the username or email field when the screen
   has one, otherwise the password field. Then take a screenshot and look for KeeperFill's
   icon at the right end of that field. This is also the check that KeeperFill is present.
   If no icon shows, wait two seconds, click the field once more and take another
   screenshot. Still no icon means KeeperFill is not offering to fill this field: it may be
   missing, disabled, signed out, or set not to draw field icons. Report `autofill_failed`
   saying no KeeperFill icon appeared, list those causes so the person can check which, and
   do not fall back to the shortcut. Text already in the fields is not a fill by Keeper: a
   page or the browser can pre-fill a username, and KeeperFill's own "Autofill on page load"
   record option fills without being asked. Fill through the menu regardless, so the run
   knows which record went in. KeeperFill can open its menu as soon as the field is clicked;
   if the screenshot already shows the menu, skip step 4 and go straight to step 5, without
   clicking the icon. KeeperFill may also put up an offer of its own when the page loads,
   such as "Would you like Keeper to auto-fill your login?" with No Thanks and Yes. Leave it
   unanswered and fill through the menu: answering it may change how Keeper behaves on this
   site, which is the user's decision.
4. Open the menu by clicking the Keeper icon with the CLI's coordinate click:
   `nbc click-xy X Y --profile <profile> --json`, or `nextctl click-xy` where only nextctl
   is installed. `click-xy` takes viewport coordinates, and a screenshot is usually larger
   than the viewport, by a factor that differs between the screenshot tools: twice the
   viewport for the CLI's, while the MCP tool's is scaled down to at most 2000 pixels wide,
   so its factor depends on the window. So multiply the screenshot's coordinates by the
   viewport's width, `innerWidth`, divided by the screenshot's width. The icon is a
   `keeper-lock` element in the page, so its viewport position can also be read exactly with
   a read-only `getBoundingClientRect()` through `nbc eval`, and the page state can list it
   as a `keeper-lock` button named "Open Keeper Popup". Read and click the menu itself from
   screenshots with `click-xy`. Then take another screenshot.
5. Read the menu from that screenshot. It says how many vault records match this site, such
   as "1 Matching Login" or "2 Matching Logins", shows one record's title and username in a
   box, and has a **Fill Record** button under it. When more than one matches, the box is a
   dropdown that shows only the first record in Keeper's list, and the arrow at its right
   end opens the whole list. Keeper puts a record in the box either way, so the one shown
   is not a choice the user made. Then:
   - **One record matches:** click **Fill Record** with `click-xy`. If the user named a
     record and this is not it, do not fill; report `autofill_failed` naming the record that
     is listed.
   - **More than one record matches:** click the dropdown's arrow and take a screenshot. The
     list shows every matching record with its title and username, a Filter box above them
     and **Create New Record** below. Clicking a record in the list only puts it in the box;
     it fills nothing. If the user named a record, click it in the list, take a screenshot,
     and click **Fill Record** only once the box shows that record; if it cannot be told
     apart from the others, treat it as unnamed. With no record named, do not choose one.
     That is step 8. Never click **Create New Record**.
   - **No record listed for this site:** do not create one. Go to Recovery.
   - **Keeper not signed in:** instead of records the menu says "Log in to Keeper to fill
     credentials." with a Log In button, or Keeper shows its sign-in screen or a master
     password prompt. Do not click Log In; go to step 9.
   Never click **Show More** or anything it reveals. It expands the record with a control
   that shows the password in clear, buttons that fill single fields, and the record's own
   settings, such as "Autofill on page load" and "Autosubmit after autofill". Showing the
   password breaks this skill's first rule, and changing a record's settings is writing to
   the vault, which is the user's decision. Opening the menu fills nothing: do not report a
   fill until **Fill Record** has been clicked and the fields show it.
6. Wait briefly for the page to react, then take a screenshot, work out which state
   resulted, and go straight to the step that owns it. Do not fall through into the next
   numbered step by default.
   - **Filled** - every field the current screen actually has is now populated or masked.
     On a one-screen form that is username and password; on the first screen of a two-step
     flow it is the identifier alone, and an empty password field there is expected, not a
     failure. Go to step 7 if this was a two-step first screen, otherwise to step 10.
   - **Submitted by Keeper** - the page moved on by itself right after the fill. KeeperFill's
     "Autosubmit after autofill" record option does that. Go to step 10 and read the result
     there. If the user asked for a fill only, say plainly that Keeper submitted the form by
     itself, most likely through that option, rather than reporting `filled_only`.
   - **Keeper not signed in** - Keeper asks for the master password, offers biometric login,
     or shows its sign-in screen. Go to step 9.
   - **Keeper asks to confirm** - after **Fill Record**, Keeper asks whether to fill on this
     website, such as "Would you like Keeper to fill login credentials on the website ...?".
     That is Keeper checking the site with the user. Do not answer it; stop and report
     `autofill_failed`, quoting the question and the site, so the person can confirm it
     themselves.
   - **Nothing changed** - the fields show nothing new. Go to Recovery, and do not click
     **Fill Record** or press keys again here.
   A second-factor prompt is not one of the outcomes here. It can only appear after a
   submission, which is step 10, so step 11 owns it.
7. The form was the first screen of a two-step flow, so the fill has only supplied the
   identifier. **If the user asked for a fill only, stop here and report `filled_only`, naming
   the stage reached.** Advancing past the identifier screen means submitting it, and that is
   not what they asked for. Otherwise advance with the page's own Next or Continue control,
   wait for the password screen, and repeat steps 3 to 6 once for it. If the site offers to
   email or text a code instead and shows a link such as Microsoft's "Use your password",
   take that link: it is a choice of sign-in method, not a second factor.
   If an account chooser appears instead, pick the account matching the identifier that was
   just filled, and never a different one; if no entry matches it, report `autofill_failed`
   rather than choosing for the user. The same record should be offered again: Google keeps
   both screens on one domain, and when Microsoft moves a personal account's password screen
   from login.microsoftonline.com to login.live.com, KeeperFill still offers the record,
   because its own list of equivalent domains puts live.com, microsoftonline.com, outlook.com
   and hotmail.com in one group. If the menu lists nothing on the second screen, do not go
   looking for the first screen's record by name; report `autofill_failed`, naming the host
   the password screen moved to, so the person can add that address to the record. Never fill
   a different record for the second stage. If the password screen never appears, report
   `autofill_failed` and say which stage was reached, rather than reporting a fill that only
   entered an address.
8. If more than one record matched and the user named none, do not choose one. Open the
   dropdown's list as in step 5 and read every record's title off the screenshot. Then
   click the same arrow again to close the list without choosing anything (Escape does not
   close it), type nothing into its Filter box, and leave the menu open so the person can
   pick. Do not click **Fill Record**: the record in the box is only the first in Keeper's
   list, not the user's choice. Stop and report `multiple_matches` with those titles.
   Never fill an arbitrarily chosen record.
9. If Keeper is not signed in, do not try to get past it under any circumstances: never type
   a candidate master password, never approve a biometric prompt on the user's behalf, and
   never start a sign-in, recovery or reset flow. Stop, report `vault_locked`, and say what
   Keeper is asking for, since the user resolves the two differently: a sign-in screen that
   starts with an email address field means they have to sign in to Keeper from the start,
   and a master password prompt for an account Keeper still shows means they only have to
   enter their master password, or use biometric login if they set it up. KeeperFill's menu
   message "Log in to Keeper to fill credentials." does not say which of the two it will
   ask for; when that is all Keeper shows, say so rather than guessing. KeeperFill has no
   separate lock: it logs out, on the user's command or after its inactivity logout timer,
   and it can remember the email. That timer can run out part way through a run, after
   step 3 found Keeper signed in, and the response is the same.
10. If the fields are populated and the user did not ask for a fill only (see Inputs),
    click the visible sign-in or submit button now. If they asked for a fill only, stop here
    and report `filled_only`. After a submission, by the agent or by Keeper, read what the
    page became and take the first of these that fits, rather than assuming a missing
    signed-in signal means failure:
    - **A signed-in signal**, an account name, avatar, redirect to a dashboard or a logout
      link: report `filled_and_submitted`.
    - **A second factor is requested**: go to step 11, which reports `mfa_required`.
    - **A captcha or bot check**: stop and report `captcha_required`.
    - **The browser's own error page** instead of a page from the site, such as "This site
      can't provide a secure connection" or another `net::` error: the request may never have
      reached the site, so this is not a rejection. Load the site once more. If it now shows
      a signed-in signal, report `filled_and_submitted`. If it shows the sign-in form again,
      fill it through the menu as in steps 3 to 7 and submit once more. If that also ends on
      the browser's error page, report `autofill_failed` naming the error. Make this second
      attempt at most once in a run.
    - **The site rejected it**, an incorrect-credentials or unrecognised-account message:
      report `autofill_failed` with what the site said and stop. Do not resubmit, do not try
      a different record, and do not retype anything: the saved credential is simply out of
      date, and repeated attempts are what lock an account out.
    - **A question that is part of the site's own flow**, such as Microsoft's "Stay signed
      in?" or an offer to set up a passkey: answer it the way that stores nothing extra on
      the device, such as No, Skip or Cancel, then read the page again.
    - **None of the above and no signed-in signal**: report `autofill_failed` rather than
      claiming a login that did not happen.
    A second factor, a captcha and a rejection are each their own outcome. Reporting any of
    them as a plain failure throws away the one thing the person needs to know.
11. If the site then asks for an MFA code, authenticator push, or hardware key tap after that
    submission, do not generate, guess, retrieve, or wait indefinitely for one. Stop and
    report `mfa_required` and ask the user to supply or approve it themselves.
12. KeeperFill may put up a prompt of its own after a submission, asking to write to the
    vault. The wordings it ships include "Add to Keeper", "Save password to Keeper?", "Would
    you like to save this password?", "Do you want to update this record?", "Do you want to
    update your Keeper record for this site?" and "Would you like Keeper to help you change
    your password?". Match on the intent, a prompt offering to save, update or change a vault
    record, rather than on an exact sentence, since the wording is localised. Leave it alone
    and surface it to the user instead of clicking through it. Writing to someone's vault is
    their decision, not the agent's, and a wrong click here overwrites a stored credential.
    This prompt does not change the outcome: the run is still whatever step 10 or step 11
    determined, and the prompt is mentioned alongside it.

## Recovery

- If clicking the icon opened no menu, click into the field again and take a screenshot. If
  the menu is open now, go on with step 5; otherwise click the icon once more, and if there
  is still no menu, report `autofill_failed`. If Keeper shows "Log in to Keeper to fill
  credentials.", its sign-in screen or a master password prompt instead, that is
  `vault_locked` and step 9's rules apply, not a plain failure. Do not fall back to typing
  credentials by hand.
- If the menu lists no record for this site, report `autofill_failed`, naming the site's
  host so the person can add that address to a record. Never fill a record belonging to a
  different site, and never offer to create a new record: writing to the vault is the
  user's decision, as in step 12.
- If the menu closes before **Fill Record** is clicked, click the icon again to bring it
  back. Do not press keys at the page meanwhile: Enter in a focused field submits the
  page's own form, empty or not.
- Do not send KeeperFill's keyboard shortcut by other means, such as the DevTools protocol.
  The popup it opens is outside what the agent can see or operate, and a second press
  closes it.
- If the browser itself goes away part way through, so that its tools stop answering, do
  not start, restart or prepare the profile yourself: Nextbrowser owns the session, and a
  restarted profile comes back with KeeperFill signed out. Report `autofill_failed`, saying
  the browser closed and at which stage.
- Treat any element id captured in an earlier session as a short-lived hint. Target roles,
  labels, text and stable selectors, and re-inspect the page when it changes.
- If the page navigates or the form is replaced mid-flow, for example after a failed
  attempt, re-identify the current form rather than acting on a form that no longer exists.
- If a captcha or bot check appears, stop and report `captcha_required`. Do not attempt to
  solve it.
- Never log, echo, caption, or otherwise repeat the password, master password, or MFA code
  in any response, tool call, or intermediate reasoning shown to the user.
- Do not retry a signed-out Keeper, a rejected sign-in, or a failed MFA challenge more than
  once in a single run. Repeated attempts can trigger account lockout or fraud flags, and
  that is the user's call to make, not the agent's.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site and what was attempted. Never
include the credential values, master password, or MFA code in the final answer, even in
redacted or partial form.
