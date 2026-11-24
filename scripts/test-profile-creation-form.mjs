import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { createServer } from "vite";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixture = await mkdtemp(path.join(tmpdir(), "nb-profile-form-"));
const modules = await realpath(path.join(root, "node_modules"));
const server = await createServer({ root, server: { host: "127.0.0.1", port: 0, watch: null, hmr: false, fs: { allow: [root, modules] } }, logLevel: "error" });
let app, page;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0] + "?preview=main&connector=connected";
  const env = { ...process.env, VITE_DEV_SERVER_URL: url, NEXTBROWSER_DEV_DATA_ROOT: fixture, NBC_AUTO_UPDATE: "0", NEXTBROWSER_ERROR_REPORTING: "0", NEXTBROWSER_DEVICE_REPORTING: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: [root, "--user-data-dir=" + path.join(fixture, "app")], executablePath: createRequire(import.meta.url)("electron"), env, timeout: 20000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(16000);
  page.on("pageerror", error => console.error(error.message));
  await page.goto(url);
  const rail = page.getByRole("button", { name: "Open Profiles", exact: true });
  await rail.waitFor();
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.setState({
      personalProxies: [{ id: "test-proxy", name: "Office proxy", scheme: "https", host: "office.test", port: 8080 }],
      loadPersonalProxies: async () => {},
      createManagedProfile: async (name, country, { runtime, direct }) => { window.profileCreation = { name, country, runtime, direct }; return name; },
      assignProfileToProject: async () => {},
    });
  });
  await rail.hover();
  await page.getByRole("dialog", { name: "Profiles", exact: true }).getByRole("button", { name: "Create browser profile" }).click();
  const form = page.getByRole("dialog", { name: "Create profile", exact: true });
  const field = name => form.getByRole("combobox", { name, exact: true });
  const choose = async (name, option) => {
    await field(name).click();
    await form.getByRole("option", { name: option }).click();
  };
  await form.getByPlaceholder("My profile").fill("Design check");
  await field("Browser toolset").click();
  assert.equal(await form.getByRole("option").count(), 4);
  assert.equal(await form.locator('[role="option"] strong :is(svg,img)').count(), 4);
  if (process.env.PROFILE_FORM_SCREENSHOT) await form.screenshot({ path: process.env.PROFILE_FORM_SCREENSHOT });
  await form.getByRole("option", { name: /^Multilogin/ }).click();
  await choose("Multilogin fingerprint OS", /^macOS$/);
  await choose("Browser toolset", /^DasBrowser/);
  await choose("Connection", /^Personal proxy/);
  await choose("Personal proxy", /Office proxy.*HTTPS.*office.test:8080/);
  await form.getByRole("button", { name: "Add proxy", exact: true }).click();
  const addProxy = page.getByRole("dialog", { name: "Create proxy", exact: true });
  await addProxy.getByRole("button", { name: "Close", exact: true }).click();
  await choose("Connection", /^Managed proxy/);
  await field("Proxy country").click();
  const search = form.getByRole("combobox", { name: /^Search countries/ });
  await search.fill("ge");
  assert.match(await form.getByRole("option").first().innerText(), /Georgia · GE/);
  await search.press("Escape");
  assert.equal(await form.isVisible(), true);
  await field("Proxy country").click();
  await search.fill("Thailand");
  await search.press("Enter");
  assert.match(await field("Proxy country").innerText(), /Thailand · TH/);
  await form.getByRole("button", { name: "Create profile", exact: true }).click();
  await form.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.profileCreation), { name: "Design check", country: "TH", runtime: "dasbrowser", direct: false });
  const firstTheme = await page.locator("html").getAttribute("data-theme");
  await page.getByRole("button", { name: /Switch to .* theme/ }).click();
  assert.notEqual(await page.locator("html").getAttribute("data-theme"), firstTheme);
  await rail.hover();
  await page.getByRole("dialog", { name: "Profiles", exact: true }).getByRole("button", { name: "Create browser profile" }).click();
  await field("Proxy country").click();
  await search.fill("Turk");
  assert.ok(await form.getByRole("option").count() > 0);
  if (process.env.PROFILE_COUNTRY_SCREENSHOT) await form.screenshot({ path: process.env.PROFILE_COUNTRY_SCREENSHOT });
  await search.press("Escape");
  await form.getByRole("button", { name: "Close profile creation" }).click();
  console.log("Passed both themes, provider-style fields, original icons, nested proxy dialog, country search, keyboard and submission.");
} catch (error) {
  if (page) console.error((await page.locator("body").innerText()).slice(0, 1000));
  throw error;
} finally {
  try { await app?.close(); } finally { await server.close(); await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
}
