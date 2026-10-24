---
name: tiktok
description: Use for TikTok account work - read videos and comments, and draft replies that are posted only after the user approves them - through a ClawBrowser profile signed in to tiktok.com.
---

# TikTok

TikTok work runs in a ClawBrowser profile signed in to tiktok.com. The user
signs in; never type a password, a code or any other credential, and never
solve a captcha on the user's behalf.

The skill has a second mode, Monitoring, that Nextbrowser runs itself with the
open-source engine `@nextbrowser-oss/tiktok-monitoring`. It reads watched
creators' new videos, the comments under them that name a keyword or the
account, comments on the account's own videos, and sudden jumps in views or
comments, and ranks every match by urgency. It only reads. A chat request to
monitor TikTok belongs in that panel: point the user there instead of polling
TikTok from chat. A match the panel hands you is one item to answer: draft the
reply, show it, and post only what the user approves.

## The approval rule

Every reply is a draft until the user says yes to that exact text.

1. Read the video's description and the comment with the replies under it.
2. Write one reply that answers that specific comment or video, in the
   account's own voice. Never a canned line, never a claim about a product,
   an order or a policy that the thread does not support.
3. Show the draft and stop. Post nothing until the user approves it.
4. If the user edits it, show the new text again before posting.

Approval covers one reply. A "yes" to one draft is not a yes to the next one.

## Reading

```bash
nbc --profile P open https://www.tiktok.com/@<creator>/video/<id>
nbc --profile P wait --load --timeout 20s
nbc --profile P state
```

- TikTok has no link to a single comment. Find the comment under the video by its author and its text; open the comment panel if it is closed.
- If the page shows a captcha ("Verify to continue", a puzzle slider) or a login popup that blocks the page, stop and tell the user. Do not try to get past it.

## Posting an approved reply

Only after the user approved the exact text:

1. With the video open, run `nbc --profile P state` and find the comment's own **Reply** link (under the comment, beside its age and likes).
2. Click it: `nbc --profile P click <id>`. The comment box opens addressed to that comment.
3. Type the approved text: `nbc --profile P input <box-id> "<approved text>"`.
4. Press the **Post** button beside the box, or `nbc --profile P press Enter`.
5. Read the comments again and report whether the reply is there, under the right comment. If it is not, say so; do not post a second time without looking.

For a reply to the video itself, use the main comment box instead of a Reply link.

## Never

- Like, follow, share, duet, stitch or send a message as part of a reply task.
- Post more than a handful of replies in one session, or the same text twice: TikTok restricts accounts for it.
- Post without the user's approval of that exact text.
- Automate an account the user does not own or is not authorized to operate.

## Completion

Report the account, which items were read, every draft shown, which ones the
user approved, and for each approved one whether it appeared on the page.
