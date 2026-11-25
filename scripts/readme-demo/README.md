# README demo capture

`capture.mjs` regenerates the README animation as a short tour of the
[Nextbrowser website](https://nextbrowser.com/):

1. The hero prompt types a sample task.
2. The orbit of agents, browsers and platforms around the app.
3. In the **Research** tab, the pointer picks the **Web scraping** workflow, the task is typed into
   the chat, and the agent reply with its result appears.
4. The stats, account safety, Focus on growth and How it works sections.
5. The final call to action, followed by a dissolve back to the first frame.

The website sections are illustrative product mockups. The animation is not a recording of the
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
| `--width` | `800` | Output width. The README column on GitHub is about 830 px. |
| `--fps` | `12` | Output frame rate. |
| `--colors` | `96` | GIF palette size. |
| `--dither` | `bayer:bayer_scale=5` | ffmpeg `paletteuse` dithering. |
| `--fade` | `0.5` | Dissolve from the last frame back to the first frame. |
| `--url` | `https://nextbrowser.com/` | Page to record, for example a deploy preview. |
| `--keep` | off | Keep the raw frames and the lossless master in a temp folder. |

## Review before committing

- The page is rendered in dark mode at a 1024×768 viewport, then scaled to the output width.
- Scroll positions are measured from section selectors on the page. If the site layout changes,
  check that each stop still frames its section and update the selectors in the script.
- Check that no section shows empty image boxes and that the loop has no flash.
- Every scroll changes the whole frame, so scrolls drive the file size. Keep the GIF near 4 MiB:
  lower `--fps` or `--colors`, or remove a stop, if it grows.
- Open the README on GitHub in light and dark themes at desktop and phone widths.
