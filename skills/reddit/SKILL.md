---
name: reddit
description: Use for Reddit account work - sign in, browse a community, read posts, upvote, comment, reply, and auto-reply to the inbox - through ClawBrowser on the desktop or the Reddit Android app on a Multilogin cloud phone.
---

# Reddit

Two transports do the same Reddit work. **Pick one before the first command**,
then stay on it for the whole task.

## Choose the transport

- The user named one - "in the browser", "clawbrowser", "on the phone", "cloud
  phone" - that is the whole decision. Use it.
- **Auto-replying**, answering the inbox, replying to a specific comment, or an
  unattended or scheduled run: **ClawBrowser**. Only that transport has
  `autoreply`, an inbox, and a reply log that survives a rerun.
- The account lives on a Multilogin cloud phone, or the task is about the
  Android app itself: **cloud phone**.
- Nothing decides it: **ClawBrowser**. A step costs about 0.2s there against
  about 1s on a phone, and it covers more flows.

Never drive both against one account in the same task. That is one person in
two places at once, and it is what gets an account flagged.

| Flow | ClawBrowser | Cloud phone |
| --- | --- | --- |
| status, login, open, read, upvote, comment, feed, engage | yes | yes |
| reply to a specific comment | yes | no |
| inbox | yes | no |
| autoreply | yes | no |

## ClawBrowser

Runs on `old.reddit.com` in a managed profile, because that markup is server
rendered and a vote or a comment can be confirmed from the DOM. Start the
profile first; credentials come from `REDDIT_USERNAME` and `REDDIT_PASSWORD` in
the environment, never from flags.

```bash
nbc start --profile reddit-us --country US --url https://old.reddit.com/ --json
```

| Goal | Command |
| --- | --- |
| Where am I, am I signed in | `nbc reddit status --profile P` |
| Sign in | `nbc reddit login --profile P` |
| Open a link | `nbc reddit open --profile P URL` |
| Read the open post | `nbc reddit read --profile P --scrolls 2` |
| Upvote the open post | `nbc reddit upvote --profile P` |
| Comment on the open post | `nbc reddit comment --profile P "text"` |
| Reply to one comment | `nbc reddit reply --profile P --target t1_abc "text"` |
| List a community's posts | `nbc reddit feed --profile P golang --limit 10` |
| Read the inbox | `nbc reddit inbox --profile P` |
| Browse, open, read, vote, comment | `nbc reddit engage --profile P golang --comment "text"` |
| Auto-reply | `nbc reddit autoreply --profile P ...` (below) |

Over MCP the same set is one tool: `reddit_flow` with
`flow: status|login|open|read|upvote|comment|reply|feed|inbox|engage|autoreply`.

### The auto-replier

`autoreply` scans a source, drops what it must not answer, and posts only the
text you gave it. **It never writes the reply for you.** Run it in two passes:

```bash
# 1. See what is worth answering. Posts nothing.
nbc reddit autoreply --profile P --source inbox --match nextbrowser --dry-run --json

# 2. Compose each reply yourself, then post them.
nbc reddit autoreply --profile P --source inbox \
  --replies '{"t1_abc":"...","t1_def":"..."}' --json
```

Pass 1 returns `targets` (what it would answer) and `skipped` (with a reason
each). Read a target's `body`/`title` and write a reply that answers *that*
item. Pass 2 posts them, verifies each one on the page, and records it.

One pass is enough only when a single canned line genuinely fits every item:

```bash
nbc reddit autoreply --profile P --source community --community golang \
  --match "proxy,fingerprint" --template "Hi {author}, ..." --limit 2 --json
```

Placeholders: `{author}`, `{title}`, `{subreddit}`, `{body}`, `{permalink}`.

What it refuses to do, and why you can rely on it:

- It skips anything the reply log already records, so a rerun or a scheduled
  run never answers the same item twice. The log lives with the other nbc state;
  `--reply-log PATH` moves it.
- It skips the account's own content and, with `--match`, anything that misses
  every term.
- It posts at most `--limit` replies (default 3, hard cap 10) and waits
  `--min-interval` seconds between them (default 45).
- It stops at the first reply that fails instead of posting the rest blind.
- Without `--template` or `--replies` it is a dry run whether or not you passed
  `--dry-run`.

## Cloud phone

Drives the Reddit Android app over ADB. The phone must be started, `adb`
installed on the host, and connected once:

```bash
nbc --runtime multilogin mobile adb connect "PHONE" --json
```

| Goal | Command |
| --- | --- |
| Where am I, am I signed in | `mobile reddit status PHONE` |
| Sign in | `mobile reddit login PHONE` |
| Open a link | `mobile reddit open PHONE URL` |
| Read the open post | `mobile reddit read PHONE --scrolls 2` |
| Upvote the open post | `mobile reddit upvote PHONE` |
| Comment on the open post | `mobile reddit comment PHONE "text"` |
| List a community's posts | `mobile reddit feed PHONE golang --limit 10` |
| Browse, open, read, vote, comment | `mobile reddit engage PHONE golang --comment "text"` |

Over MCP: `mobile_reddit_flow` with
`flow: status|login|open|read|upvote|comment|feed|engage`.

A screen read costs about 1s on the fast path and about 3s on the dump path, so
**always prefer a flow over tap-by-tap primitives**. Drive the screen yourself
only when no flow fits or one failed and you need to see why:

```bash
nbc --runtime multilogin mobile ui observe "PHONE" --compact --json
nbc --runtime multilogin mobile ui act "PHONE" --action tap --node-id 0.1.2 --json
```

Take `node_id` from the previous result; never invent one. `act` returns the
resulting screen, so do not call `observe` right after it.

## Reading a result

Both transports return the same shape: `screen`/`page`, `logged_in`,
`verified`, and a `steps` array with one entry per action (`step`, `ok`,
`duration_ms`, and on failure `code` plus what was visible). When something
fails, read `steps` before retrying: it names the stage that broke.

| Code | What to do |
| --- | --- |
| `REDDIT_LOGIN_REQUIRED` | set the credential env vars, run `login` |
| `REDDIT_LOGIN_FORM_NOT_FOUND` | Reddit served no form to this profile: sign in once in the window, then rerun |
| `REDDIT_AUTH_REJECTED` | credentials rejected, or Reddit wants a captcha or email step |
| `REDDIT_UPVOTE_UNVERIFIED`, `REDDIT_COMMENT_UNVERIFIED` | the write was not confirmed: inspect the page or screen first, do not repeat blindly |
| `REDDIT_COMMENT_RATE_LIMITED` | the account is posting too fast; wait it out |
| `REDDIT_TARGET_NOT_FOUND` | the comment is not on the page: open its permalink first |
| `REDDIT_FEED_EMPTY`, `REDDIT_FEED_POST_NOT_FOUND` | private, quarantined, or still loading: retry or pass a direct post URL |
| `WAIT_TIMEOUT` | read the returned labels, then adjust the query or timeout |

## Never

- Do not automate an account the user does not own or is not authorized to
  operate, and keep volume to what a person could plausibly do.
- Do not repeat a vote, comment, or reply that came back unverified without
  looking at the page or screen first.
- Do not invent an auto-reply persona, an opinion, or a product claim the user
  did not ask for. A reply the user has not seen the shape of is a dry run.
- Do not use screenshots as the primary signal on either transport; the DOM and
  the accessibility hierarchy are authoritative.

## Completion

Report which transport ran, the account and its signed-in state, what was read,
and every write with `verified` exactly as the flow reported it. Name anything
skipped or left unverified together with its code, and never claim a vote, a
comment, or a reply the flow did not verify.
