import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), "nb-projects-dock-"));
const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: profile, NBC_AUTO_UPDATE: "0", NEXTBROWSER_ERROR_REPORTING: "0", NEXTBROWSER_DEVICE_REPORTING: "0" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function start() {
  app = await _electron.launch({ args: [root, "--user-data-dir=" + path.join(profile, "app")], executablePath: createRequire(import.meta.url)("electron"), env, timeout: 20000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await page.goto(new URL("../dist/index.html?preview=main", import.meta.url).href);
  return page;
}
async function pinColor(button, token) {
  return button.locator("svg").evaluate((icon, name) => {
    const probe = document.createElement("span");
    probe.style.color = "var(" + name + ")";
    icon.parentElement.append(probe);
    const matches = getComputedStyle(icon).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  }, token);
}
try {
  let page = await start();
  const main = page.locator(".app > main");
  await page.getByRole("button", { name: "Open Projects", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Projects", exact: true });
  const pin = popup.getByRole("button", { name: "Pin Projects" });
  const width = (await main.boundingBox()).width;
  assert.ok(await pinColor(pin, "--red"));
  await pin.click();
  let dock = page.getByRole("complementary", { name: "Projects" });
  await dock.waitFor();
  const [rail, panel, content] = await Promise.all([page.locator("#app-sidebar").boundingBox(), dock.boundingBox(), main.boundingBox()]);
  assert.ok(panel.x >= rail.x + rail.width && content.x >= panel.x + panel.width - 1);
  assert.ok(panel.height >= rail.height - 1 && content.width <= width - panel.width + 1);
  assert.ok(await pinColor(dock.getByRole("button", { name: "Unpin Projects" }), "--green"));
  await dock.getByRole("combobox").click();
  assert.equal(await dock.getByRole("option").count(), 4);
  await dock.getByRole("option", { name: "По имени · Я → А" }).click();
  await page.getByRole("button", { name: "Open Profile", exact: true }).click();
  assert.ok(await dock.isVisible());
  await app.close();
  page = await start();
  dock = page.getByRole("complementary", { name: "Projects" });
  await dock.getByRole("combobox").click();
  assert.equal(await dock.getByRole("option", { selected: true }).innerText(), "По имени · Я → А");
  await page.keyboard.press("Escape");
  await dock.getByRole("button", { name: "Unpin Projects" }).click();
  const restored = page.getByRole("dialog", { name: "Projects" });
  await restored.waitFor();
  assert.equal((await page.locator(".app > main").boundingBox()).width, width);
  await page.keyboard.press("Escape");
  await restored.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Open Projects", exact: true }).hover();
  await restored.waitFor();
  console.log("Passed Projects pin colors, dock layout, sort options, restart, unpin and hover.");
} finally {
  try { await app?.close(); } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}
