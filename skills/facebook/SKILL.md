---
name: facebook
description: Use for Facebook group work - read posts and comments in groups the account is a member of, and draft replies that are posted only after the user approves them - through a ClawBrowser profile signed in to facebook.com.
---

# Facebook

Facebook group work runs in a ClawBrowser profile signed in to facebook.com,
with an account that is a member of the groups. Group content is gated: only
members see it, which is why this goes through the user's own logged-in
session and not an API. The user signs in; never type a password, a code or
any other credential, and never pass a security check on the user's behalf.

The skill has a second mode, Monitoring, that Nextbrowser runs itself with the
open-source engine `@nextbrowser-oss/facebook-monitoring`. It reads the
configured groups newest first, finds posts and comments that name the user's
keywords or mention the account, keeps the group and the post with every
match, and ranks it by urgency. It only reads. A chat request to monitor
Facebook groups belongs in that panel: point the user there instead of
polling Facebook from chat. A match the panel hands you is one item to
answer: draft the reply, show it, and post only what the user approves.

## The approval rule

Every reply is a draft until the user says yes to that exact text.

1. Read the whole post (press **See more** when it is cut), its comments, and
   the group's rules when the group shows them.
2. Write one reply that answers that specific post or comment, in the
   account's own voice and the group's tone. Never a canned line, never an ad
   the group's rules forbid, never a claim the thread does not support.
3. Show the draft and stop. Post nothing until the user approves it.
4. If the user edits it, show the new text again before posting.

Approval covers one reply. A "yes" to one draft is not a yes to the next one.

## Reading

```bash
nbc --profile P open "https://www.facebook.com/groups/<group>/posts/<post-id>/"
nbc --profile P wait --load --timeout 20s
nbc --profile P state
```

- A comment link is the post link with `?comment_id=<id>`; opening it scrolls to that comment.
- If Facebook shows a login form, a "Confirm it's you" or checkpoint page, or says the account is temporarily blocked, stop and tell the user. Do not try to get past it.
- If the account is not a member of the group, say so; do not ask to join.

## Posting an approved reply

Only after the user approved the exact text:

1. With the post open, run `nbc --profile P state`. For a comment, find that comment's own **Reply** link; for the post, find its **Write a comment** box.
2. Click it: `nbc --profile P click <id>`.
3. Type the approved text: `nbc --profile P input <box-id> "<approved text>"`.
4. Press `nbc --profile P press Enter` to post it.
5. Read the thread again and report whether the reply is there, in the right place. If it is not, say so; do not post a second time without looking.

## Never

- React, share, join or leave a group, send a message or friend request as part of a reply task.
- Post the same text in more than one group or thread, or more than a handful of replies in one session: Facebook blocks accounts for it.
- Post without the user's approval of that exact text.
- Work in a group the account is not a member of, or one whose rules forbid what the reply would be.

## Completion

Report the account, the groups and items read, every draft shown, which ones
the user approved, and for each approved one whether it appeared on the page.
