#!/usr/bin/env node
// Captures the README demo from the workflow block on https://nextbrowser.com/ and writes
// assets/nextbrowser-interface-demo.gif and assets/nextbrowser-interface-demo.mp4.
//
// Requirements: ffmpeg on PATH and `npm install --no-save playwright-core`.
// Usage: node scripts/readme-demo/capture.mjs [--url https://nextbrowser.com/] [--card "Web scraping"]
//        [--channel msedge|chrome] [--fps 20] [--colors 128] [--out assets]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    url: { type: "string", default: "https://nextbrowser.com/" },
    card: { type: "string", default: "Web scraping" },
    channel: { type: "string", default: process.platform === "darwin" ? "chrome" : "msedge" },
    fps: { type: "string", default: "20" },
    colors: { type: "string", default: "128" },
    hold: { type: "string", default: "2.4" },
    fade: { type: "string", default: "0.45" },
    out: { type: "string", default: "assets" },
    keep: { type: "boolean", default: false },
  },
});
const fps = Number(opts.fps);
const holdSeconds = Number(opts.hold);
const fadeSeconds = Number(opts.fade);
const outDir = path.resolve(opts.out);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-readme-demo-"));
const framesDir = path.join(work, "frames");
fs.mkdirSync(framesDir);

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: opts.channel, headless: true });
const context = await browser.newContext({
  viewport: { width: 1024, height: 1000 },
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
await page.goto(opts.url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// Only the workflow block is recorded: hide the site header and add a visible demo pointer,
// because headless screencasts do not include the system cursor.
await page.addStyleTag({
  content: `
    header { visibility: hidden !important; }
    html { scroll-behavior: auto !important; }
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; }
    #demo-cursor svg { width: 22px; height: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    #demo-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.85); z-index: 99998; pointer-events: none; opacity: 0; }
    #demo-ripple.on { animation: demo-ripple .45s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.4); opacity: .9 } to { transform: scale(1.25); opacity: 0 } }
  `,
});

const shell = await page.evaluate(() => {
  const el = document.querySelector(".tab-shell");
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40);
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
// Wait until the workflow screenshots on the right are decoded so the first frame is complete.
await page.waitForFunction(() =>
  [...document.querySelectorAll(".tab-image-set.is-active img")].every((img) => img.complete && img.naturalWidth > 0),
);
await page.waitForTimeout(800);

await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.1 1.3 3.6 6.6-2.7 1.4-3.6-6.7L5 18.3z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ripple = document.createElement("div");
  ripple.id = "demo-ripple";
  document.body.append(cursor, ripple);
  const place = (x, y) => {
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    window.__demoCursor = { x, y };
  };
  window.__demoPlace = place;
  window.__demoMove = (x, y, ms) =>
    new Promise((resolve) => {
      const { x: sx, y: sy } = window.__demoCursor;
      const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = ease(t);
        place(sx + (x - sx) * e, sy + (y - sy) * e);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  window.__demoClick = (x, y) => {
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.remove("on");
    void ripple.offsetWidth;
    ripple.classList.add("on");
  };
});

const target = await page.evaluate((title) => {
  const card = [...document.querySelectorAll(".tab-cards .mini-card")].find(
    (el) => el.querySelector("h3")?.textContent.trim() === title,
  );
  if (!card) throw new Error(`Workflow card not found: ${title}`);
  const r = card.getBoundingClientRect();
  return { x: r.x + r.width * 0.45, y: r.y + r.height * 0.42 };
}, opts.card);
const rest = { x: shell.x + shell.width * 0.93, y: shell.y + shell.height * 0.9 };
await page.evaluate(({ x, y }) => window.__demoPlace(x, y), {
  x: shell.x + shell.width * 0.62,
  y: shell.y + shell.height * 0.82,
});
await page.waitForTimeout(200);

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (frame) => {
  const file = path.join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
  frames.push({ file, t: frame.metadata.timestamp });
  fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
});

const now = () => Date.now() / 1000;
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1 });
await page.waitForTimeout(300);
// The screencast only emits frames on change and may replay a stale first frame,
// so nudge the pointer to force a fresh frame and ignore everything before it.
const tFresh = now();
await page.evaluate(({ x, y }) => window.__demoMove(x + 1, y, 120).then(() => window.__demoMove(x, y, 120)), {
  x: shell.x + shell.width * 0.62,
  y: shell.y + shell.height * 0.82,
});
await page.waitForTimeout(300);
const tStart = now();
await page.waitForTimeout(900);
await page.evaluate(({ x, y }) => window.__demoMove(x, y, 750), target);
await page.waitForTimeout(120);
await page.evaluate(
  ({ title, x, y }) => {
    window.__demoClick(x, y);
    [...document.querySelectorAll(".tab-cards .mini-card")]
      .find((el) => el.querySelector("h3")?.textContent.trim() === title)
      .click();
  },
  { title: opts.card, ...target },
);
await page.waitForTimeout(350);
await page.evaluate(({ x, y }) => window.__demoMove(x, y, 900), rest);
await page.waitForSelector(".chat-card-received", { timeout: 15000 });
// The reply slides in for ~0.45s after the "received" stage starts.
const tEnd = now() + 0.45 + holdSeconds;
await page.waitForTimeout((0.45 + holdSeconds) * 1000 + 300);
await cdp.send("Page.stopScreencast");
const endShell = await page.evaluate(() => document.querySelector(".tab-shell").getBoundingClientRect().height);
await browser.close();

// Constant-rate timeline from the change-driven screencast frames.
const tIn = tStart + 0.15;
const freshIndex = frames.findIndex((f) => f.t >= tFresh);
if (freshIndex < 0) throw new Error("No screencast frames were captured after the page settled.");
let firstIndex = freshIndex;
frames.forEach((f, i) => {
  if (i >= freshIndex && f.t <= tIn) firstIndex = i;
});
const used = frames.slice(firstIndex).filter((f, i) => i === 0 || f.t < tEnd);
const list = used
  .map((f, i) => {
    const from = i === 0 ? tIn : f.t;
    const to = i + 1 < used.length ? used[i + 1].t : tEnd;
    return `file '${f.file.replaceAll("\\", "/")}'\nduration ${Math.max(0.001, to - from).toFixed(4)}`;
  })
  .join("\n");
fs.writeFileSync(path.join(work, "list.txt"), `${list}\nfile '${used.at(-1).file.replaceAll("\\", "/")}'\n`);

const pad = 16;
const crop = {
  x: Math.round(shell.x - pad),
  y: Math.round(shell.y - pad),
  w: Math.round(shell.width + pad * 2),
  h: Math.round(Math.max(shell.height, endShell) + pad * 2),
};
const duration = tEnd - tIn;
const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const master = path.join(work, "master.mkv");
// Lossless master with a dissolve from the final result back to the first frame for a clean loop.
ff(
  "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"),
  "-filter_complex",
  `[0:v]crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},fps=${fps},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,format=rgb24,split[a][b];` +
    `[b]trim=end_frame=1,loop=loop=${Math.ceil(fadeSeconds * fps) + 2}:size=1:start=0,setpts=N/${fps}/TB[first];` +
    `[a][first]xfade=transition=fade:duration=${fadeSeconds}:offset=${(duration - fadeSeconds).toFixed(3)}[v]`,
  "-map", "[v]", "-c:v", "ffv1", master,
);
// Poster: the finished result, just before the loop dissolve starts.
fs.mkdirSync(outDir, { recursive: true });
const gif = path.join(outDir, "nextbrowser-interface-demo.gif");
const mp4 = path.join(outDir, "nextbrowser-interface-demo.mp4");
ff(
  "-i", master,
  "-filter_complex",
  `split[a][b];[a]palettegen=max_colors=${opts.colors}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  "-loop", "0", gif,
);
ff(
  "-i", master,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-movflags", "+faststart", mp4,
);
if (opts.keep) {
  ff("-ss", (duration - fadeSeconds - 0.1).toFixed(3), "-i", master, "-frames:v", "1", path.join(work, "poster.png"));
  console.log(`Work files kept in ${work}`);
} else {
  fs.rmSync(work, { recursive: true, force: true });
}
const kib = (file) => `${Math.round(fs.statSync(file).size / 1024)} KiB`;
console.log(
  JSON.stringify({ size: `${crop.w}x${crop.h}`, seconds: Number(duration.toFixed(2)), fps, gif: kib(gif), mp4: kib(mp4) }),
);
