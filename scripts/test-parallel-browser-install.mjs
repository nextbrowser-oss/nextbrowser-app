import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright-core";
const { createRuntimeInstallCoordinator } = createRequire(import.meta.url)("../electron/runtime-install-coordinator.cjs");

// Real renderer + real install coordinator, with deferred fixture installers.
// No browser software is downloaded, installed, or launched by this journey.
const url = "http://127.0.0.1:1425";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1425"], { windowsHide: true, stdio: "ignore" });
let browser;
let page;
const errors = [];
async function setup() {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
  const entries = [
    { runtime: "clawbrowser", name: "Clawbrowser", status: "not-installed", latestVersion: "1.0.11", releasePage: "https://github.com/clawbrowser/clawbrowser/releases" },
    { runtime: "camoufox", name: "Camoufox", status: "not-installed", latestVersion: "0.5.9", releasePage: "https://pypi.org/project/camoufox/" },
    { runtime: "dasbrowser", name: "DasBrowser", status: "not-installed", latestVersion: "150.4", releasePage: "https://www.dasbrowser.com/download" },
  ];
  const status = () => ({ status: "ready", checkedAt: Date.now(), runtimes: structuredClone(entries) });
  const started = [];
  const controls = new Map();
  let events = Promise.resolve();
  const target = page;
  const coordinator = createRuntimeInstallCoordinator({
    checkForUpdates: async () => status(),
    installRuntime: (update, report, signal) => new Promise((resolve, reject) => {
      started.push(update.runtime);
      const percent = update.runtime === "clawbrowser" ? 31 : 62;
      report({ phase: "downloading", percent, receivedBytes: percent * 1024, totalBytes: 100 * 1024, canCancel: update.runtime === "clawbrowser" });
      controls.set(update.runtime, {
        reject,
        resolve() {
          const entry = entries.find((item) => item.runtime === update.runtime);
          entry.status = "up-to-date";
          entry.currentVersion = entry.latestVersion;
          resolve();
        },
      });
      if (update.runtime === "clawbrowser") signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })), { once: true });
    }),
    onStatus: (payload) => {
      events = events.then(() => target.evaluate((status) => window.__runtimeEmit?.("browser-runtime:update-install", status), payload)).catch(() => {});
    },
  });
  await page.exposeFunction("__runtimeInvoke", async (command, args = {}) => {
    if (command === "browser_runtime_install_updates") return coordinator.install(args.runtimes);
    if (command === "browser_runtime_cancel_updates") return coordinator.cancel(args.runtime);
    if (command === "browser_runtime_update_install_status") return coordinator.snapshot();
    if (command === "browser_runtime_update_status" || command === "browser_runtime_check_for_updates") return status();
    if (command === "browser_runtime_install_status") return { status: "idle" };
    if (command === "browser_runtime_clawbrowser_active_sessions" || command === "manual_proxies_list") return [];
    if (command === "nextctl_version") return "1.2.39";
    if (command === "nextctl_supports_skill") return true;
    if (command === "app_update_status" || command === "app_check_for_update") return { status: "not-available" };
    if (command === "error_reporting_status") return { enabled: false, available: false };
    if (command === "app_platform") return { platform: "win32", arch: "x64" };
    if (command === "dashboard_auth_status") return { authed: true };
    if (command === "github_star_status") return { eligible: false };
    if (command === "github_stars") return 64;
    return {};
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    localStorage.setItem("nextbrowser.theme", "light");
    window.__runtimeEmit = (name, payload) => { for (const listener of listeners.get(name) || []) listener(payload); };
    window.nextbrowser = {
      invoke: (command, args = {}) => window.__runtimeInvoke(command, args),
      on(name, listener) { const set = listeners.get(name) || new Set(); set.add(listener); listeners.set(name, set); return () => set.delete(listener); },
    };
  });
  await page.goto(`${url}/?preview=main`);
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  const modal = page.getByRole("dialog", { name: "Settings", exact: true });
  await modal.getByRole("tab", { name: /^Updates/ }).click();
  const group = (name) => modal.getByRole("group", { name: `${name} installation`, exact: true });
  const row = (name) => modal.locator(".settings-runtime-entry").filter({ hasText: name });
  const hide = async () => { const button = page.getByRole("button", { name: "Hide update progress", exact: true }); if (await button.count()) await button.click(); };
  const install = async (name) => {
    await row(name).getByRole("button", { name: /^(Install|Retry)$/ }).click();
    await page.getByRole("dialog", { name: "Install browser toolset", exact: true }).getByRole("button", { name: "Install now", exact: true }).click();
  };
  return { modal, group, row, hide, install, started, controls, coordinator };
}
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i >= 100) throw new Error("Parallel install QA server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome"), headless: true });
  let test = await setup();
  await test.install("Clawbrowser");
  await test.group("Clawbrowser").getByText("31% downloaded", { exact: false }).waitFor();
  await test.hide();
  assert.equal(await test.row("Camoufox").getByRole("button", { name: "Install", exact: true }).isEnabled(), true);
  await test.install("Camoufox");
  await test.group("Camoufox").getByText("62% downloaded", { exact: false }).waitFor();
  assert.deepEqual(test.started, ["clawbrowser", "camoufox"]);
  assert.equal(await test.modal.getByRole("button", { name: "Download all", exact: true }).isDisabled(), true);
  await test.hide();
  await test.group("Camoufox").scrollIntoViewIfNeeded();
  await mkdir("e2e-out", { recursive: true });
  await page.screenshot({ path: "e2e-out/parallel-browser-downloads.png" });
  test.controls.get("clawbrowser").reject(new Error("fetch failed"));
  await test.row("Clawbrowser").getByRole("button", { name: "Retry", exact: true }).waitFor();
  assert.equal(await test.group("Camoufox").getByRole("progressbar").getAttribute("aria-valuenow"), "62");
  await test.install("Clawbrowser");
  await test.group("Clawbrowser").getByRole("button", { name: "Cancel Clawbrowser download", exact: true }).click();
  await test.group("Clawbrowser").getByText("Clawbrowser · Stopped", { exact: true }).waitFor();
  assert.equal(await test.group("Camoufox").getByRole("progressbar").getAttribute("aria-valuenow"), "62");
  test.controls.get("camoufox").resolve();
  await test.modal.getByText("0.5.9 · Up to date", { exact: true }).waitFor();
  await test.hide();
  await test.modal.getByRole("button", { name: "Download all", exact: true }).click();
  await test.group("Clawbrowser").getByText("31% downloaded", { exact: false }).waitFor();
  assert.equal(test.started.filter((runtime) => runtime === "camoufox").length, 1, "Download all must skip an installed browser");
  test.controls.get("clawbrowser").resolve();
  await test.modal.getByText("1.0.11 · Up to date", { exact: true }).waitFor();
  assert.equal(test.started.filter((runtime) => runtime === "dasbrowser").length, 0);
  await page.close();
  test = await setup();
  await test.modal.getByRole("button", { name: "Download all", exact: true }).click();
  await test.group("Camoufox").getByText("62% downloaded", { exact: false }).waitFor();
  assert.deepEqual(test.started, ["clawbrowser", "camoufox"], "Download all must start both before either finishes");
  await test.hide();
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(await test.modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  test.controls.get("clawbrowser").resolve(); test.controls.get("camoufox").resolve();
  await test.modal.getByText("0.5.9 · Up to date", { exact: true }).waitFor();
  assert.equal(await test.modal.getByRole("button", { name: "Download all", exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("Parallel installation journey passed: individual installs overlap, Download all, independent progress, retry during another download, per-browser cancellation, installed-browser skip and narrow layout.");
} catch (error) {
  if (page && !page.isClosed()) {
    await mkdir("e2e-out", { recursive: true });
    await page.screenshot({ path: "e2e-out/parallel-install-failure.png" });
    console.error((await page.locator("body").innerText()).slice(-6500));
  }
  throw error;
} finally { await browser?.close(); vite.kill(); }
