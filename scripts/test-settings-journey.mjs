import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

// Real renderer and real clicks, with an isolated IPC host. Never download or
// install software, contact the backend, or read the person's app profile.
const url = "http://127.0.0.1:1423";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1423"], { windowsHide: true, stdio: "ignore" });
let browser;
let page;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* server is starting */ }
    if (attempt >= 100) throw new Error("The settings QA server did not start.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome"), headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text().slice(0, 2000)); });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.stack); });
  await page.route("**/*", (route) => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const listeners = new Map();
    const calls = [];
    const runtimes = [
      { runtime: "clawbrowser", name: "Clawbrowser", status: "up-to-date", currentVersion: "1.0.6", latestVersion: "1.0.6", availabilityMessage: "1.0.6 is the latest published build for darwin/arm64. Release 1.0.11 does not include this platform.", releasePage: "https://github.com/clawbrowser/clawbrowser/releases/tag/1.0.6" },
      { runtime: "camoufox", name: "Camoufox", status: "available", currentVersion: "0.5.8", latestVersion: "0.5.9", releasePage: "https://pypi.org/project/camoufox/" },
      { runtime: "dasbrowser", name: "DasBrowser", status: "not-installed", latestVersion: "150.4", releasePage: "https://www.dasbrowser.com/download" },
    ];
    let operation = { status: "idle" };
    let finish;
    let appAvailable = false;
    const emit = (name, payload) => { for (const listener of listeners.get(name) || []) listener(structuredClone(payload)); };
    const runtimeStatus = () => ({ status: "ready", checkedAt: Date.now(), runtimes: structuredClone(runtimes) });
    localStorage.setItem("nextbrowser.runtimeUpdatePromptDismissed", "camoufox:0.5.9|dasbrowser:150.4");
    localStorage.setItem("nextbrowser.theme", "dark");
    window.__settingsQA = {
      calls,
      complete() {
        runtimes[1].status = "up-to-date";
        runtimes[1].currentVersion = "0.5.9";
        operation = { status: "ready", completed: ["camoufox"], message: "Camoufox updated.", updatedAt: Date.now() };
        emit("browser-runtime:update", runtimeStatus());
        emit("browser-runtime:update-install", operation);
        finish?.(structuredClone(operation));
      },
      offerAppUpdate() { appAvailable = true; },
    };
    window.nextbrowser = {
      on(name, listener) { const set = listeners.get(name) || new Set(); set.add(listener); listeners.set(name, set); return () => set.delete(listener); },
      async invoke(command, args = {}) {
        calls.push({ command, args });
        if (command === "app_update_status" || command === "app_check_for_update") return { status: appAvailable ? "available" : "not-available", version: "0.2.73" };
        if (command === "app_download_update") return { status: "downloaded", version: "0.2.73" };
        if (command === "browser_runtime_update_status" || command === "browser_runtime_check_for_updates") return runtimeStatus();
        if (command === "browser_runtime_update_install_status") return structuredClone(operation);
        if (command === "browser_runtime_clawbrowser_active_sessions") return [];
        if (command === "browser_runtime_install_updates") {
          operation = { status: "installing", runtimes: args.runtimes, currentRuntime: "camoufox", currentName: "Camoufox", phase: "downloading", percent: 37, canCancel: true, message: "Downloading Camoufox…", updatedAt: Date.now() };
          emit("browser-runtime:update-install", operation);
          return new Promise((resolve) => { finish = resolve; });
        }
        if (command === "browser_runtime_cancel_updates") {
          operation = { status: "cancelled", message: "Update cancelled. You can try again from Settings.", updatedAt: Date.now() };
          emit("browser-runtime:update-install", operation);
          finish?.(structuredClone(operation));
          return structuredClone(operation);
        }
        if (command === "nextctl_version") return "1.2.38";
        if (command === "nextctl_supports_skill") return true;
        if (command === "nextctl_run") {
          if (args.args?.[0] === "update") return { code: 0, stdout: "nbc already up to date: 1.2.38", stderr: "" };
          const from = args.args?.[args.args.indexOf("--from") + 1] || "2026-11-01";
          const to = args.args?.[args.args.indexOf("--to") + 1] || "2026-11-03";
          return { code: 0, stdout: JSON.stringify({ ok: true, data: { proxy_traffic_history: { from, to, timezone: "UTC", total_bytes: 524288, total_requests: 96, data_points: [{ label: from, used_bytes: 524288, requests: 96 }], sources: [{ source: "proxy", used_bytes: 524288, requests: 96 }], top_domains: Array.from({ length: 18 }, (_, index) => ({ domain: `site${index}.example.com`, used_bytes: 1024, requests: 2 })) } } }), stderr: "" };
        }
        if (command === "error_reporting_status") return { enabled: false, available: false };
        if (command === "github_stars") return 64;
        if (command === "manual_proxies_list") return [];
        if (command === "app_platform") return { platform: "win32", arch: "x64" };
        if (command === "browser_runtime_install_status") return { status: "idle" };
        if (command === "github_star_status") return { eligible: false };
        if (command === "dashboard_auth_status") return { authed: true };
        return {};
      },
    };
  });
  await page.goto(`${url}/?preview=main`);
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  const modal = page.getByRole("dialog", { name: "Settings", exact: true });
  await modal.getByRole("tab", { name: /^Updates/ }).click();
  await modal.getByText("Release 1.0.11 does not include this platform.", { exact: false }).waitFor();
  await modal.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  await page.getByRole("button", { name: "Hide update progress" }).waitFor();
  await page.getByRole("button", { name: "Hide update progress" }).click();
  assert.equal(await modal.getByRole("button", { name: "Updating…", exact: true }).isDisabled(), true);
  assert.equal(await modal.getByRole("progressbar").getAttribute("aria-valuenow"), "37");
  assert.equal(await modal.getByRole("button", { name: "Update all", exact: true }).isDisabled(), true);
  await mkdir("e2e-out", { recursive: true });
  await page.screenshot({ path: "e2e-out/settings-updates-running.png" });
  await modal.getByRole("button", { name: "Cancel update", exact: true }).click();
  await modal.getByText("Updates stopped", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  await page.getByRole("button", { name: "Hide update progress" }).click();
  await page.evaluate(() => window.__settingsQA.complete());
  await modal.getByText("0.5.9 · Up to date", { exact: true }).waitFor();
  assert.equal(await modal.getByRole("button", { name: "Update", exact: true }).count(), 0);
  await modal.getByRole("tab", { name: "Proxy", exact: true }).click();
  await modal.getByRole("button").filter({ hasText: "Proxy usage" }).click();
  await modal.getByRole("heading", { name: "Proxy usage", exact: true }).waitFor();
  await modal.getByRole("button", { name: "30 days", exact: true }).click();
  await modal.getByRole("cell", { name: "site0.example.com", exact: true }).waitFor({ state: "attached" });
  await page.screenshot({ path: "e2e-out/settings-proxy-usage.png" });
  await modal.getByRole("tab", { name: "General", exact: true }).click();
  await modal.getByRole("tab", { name: "Proxy", exact: true }).click();
  assert.equal(await modal.getByRole("button", { name: "30 days", exact: true }).getAttribute("class"), "active");
  await page.setViewportSize({ width: 560, height: 760 });
  assert.equal(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  assert.equal(await page.locator(".settings-panel").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  await page.screenshot({ path: "e2e-out/settings-proxy-narrow.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await modal.getByRole("tab", { name: /^Updates/ }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; window.__settingsQA.offerAppUpdate(); });
  await modal.getByRole("button", { name: "Update all", exact: true }).click();
  await modal.getByRole("button", { name: "Restart and update", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__settingsQA.calls.filter((call) => call.command === "browser_runtime_install_updates").length), 2, "bulk must not install the optional missing browser");
  assert.equal(await page.evaluate(() => window.__settingsQA.calls.some((call) => call.command === "app_install_update")), false, "bulk must not restart the app");
  await page.screenshot({ path: "e2e-out/settings-updates-light.png" });
  assert.deepEqual(errors, []);
  console.log("Settings journey passed: hide, cancel, retry, refresh, proxy navigation, preserved range, narrow layout, Update all and explicit restart.");
} catch (error) {
  if (page) {
    await mkdir("e2e-out", { recursive: true });
    await page.screenshot({ path: "e2e-out/settings-qa-failure.png" });
    console.error((await page.locator("body").innerText()).slice(0, 3500));
  }
  throw error;
} finally {
  await browser?.close();
  vite.kill();
}
