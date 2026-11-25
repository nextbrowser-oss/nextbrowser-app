#!/usr/bin/env node
// Records a short tour of https://nextbrowser.com/ for the README: the hero prompt, the agent
// orbit, one workflow run in the Research tab, then the main sections down to the final call to
// action. Writes assets/nextbrowser-website-tour.gif and assets/nextbrowser-website-tour.mp4.
//
// Requirements: ffmpeg on PATH and `npm install --no-save playwright-core`.
// Usage: node scripts/readme-demo/capture.mjs [--url https://nextbrowser.com/] [--card "Web scraping"]
//        [--channel msedge|chrome] [--fps 12] [--width 800] [--colors 96] [--out assets] [--keep]
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
    fps: { type: "string", default: "12" },
    width: { type: "string", default: "800" },
    colors: { type: "string", default: "96" },
    dither: { type: "string", default: "bayer:bayer_scale=5" },
    fade: { type: "string", default: "0.5" },
    out: { type: "string", default: "assets" },
    keep: { type: "boolean", default: false },
  },
});
const VIEWPORT = { width: 1024, height: 768 };
const fps = Number(opts.fps);
const fadeSeconds = Number(opts.fade);
const outDir = path.resolve(opts.out);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-readme-demo-"));
const framesDir = path.join(work, "frames");
fs.mkdirSync(framesDir);

const { chromium } = await import("playwright-core");
const browser = await chromium.launch({ channel: opts.channel, headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", reducedMotion: "no-preference" });
const page = await context.newPage();
await page.goto(opts.url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

// Load every lazy image and play the reveal animations once, so the tour never shows empty boxes.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
    window.scrollTo(0, y);
    await sleep(120);
  }
  const loaded = (img) =>
    img.complete
      ? null
      : Promise.race([new Promise((resolve) => img.addEventListener("load", resolve, { once: true })), sleep(4000)]);
  await Promise.all([...document.images].map(loaded));
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1500);

// Headless screencasts do not include the system cursor, so a demo pointer is drawn in the page.
await page.addStyleTag({
  content: `
    html { scroll-behavior: auto !important; }
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; opacity: 0; transition: opacity .2s; }
    #demo-cursor.on { opacity: 1; }
    #demo-cursor svg { width: 22px; height: 22px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    #demo-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.85); z-index: 99998; pointer-events: none; opacity: 0; }
    #demo-ripple.on { animation: demo-ripple .45s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.4); opacity: .9 } to { transform: scale(1.25); opacity: 0 } }
  `,
});
await page.evaluate(() => {
  const cursor = document.createElement("div");
  cursor.id = "demo-cursor";
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.1 1.3 3.6 6.6-2.7 1.4-3.6-6.7L5 18.3z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const ripple = document.createElement("div");
  ripple.id = "demo-ripple";
  document.body.append(cursor, ripple);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const animate = (ms, frame) =>
    new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        frame(ease(t));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  const place = (x, y) => {
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    window.__demoCursor = { x, y };
  };
  window.__demoCursor = { x: -100, y: -100 };
  window.__demo = {
    place,
    show: (on) => cursor.classList.toggle("on", on),
    move: (x, y, ms) => {
      const { x: sx, y: sy } = window.__demoCursor;
      return animate(ms, (e) => place(sx + (x - sx) * e, sy + (y - sy) * e));
    },
    scroll: (y, ms) => {
      const sy = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ty = Math.max(0, Math.min(max, Math.round(y)));
      return animate(ms, (e) => window.scrollTo(0, sy + (ty - sy) * e));
    },
    click: (x, y) => {
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.classList.remove("on");
      void ripple.offsetWidth;
      ripple.classList.add("on");
    },
  };
});

// Scroll positions are measured on the live page so the tour follows layout changes.
const header = await page.evaluate(
  () => document.querySelector(".marketing-header")?.getBoundingClientRect().height ?? 0,
);
const topOf = (selector, nth = 0, offset = 0) =>
  page.evaluate(
    ({ selector, nth, offset }) => {
      const el = document.querySelectorAll(selector)[nth];
      if (!el) throw new Error(`Missing section: ${selector}`);
      return el.getBoundingClientRect().top + window.scrollY + offset;
    },
    { selector, nth, offset },
  );
const centerOf = (selector) =>
  page.evaluate(
    ({ selector, header }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`Missing element: ${selector}`);
      const r = el.getBoundingClientRect();
      return r.top + window.scrollY + r.height / 2 - (window.innerHeight + header) / 2;
    },
    { selector, header },
  );
const hasCta = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("footer h2, footer h3")].find((el) =>
    /Turn your accounts/i.test(el.textContent),
  );
  heading?.parentElement?.setAttribute("data-demo-cta", "");
  return Boolean(heading);
});
const stops = {
  orbit: await centerOf(".hero-orbit"),
  workflow: await topOf(".tab-shell", 0, -header - 14),
  stats: await topOf(".logo-cloud", 0, -header),
  safety: await topOf(".safety-section", 0, -header + 40),
  focus: await topOf(".focus-section", 0, -header + 20),
  how: await topOf(".content-section", 0, -header + 20),
  cta: hasCta ? await centerOf("[data-demo-cta]") : await topOf("footer", 0, -header),
};

const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (frame) => {
  const file = path.join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
  frames.push({ file, t: frame.metadata.timestamp });
  fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
});

const now = () => Date.now() / 1000;
const wait = (s) => page.waitForTimeout(s * 1000);
const scrollTo = (y, s = 0.75) => page.evaluate(({ y, ms }) => window.__demo.scroll(y, ms), { y, ms: s * 1000 });

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
await wait(0.3);
// The screencast can replay a stale first frame; frames before this point are ignored.
const tFresh = now();
await page.evaluate(() => window.scrollTo(0, 1));
await page.evaluate(() => window.scrollTo(0, 0));
await wait(0.3);
const tStart = now();

await wait(2.2); // the hero prompt types a sample task
await scrollTo(stops.orbit, 0.7);
await wait(1.2); // agents and browsers orbit the app

await scrollTo(stops.workflow, 0.7);
const target = await page.evaluate((title) => {
  const card = [...document.querySelectorAll(".tab-cards .mini-card")].find(
    (el) => el.querySelector("h3")?.textContent.trim() === title,
  );
  if (!card) throw new Error(`Workflow card not found: ${title}`);
  const r = card.getBoundingClientRect();
  return { x: r.x + r.width * 0.45, y: r.y + r.height * 0.42 };
}, opts.card);
const shell = await page.evaluate(() => {
  const r = document.querySelector(".tab-shell").getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.evaluate(
  ({ x, y }) => {
    window.__demo.place(x, y);
    window.__demo.show(true);
  },
  { x: shell.x + shell.width * 0.62, y: shell.y + shell.height * 0.82 },
);
await wait(0.3);
await page.evaluate(({ x, y }) => window.__demo.move(x, y, 650), target);
await wait(0.1);
await page.evaluate(
  ({ title, x, y }) => {
    window.__demo.click(x, y);
    [...document.querySelectorAll(".tab-cards .mini-card")]
      .find((el) => el.querySelector("h3")?.textContent.trim() === title)
      .click();
  },
  { title: opts.card, ...target },
);
await wait(0.3);
await page.evaluate(({ x, y }) => window.__demo.move(x, y, 800), {
  x: shell.x + shell.width * 0.93,
  y: shell.y + shell.height * 0.9,
});
await page.waitForSelector(".chat-card-received", { timeout: 15000 });
await wait(1.7); // the agent reply slides in and stays readable
await page.evaluate(() => window.__demo.show(false));

for (const [stop, hold] of [
  ["stats", 1.0],
  ["safety", 1.0],
  ["focus", 1.0],
  ["how", 1.1],
  ["cta", 1.7],
]) {
  await scrollTo(stops[stop], 0.6);
  await wait(hold);
}
const tEnd = now();
await wait(0.3);
await cdp.send("Page.stopScreencast");
await browser.close();

// Constant-rate timeline: the screencast only sends a frame when the page changes, so each output
// tick shows the newest frame captured by then. Repeated frames are merged into one longer entry.
const fresh = frames.filter((f) => f.t >= tFresh);
if (fresh.length === 0) throw new Error("No screencast frames were captured after the page settled.");
const ticks = Math.round((tEnd - tStart) * fps);
const runs = [];
let cursor = 0;
for (let i = 0; i < ticks; i += 1) {
  const t = tStart + i / fps;
  while (cursor + 1 < fresh.length && fresh[cursor + 1].t <= t) cursor += 1;
  const last = runs.at(-1);
  if (last && last.file === fresh[cursor].file) last.ticks += 1;
  else runs.push({ file: fresh[cursor].file, ticks: 1 });
}
const entry = (file) => `file '${file.replaceAll("\\", "/")}'`;
const list = runs.map((r) => `${entry(r.file)}\nduration ${(r.ticks / fps).toFixed(6)}`).join("\n");
fs.writeFileSync(path.join(work, "list.txt"), `${list}\n${entry(runs.at(-1).file)}\n`);

const duration = ticks / fps;
const width = Number(opts.width);
const scale = width === VIEWPORT.width ? "" : `scale=${width}:-2:flags=lanczos,`;
const ff = (...args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const master = path.join(work, "master.mkv");
// Lossless master with a dissolve from the call to action back to the first frame for a clean loop.
ff(
  "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"),
  "-filter_complex",
  `[0:v]${scale}fps=${fps},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,format=rgb24,split[a][b];` +
    `[b]trim=end_frame=1,loop=loop=${Math.ceil(fadeSeconds * fps) + 2}:size=1:start=0,setpts=N/${fps}/TB[first];` +
    `[a][first]xfade=transition=fade:duration=${fadeSeconds}:offset=${(duration - fadeSeconds).toFixed(3)}[v]`,
  "-map", "[v]", "-c:v", "ffv1", master,
);
fs.mkdirSync(outDir, { recursive: true });
const gif = path.join(outDir, "nextbrowser-website-tour.gif");
const mp4 = path.join(outDir, "nextbrowser-website-tour.mp4");
ff(
  "-i", master,
  "-filter_complex",
  `split[a][b];[a]palettegen=max_colors=${opts.colors}:stats_mode=full[p];[b][p]paletteuse=dither=${opts.dither}:diff_mode=rectangle`,
  "-loop", "0", gif,
);
ff(
  "-i", master,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-movflags", "+faststart", mp4,
);
if (opts.keep) console.log(`Work files kept in ${work}`);
else fs.rmSync(work, { recursive: true, force: true });
const kib = (file) => `${Math.round(fs.statSync(file).size / 1024)} KiB`;
console.log(JSON.stringify({ seconds: Number(duration.toFixed(2)), fps, width, gif: kib(gif), mp4: kib(mp4) }));
