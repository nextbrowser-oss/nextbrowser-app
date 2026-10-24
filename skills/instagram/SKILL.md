---
name: instagram
description: Use for Instagram account work - read comments, mentions and posts, and draft replies that are posted only after the user approves them - through a ClawBrowser profile signed in to instagram.com.
---

# Instagram

Instagram work runs in a ClawBrowser profile that is signed in to
instagram.com. The user signs in; never type a password, a code or any other
credential, and never accept a security check on the user's behalf.

The skill's panel is Monitoring, which Nextbrowser runs itself with the
open-source engine `@nextbrowser-oss/instagram-monitoring`. It reads the
account's activity (mentions, replies, comments), the comment threads under
its newest posts, the posts it is tagged in, and watched profiles' new posts,
and ranks every match by urgency. It only reads. A chat request to monitor
Instagram belongs in that panel: point the user there instead of polling
Instagram from chat. A match the panel hands you is one item to answer: draft
the reply, show it, and post only what the user approves.

## The approval rule

Every reply is a draft until the user says yes to that exact text.

1. Read the item and the thread around it.
2. Write one reply that answers that specific comment or post, in the
   account's own voice. Never a canned line, never a claim about a product,
   an order or a policy that the thread does not support.
3. Show the draft and stop. Post nothing until the user approves it.
4. If the user edits it, show the new text again before posting.

Approval covers one reply. A "yes" to one draft is not a yes to the next one.

## Reading

```bash
nbc --profile P open https://www.instagram.com/p/<shortcode>/
nbc --profile P wait --load --timeout 20s
nbc --profile P state
```

- A comment link has the form `https://www.instagram.com/p/<shortcode>/c/<comment-id>/`; opening it scrolls the post to that comment.
- If the page shows the sign-in form or a "Suspicious login attempt" / "Confirm it's you" screen, stop and tell the user. Do not try to get past it.
- Read the comment, the replies under it, and the post caption before drafting.

## Posting an approved reply

Only after the user approved the exact text:

1. Open the comment link, then run `nbc --profile P state` and find the comment's own **Reply** button (it sits under the comment, next to its age and like count).
2. Click it: `nbc --profile P click <id>`. The comment box fills with `@author `.
3. Type the approved text after the mention: `nbc --profile P input <box-id> "<approved text>"`.
4. Press the **Post** button that appears beside the box, or `nbc --profile P press Enter`.
5. Read the thread again and report whether the reply is there, under the right comment. If it is not, say so; do not post a second time without looking.

For a reply to a post rather than a comment, use the post's own comment box instead of a Reply button.

## Never

- Like, follow, unfollow, save, share or send a message as part of a reply task.
- Post more than a handful of replies in one session, or the same text twice: Instagram restricts accounts for it.
- Post without the user's approval of that exact text.
- Automate an account the user does not own or is not authorized to operate.

## Completion

Report the account, which items were read, every draft shown, which ones the
user approved, and for each approved one whether it appeared on the page.
