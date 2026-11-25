import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), "nextbrowser-scale-"));
const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NEXTBROWSER_ERROR_REPORTING: "0",
  NEXTBROWSER_DEVICE_REPORTING: "0", NBC_AUTO_UPDATE: "0" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const modifier = process.platform === "darwin" ? "meta" : "control";
let app;

async function launch() {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"),
    args: [root, "--user-data-dir=" + path.join(profile, "app")], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--window-zoom"), undefined, { timeout: 15000 });
  return page;
}

async function expectScale(page, percent) {
  await page.waitForFunction(value => Number(document.documentElement.style.getPropertyValue("--window-zoom")) === value,
    percent / 100, { timeout: 4000 });
  const nativeZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  assert.ok(Math.abs(nativeZoom - percent / 100) < 0.001, `Electron zoom at ${percent}%`);
}

// CDP keyboard events reach the DOM directly and skip Electron's native menu shortcuts.
async function press(keyCode, shift = false) {
  await app.evaluate(({ BrowserWindow }, input) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    win.webContents.focus();
    for (const type of ["keyDown", "keyUp"]) win.webContents.sendInputEvent({ type, ...input });
  }, { keyCode, modifiers: shift ? [modifier, "shift"] : [modifier] });
}

try {
  let page = await launch();
  await expectScale(page, 100);
  await press("=", true);
  await expectScale(page, 110);
  await press("=");
  await expectScale(page, 120);
  await press("-");
  await expectScale(page, 110);
  const size = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1010, 680);
    return win.getSize();
  });
  await app.close();
  app = undefined;
  page = await launch();
  await expectScale(page, 110);
  const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  assert.ok(restored.every((value, index) => Math.abs(value - size[index]) <= 1), `Restored ${restored} from ${size}`);
  await press("0");
  await expectScale(page, 100);
  await press("numsub");
  await expectScale(page, 90);
  await press("numadd");
  await expectScale(page, 100);
  const url = new URL(page.url());
  url.searchParams.set("preview", "main");
  await page.goto(url.href);
  await page.getByRole("button", { name: /^Settings(, update available)?$/ }).click({ timeout: 6000 });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "General" }).click();
  await settings.getByRole("button", { name: "Increase interface size" }).click();
  await expectScale(page, 110);
  await press("-");
  await expectScale(page, 100);
  assert.equal(await settings.locator(".ui-scale-value").innerText(), "100%");
  await app.close();
  app = undefined;
  const prefs = JSON.parse(await readFile(path.join(profile, "app", "app-settings.json"), "utf8"));
  const storedSize = JSON.parse(prefs.values["nextbrowser.windowSize"]);
  assert.deepEqual([storedSize.width, storedSize.height], size, "another shutdown must not accumulate rounding");
  console.log("Interface shortcuts, native zoom and window size survived a full application restart.");
} finally {
  try { await app?.close(); }
  finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}
