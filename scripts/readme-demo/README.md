# README demo capture

`capture.mjs` regenerates the README animation from the workflow block on the
[Nextbrowser website](https://nextbrowser.com/): the **Research** tab is open, the pointer picks the
**Web scraping** workflow, the task is typed into the chat, and the agent reply with its result
appears. The block is an illustrative website mockup of the workflow. It is not a recording of the
desktop app.

## Requirements

- Node.js 22 or newer.
- `ffmpeg` on `PATH`.
- Microsoft Edge or Google Chrome installed locally.
- `playwright-core`, installed without changing the lockfile:

```bash
npm install --no-save playwright-core
```

## Run

From the repository root:

```bash
node scripts/readme-demo/capture.mjs
```

The script writes:

- `assets/nextbrowser-interface-demo.gif`: the looping README image.
- `assets/nextbrowser-interface-demo.mp4`: the same clip as H.264 for reviews and embeds.

Useful options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--card` | `Web scraping` | Workflow card to click in the Research tab. |
| `--channel` | `msedge` (`chrome` on macOS) | Installed browser used for the capture. |
| `--fps` | `20` | Output frame rate. |
| `--colors` | `128` | GIF palette size. |
| `--hold` | `2.4` | Seconds the finished reply stays on screen. |
| `--fade` | `0.45` | Dissolve from the last frame back to the first frame. |
| `--url` | `https://nextbrowser.com/` | Page to record, for example a deploy preview. |
| `--keep` | off | Keep the raw frames, lossless master and a poster frame in a temp folder. |

## Review before committing

- The page is rendered in dark mode at a 1024 px viewport and cropped to the workflow block.
- Check that the right-hand screenshots are loaded in the first frame and that the loop has no flash.
- Keep the GIF under 2 MiB so the README loads quickly. Lower `--fps` or `--colors` if it grows.
- Open the README on GitHub in light and dark themes at desktop and phone widths.
