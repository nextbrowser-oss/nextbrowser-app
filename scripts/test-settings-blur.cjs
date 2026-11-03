// Exercise production CSS in the bundled Electron engine. A Vite screenshot
// cannot catch minification retaining only an obsolete prefixed CSS property.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const output = path.resolve("e2e-out/settings-blur-native");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, `fixture-profile-${process.pid}`));

// Isolated IPC and synthetic text only: no personal profile, account or network.
ipcMain.on("nextbrowser:settings-read", (event) => { event.returnValue = {}; });
ipcMain.on("nextbrowser:settings-update", () => {});
ipcMain.handle("nextbrowser:invoke", (_event, command) => {
  if (command === "nextctl_version") return "1.2.39";
  if (command === "nextctl_supports_skill") return true;
  if (command === "browser_runtime_update_status") return { status: "ready", runtimes: [] };
  if (command === "browser_runtime_install_status" || command === "browser_runtime_update_install_status") return { status: "idle" };
  if (command === "app_update_status") return { status: "not-available" };
  if (command === "error_reporting_status") return { enabled: false, available: false };
  if (command === "manual_proxies_list") return [];
  if (command === "github_stars") return 66;
  return {};
});

function sharpness(image, region = { x: 20, y: 130, width: 150, height: 520 }) {
  const pixels = image.toBitmap({ scaleFactor: 1 });
  const { width, height } = image.getSize(1);
  const at = (x, y) => { const i = (y * width + x) * 4; return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3; };
  let sum = 0, squares = 0, edges = 0, count = 0;
  for (let y = Math.max(1, Math.floor(region.y)); y < Math.min(height - 1, region.y + region.height); y++) {
    for (let x = Math.max(1, Math.floor(region.x)); x < Math.min(width - 1, region.x + region.width); x++) {
      const value = at(x, y);
      const laplacian = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * value;
      sum += value; squares += value * value; edges += laplacian * laplacian; count++;
    }
  }
  const variance = squares / count - (sum / count) ** 2;
  // Normalize contrast: dimming sharp text alone must not pass as blur.
  return { variance, edges: (edges / count) / (variance + 1) };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const renderer = path.resolve(process.argv[2] || "dist/index.html");
  const preload = process.argv[2] ? path.resolve(path.dirname(renderer), "../electron/preload.cjs") : path.resolve("electron/preload.cjs");
  const window = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith("file:") && !details.url.startsWith("data:") }));
  await window.loadFile(renderer, { query: { preview: "main" } });
  window.webContents.debugger.attach("1.3");
  const media = (value) => window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value }] });
  await media("no-preference");
  await pause(700);
  await window.webContents.executeJavaScript(`(() => {
    const marker = document.createElement('div');
    marker.style.cssText='position:fixed;inset:0;z-index:50;pointer-events:none;background:white;color:black;font:24px/34px monospace;overflow:hidden';
    marker.textContent='READABLE BACKGROUND TEXT — ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890 '.repeat(150);
    document.querySelector('.app').append(marker);
  })()`);
  const capture = async () => {
    // A hidden window may return its last frame while scheduling a repaint.
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await pause(200);
    return window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  };
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await pause(250);
    const before = await capture();
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Settings"]').click()`);
    await pause(500);
    const styles = await window.webContents.executeJavaScript(`(() => {
      const rect=document.querySelector('#settings-title').getBoundingClientRect();
      return {overlay:getComputedStyle(document.querySelector('.settings-overlay')).backdropFilter,
        card:getComputedStyle(document.querySelector('.settings-modal')).backdropFilter,
        label:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:innerWidth};
    })()`);
    assert.match(styles.overlay, /^blur\(/, "production overlay must retain the supported backdrop-filter property");
    assert.match(styles.card, /^blur\(/, "production modal must retain the supported backdrop-filter property");
    const after = await capture();
    fs.writeFileSync(path.join(output, `${theme}-before.png`), before.toPNG());
    fs.writeFileSync(path.join(output, `${theme}-settings.png`), after.toPNG());
    const baseline = sharpness(before), background = sharpness(after);
    assert.ok(baseline.variance > 100, "fixture must contain readable high-contrast background text");
    assert.ok(background.edges < baseline.edges * 0.25, `${theme}: background letters must be blurred, not merely dimmed`);
    const scale = after.getSize(1).width / styles.viewport;
    const label = Object.fromEntries(Object.entries(styles.label).map(([key, value]) => [key, value * scale]));
    assert.ok(sharpness(after, label).edges > 0.1, `${theme}: Settings title must remain sharp`);
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close settings"]').click()`);
    await pause(250);
    assert.ok(sharpness(await capture()).edges > baseline.edges * 0.8, "closing Settings must restore sharp content");
    console.log(`Settings blur passed in ${theme}: ${styles.overlay}; background edge ratio ${(background.edges / baseline.edges).toFixed(3)}.`);
  }
  await media("reduce");
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="Settings"]').click()`);
  await pause(300);
  const reduced = await window.webContents.executeJavaScript(`(() => {
    const card=document.querySelector('.settings-modal'), canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
    ctx.fillStyle=getComputedStyle(card).backgroundColor;ctx.fillRect(0,0,1,1);
    return {blur:getComputedStyle(card).backdropFilter,alpha:ctx.getImageData(0,0,1,1).data[3]};
  })()`);
  assert.equal(reduced.blur, "none");
  assert.equal(reduced.alpha, 255, "reduced transparency must give the modal an opaque background");
  window.webContents.debugger.detach();
  console.log("Production Electron Settings material passed: actual blurred pixels, sharp foreground, close restoration, reduced-transparency fallback.");
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
