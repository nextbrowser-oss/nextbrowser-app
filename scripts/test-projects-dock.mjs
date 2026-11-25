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
async function dragProjectsEdge(page, delta) {
  const edge = await page.getByRole("separator", { name: "Resize Projects" }).boundingBox();
  const x = edge.x + edge.width / 2, y = edge.y + edge.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 6 });
  await page.mouse.up();
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
  await dragProjectsEdge(page, 84);
  assert.equal((await dock.boundingBox()).width, panel.width + 84);
  assert.equal((await main.boundingBox()).width, content.width - 84);
  await dragProjectsEdge(page, -36);
  const chosenWidth = panel.width + 48;
  assert.equal((await dock.boundingBox()).width, chosenWidth);
  await dock.getByRole("button", { name: "Unpin Projects" }).click();
  assert.equal(await page.getByRole("separator", { name: "Resize Projects" }).count(), 0);
  assert.equal((await main.boundingBox()).width, width);
  await popup.getByRole("button", { name: "Pin Projects" }).click();
  assert.equal((await dock.boundingBox()).width, chosenWidth);
  await dock.getByRole("combobox").click();
  assert.equal(await dock.getByRole("option").count(), 4);
  await dock.getByRole("option", { name: "По имени · Я → А" }).click();
  await page.getByRole("button", { name: "Open Profile", exact: true }).click();
  assert.ok(await dock.isVisible());
  await app.close();
  page = await start();
  dock = page.getByRole("complementary", { name: "Projects" });
  assert.equal((await dock.boundingBox()).width, chosenWidth);
  const edge = page.getByRole("separator", { name: "Resize Projects" });
  await edge.press("Home");
  assert.equal((await dock.boundingBox()).width, Number(await edge.getAttribute("aria-valuemin")));
  await edge.press("End");
  assert.equal((await dock.boundingBox()).width, Number(await edge.getAttribute("aria-valuemax")));
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
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"Back to main view"}).click();
  await page.getByRole("tab", {name:"Open Processes"}).click();
  await page.locator(".live-workspace-pill").first().waitFor();
  await page.getByRole("button", {name:"Open Projects",exact:true}).hover();
  await restored.getByRole("button", {name:"Pin Projects"}).click();
  await dock.getByRole("button", {name:"Unpin Projects"}).click();
  await restored.waitFor();
  assert.equal(await dock.count(), 0);
  assert.ok(await page.locator("#live-side-chat").isVisible());
  await page.keyboard.press("Escape");
  await restored.waitFor({state:"hidden"});
  console.log("Passed Projects docking, saved width, sorting and immediate Unpin popup in normal and Live views.");
} finally {
  try { await app?.close(); } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}
