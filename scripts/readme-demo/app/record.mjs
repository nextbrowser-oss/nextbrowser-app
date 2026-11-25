// Records one real run in the installed Nextbrowser app: open a running profile from Processes,
// send a read-only task to Claude Code, wait for the answer. ffmpeg captures the app's screen
// region (the Live View browser is a separate native window drawn over the app).
// Windows only. Start Nextbrowser with --remote-debugging-port=9333, sign in to the agent, keep the
// profile running, open a new project (/new) and leave the Processes grid on screen.
// Usage: node scripts/readme-demo/app/record.mjs <outDir>
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("playwright-core");
const outDir = process.argv[2] ?? "readme-demo-recording";
fs.mkdirSync(outDir, { recursive: true });
const PROFILE = "Clawbrowser profile";
const PROMPT =
  "Use the Clawbrowser profile. Open the Wikipedia article on Apollo 11 and tell me the launch date.";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const WIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "window.ps1");

const ps = (...args) =>
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WIN, ...args], { encoding: "utf8" }).trim();
const [x, y, w, h] = ps("-Action", "front").split(/\s+/).map(Number);
console.log("window", x, y, w, h);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("index.html"));

// Demo pointer: the system cursor is not captured. edit.py masks the account initials.
await page.addStyleTag({
  content: `
  #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; opacity: 0; transition: opacity .2s; }
  #demo-cursor.on { opacity: 1; }
  #demo-cursor svg { width: 20px; height: 20px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
  #demo-ripple { position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.85); z-index: 2147483646; pointer-events: none; opacity: 0; }
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
  const place = (x, y) => {
    cursor.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    window.__c = { x, y };
  };
  window.__c = { x: innerWidth * 0.55, y: innerHeight * 0.75 };
  place(window.__c.x, window.__c.y);
  window.__demo = {
    show: (on) => cursor.classList.toggle("on", on),
    move: (x, y, ms) =>
      new Promise((resolve) => {
        const { x: sx, y: sy } = window.__c;
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = ease(t);
          place(sx + (x - sx) * e, sy + (y - sy) * e);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    click: (x, y) => {
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.classList.remove("on");
      void ripple.offsetWidth;
      ripple.classList.add("on");
    },
  };
});
const center = async (locator, fx = 0.5, fy = 0.5) => {
  const b = await locator.boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
};
const moveTo = (p, ms) => page.evaluate(({ x, y, ms }) => window.__demo.move(x, y, ms), { ...p, ms });
const tap = (p) => page.evaluate(({ x, y }) => window.__demo.click(x, y), p);

// Start the screen capture.
const video = path.join(outDir, "raw.mkv");
const ff = spawn(
  FFMPEG,
  ["-hide_banner", "-loglevel", "error", "-y", "-f", "gdigrab", "-draw_mouse", "0", "-framerate", "20",
   "-offset_x", String(x), "-offset_y", String(y), "-video_size", `${w}x${Math.min(h, 800)}`, "-i", "desktop",
   "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-pix_fmt", "yuv444p", video],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const t0 = Date.now();
const marks = [];
const mark = (label) => {
  const t = (Date.now() - t0) / 1000;
  marks.push({ label, t });
  console.log(label, t.toFixed(2));
};
const wait = (s) => page.waitForTimeout(s * 1000);

try {
  await wait(1.0);
  await page.evaluate(() => window.__demo.show(true));
  mark("start");
  await wait(1.2);
  const card = page.getByRole("button", { name: `Open ${PROFILE}` });
  const cardPoint = await center(card, 0.5, 0.45);
  await moveTo(cardPoint, 750);
  await wait(0.1);
  await tap(cardPoint);
  await card.click();
  mark("profile-click");
  // Live View is ready once the loading message is gone.
  for (let i = 0; i < 60; i++) {
    const loading = await page.evaluate(() => document.body.innerText.includes("Starting live view"));
    if (!loading && i > 1) break;
    await wait(0.5);
  }
  mark("live-ready");
  await wait(1.2);
  const box = page.locator("[contenteditable=true], textarea").last();
  const boxPoint = await center(box, 0.3, 0.5);
  await moveTo(boxPoint, 650);
  await tap(boxPoint);
  await box.click();
  await wait(0.2);
  mark("type-start");
  await page.keyboard.type(PROMPT, { delay: 32 });
  mark("type-end");
  await wait(0.5);
  const send = page.getByRole("button", { name: "Send message to the selected agent" });
  const sendPoint = await center(send);
  await moveTo(sendPoint, 500);
  await tap(sendPoint);
  await send.click();
  mark("sent");
  await wait(0.4);
  await moveTo({ x: sendPoint.x + 30, y: sendPoint.y - 260 }, 700);
  await page.evaluate(() => window.__demo.show(false));
  // Wait for the reply that names the date, then for the run to finish.
  let seen = false;
  for (let i = 0; i < 480; i++) {
    const state = await page.evaluate(() => {
      const text = document.body.innerText;
      const busy = [...document.querySelectorAll("button")].some((b) =>
        /^(Stop|Interrupt|Stop response|Stop generating)/i.test(b.getAttribute("aria-label") || ""),
      );
      return { hasDate: /July 16,? 1969|16 July 1969/.test(text), busy };
    });
    if (state.hasDate && !seen) {
      seen = true;
      mark("date-visible");
    }
    if (seen && !state.busy) break;
    await wait(0.5);
  }
  mark("done");
  await wait(4.0);
  mark("end");
} catch (e) {
  console.log("ERR", e.message.split("\n")[0]);
} finally {
  ff.stdin.write("q");
  await new Promise((r) => ff.on("close", r));
  fs.writeFileSync(path.join(outDir, "marks.json"), JSON.stringify({ window: { x, y, w, h }, marks }, null, 2));
  await page.evaluate(() => {
    document.getElementById("demo-cursor")?.remove();
    document.getElementById("demo-ripple")?.remove();
  });
  await browser.close();
  process.exit(0);
}
