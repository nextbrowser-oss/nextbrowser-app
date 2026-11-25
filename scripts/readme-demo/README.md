# README demo capture

The README uses two animations:

| Asset | What it shows | How it is made |
| --- | --- | --- |
| `assets/nextbrowser-interface-demo.gif` | A real task in the desktop app: open a running profile from Processes, send a read-only task to Claude Code, watch Live View open the page, read the answer. | `app/record.mjs` and `app/edit.py` |
| `assets/nextbrowser-website-tour.gif` | A tour of the [Nextbrowser website](https://nextbrowser.com/). | `capture.mjs` |

Each GIF has an MP4 copy with the same name for reviews and embeds.

## Shared requirements

- Node.js 22 or newer.
- `ffmpeg` on `PATH`, or its path in the `FFMPEG` environment variable.
- `playwright-core`, installed without changing the lockfile:

```bash
npm install --no-save playwright-core
```

## Desktop app recording

The recording is made on Windows with the installed release, because Live View draws the profile
browser as a separate native window over the app. `record.mjs` drives the app through the Chrome
DevTools Protocol and `ffmpeg` captures the app's screen region.

1. Install the current release, sign in, and connect the agent (Claude Code).
2. Start one test profile (the recording uses `Clawbrowser profile`) and leave it on its start page.
3. Start the app with a local debugging port:

   ```powershell
   & "<install folder>\NextBrowser.exe" --remote-debugging-port=9333
   ```

4. In the app, send `/new` to open an empty project, then open **Processes**.
5. Size the window and record. Do not touch the mouse or other windows while it runs, and turn on
   Do Not Disturb so notifications stay out of the capture:

   ```powershell
   powershell -File scripts/readme-demo/app/window.ps1 -Action move -Width 1280 -Height 800
   node scripts/readme-demo/app/record.mjs readme-demo-recording
   ```

   The task is read-only: _"Use the Clawbrowser profile. Open the Wikipedia article on Apollo 11 and
   tell me the launch date."_ The script stops a few seconds after the answer with the date arrives.

6. Find the raw time when Live View leaves the start page (the address bar changes), then edit:

   ```powershell
   python scripts/readme-demo/app/edit.py readme-demo-recording assets --nav 31.1
   ```

`edit.py` needs Pillow. It replaces the account initials with a neutral avatar, masks the local
start-page address until `--nav`, keeps the pointer visible over the stop button while the agent
works, speeds up the waiting parts (typing ×1.6, agent work ×8, page load and answer ×1.6), and adds
a dissolve back to the first frame. Keep `readme-demo-recording/raw.mkv` out of Git, and review every
frame of the result for emails, keys, proxy details and personal data before committing.

## Website tour

`capture.mjs` records a short tour of the website:

1. The hero prompt types a sample task.
2. The orbit of agents, browsers and platforms around the app.
3. In the **Research** tab, the pointer picks the **Web scraping** workflow, the task is typed into
   the chat, and the agent reply with its result appears.
4. The stats, account safety, Focus on growth and How it works sections.
5. The final call to action, followed by a dissolve back to the first frame.

The website sections are illustrative product mockups, not a recording of the desktop app. The
script also needs Microsoft Edge or Google Chrome installed locally. From the repository root:

```bash
node scripts/readme-demo/capture.mjs
```

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

Scroll positions are measured from section selectors on the page. If the site layout changes, check
that each stop still frames its section and update the selectors in the script. Every scroll changes
the whole frame, so scrolls drive the file size. Keep the tour near 4 MiB: lower `--fps` or
`--colors`, or remove a stop, if it grows.

## Review before committing

- Check that no frame shows empty image boxes, private data or a flash at the loop point.
- Open the README on GitHub in light and dark themes at desktop and phone widths.
