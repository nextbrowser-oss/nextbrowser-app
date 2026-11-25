import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "nb-agent-theme-"));
const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NBC_AUTO_UPDATE: "0", NEXTBROWSER_ERROR_REPORTING: "0", NEXTBROWSER_DEVICE_REPORTING: "0" };
env.VITE_DEV_SERVER_URL = new URL("../dist/index.html?preview=main", import.meta.url).href;
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function openApp() {
  app = await _electron.launch({ args: [path.resolve(root), "--user-data-dir=" + path.join(profile, "app")],
    executablePath: createRequire(import.meta.url)("electron"), env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setContentSize(1280, 900);
    window.show();
  });
  await page.bringToFront();
  page.setDefaultTimeout(12000);
  await page.locator(".app > .sidebar").waitFor();
  return page;
}
async function openSettings(page) {
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  return page.getByRole("dialog", { name: "Settings", exact: true });
}
try {
  let page = await openApp();
  let settings = await openSettings(page);
  await settings.getByRole("tab", {name: /^Agent\b/}).click();
  const harness = settings.getByRole("switch", {name: "Use Harness²"});
  const web = settings.getByRole("switch", {name: "Prefer WebMCP"});
  assert.equal(await harness.isChecked(), false);
  await settings.getByText("Prefer WebMCP", {exact:true}).click();
  await harness.locator("..").click();
  assert.ok(await web.isChecked());
  assert.ok(await harness.isChecked());
  await settings.getByRole("tab", {name: "Themes"}).click();
  let section = settings.getByRole("region", {name: "Chat input appearance"});
  await section.getByRole("heading", {name: "Chat input appearance"}).waitFor();
  await section.getByRole("button", {name: "Blueprint", exact: true}).click();
  await settings.getByRole("button", {name: "Close settings"}).click();
  const composer = page.locator(".chat-composer-dock .composer").first();
  assert.equal(await composer.getAttribute("data-skin"), "blueprint");
  await composer.getByRole("button", {name: "Customize composer appearance"}).click();
  const picker = page.getByRole("dialog", {name: "Composer appearance"});
  await picker.getByRole("button", {name: "smeta", exact: true}).click();
  await picker.getByRole("button", {name: "Apply skin"}).click();
  await app.close();
  page = await openApp();
  settings = await openSettings(page);
  await settings.getByRole("tab", {name: "Themes"}).click();
  section = settings.getByRole("region", {name: "Chat input appearance"});
  await section.getByRole("button", {name: "smeta", pressed: true}).waitFor();
  await settings.getByRole("tab", {name: /^Agent\b/}).click();
  assert.ok(await settings.getByRole("switch", {name: "Use Harness²"}).isChecked());
  assert.ok(await settings.getByRole("switch", {name: "Prefer WebMCP"}).isChecked());
  await settings.getByRole("switch", {name: "Use Harness²"}).press("Space");
  assert.equal(await settings.getByRole("switch", {name: "Use Harness²"}).isChecked(), false);
  assert.ok(await settings.getByRole("switch", {name: "Prefer WebMCP"}).isChecked());
  console.log("Passed both composer entry points, independent agent preferences, and persistence across Electron restarts.");
} finally {
  try { await app?.close(); } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}
