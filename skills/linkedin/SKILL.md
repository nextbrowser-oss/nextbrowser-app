---
name: linkedin
description: Use for LinkedIn work - read posts, comments, notifications and company mentions, and draft replies that are posted only after the user approves them - through a ClawBrowser profile signed in to linkedin.com.
---

# LinkedIn

LinkedIn work runs in a ClawBrowser profile signed in to linkedin.com. Most of
LinkedIn is behind its sign-in wall and its API is closed to this kind of
work, which is why it goes through the user's own logged-in session. The user
signs in; never type a password, a code or any other credential, and never
pass a security check on the user's behalf.

The skill has a second mode, Monitoring, that Nextbrowser runs itself with the
open-source engine `@nextbrowser-oss/linkedin-monitoring`. It reads the
account's notifications, the recent posts of selected people and companies,
and a search for the user's company names and keywords, and ranks every match
by urgency — a mention, a question about the company, a request for a
recommendation. It only reads. A chat request to monitor LinkedIn belongs in
that panel: point the user there instead of searching LinkedIn from chat. A
match the panel hands you is one item to answer: draft the reply, show it,
and post only what the user approves.

## The approval rule

Every reply is a draft until the user says yes to that exact text.

1. Read the whole post (press **…see more** when it is cut), its comments,
   and who wrote them.
2. Write one reply that answers that specific post or comment in a
   professional, specific voice. Never a canned line, never a sales pitch the
   thread did not ask for, never a claim the thread does not support.
3. Show the draft and stop. Post nothing until the user approves it.
4. If the user edits it, show the new text again before posting.

Approval covers one reply. A "yes" to one draft is not a yes to the next one.

## Reading

```bash
nbc --profile P open "https://www.linkedin.com/feed/update/urn:li:activity:<id>/"
nbc --profile P wait --load --timeout 20s
nbc --profile P state
```

- A comment link is the post link with `?commentUrn=…`; opening it shows that comment.
- If LinkedIn shows its sign-in page, "Let's do a quick security check", a notice that the account is restricted, or a usage limit, stop and tell the user. Do not try to get past it.

## Posting an approved reply

Only after the user approved the exact text:

1. With the post open, run `nbc --profile P state`. For a comment, find that comment's own **Reply** button; for the post, find its **Add a comment…** box.
2. Click it: `nbc --profile P click <id>`.
3. Type the approved text: `nbc --profile P input <box-id> "<approved text>"`.
4. Press the **Post** / **Reply** button that appears under the box: `nbc --profile P click <id>`.
5. Read the thread again and report whether the reply is there, in the right place. If it is not, say so; do not post a second time without looking.

## Never

- React, repost, follow, connect, send a message or an InMail as part of a reply task.
- Post the same text twice, or more than a handful of replies in one session: LinkedIn restricts accounts for it.
- Post without the user's approval of that exact text.
- Automate an account the user does not own or is not authorized to operate.

## Completion

Report the account, which items were read, every draft shown, which ones the
user approved, and for each approved one whether it appeared on the page.
