import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

// Real renderer and real clicks, with an isolated IPC host. Never download or
// install software, contact the backend, or read the person's app profile.
const port = process.env.SETTINGS_QA_PORT || "1423";
const url = "http://127.0.0.1:" + port;
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", port], { windowsHide: true, stdio: "ignore" });
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
    if (!localStorage.getItem("nextbrowser.theme")) localStorage.setItem("nextbrowser.theme", "dark");
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
  await page.locator(".sidebar-mini button > svg").first().waitFor();
  const railIcons = await page.locator(".sidebar-mini button > svg").evaluateAll((icons) => icons.map((icon) => {
    const glyph = icon.getBoundingClientRect();
    const button = icon.parentElement.getBoundingClientRect();
    return [glyph.width, glyph.height, button.width, button.height];
  }));
  assert.ok(railIcons.length >= 8);
  for (const sizes of railIcons) assert.deepEqual(sizes, [18, 18, 40, 40]);
  for (const [width, height] of [[1280, 900], [600, 760], [900, 480], [600, 480]]) {
    await page.setViewportSize({ width, height });
    const rail = await page.locator("#app-sidebar").boundingBox();
    const input = await page.locator(".chat-composer-dock .composer").boundingBox();
    const gap = rail.y + rail.height - input.y - input.height;
    assert.ok(Math.abs(gap) <= 1, `Rail and composer bottom edges differ by ${gap}px at ${width}×${height}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  const modal = page.getByRole("dialog", { name: "Settings", exact: true });
  await modal.getByRole("tab", { name: "General", exact: true }).click();
  assert.equal(await modal.getByRole("group", { name: "Theme", exact: true }).count(), 0);
  const themes = modal.getByRole("tab", { name: "Themes", exact: true });
  await themes.click();
  const theme = modal.getByRole("group", { name: "Theme", exact: true });
  const radio = (name) => theme.getByRole("radio", { name, exact: true });
  const waitForTheme = (name) => page.waitForFunction((next) => document.documentElement.dataset.theme === next, name);
  assert.equal(await radio("Dark").isChecked(), true);
  await mkdir("e2e-out", { recursive: true });
  await theme.screenshot({ path: "e2e-out/settings-theme-picker.png" });
  await page.screenshot({ path: "e2e-out/settings-themes.png" });
  await modal.getByLabel("App accent", { exact: true }).fill("#42bc89");
  await modal.getByLabel("Chat background", { exact: true }).fill("#182d24");
  await modal.getByLabel("Your messages", { exact: true }).fill("#f0e1c0");
  await modal.getByLabel("Agent messages", { exact: true }).fill("#20382e");
  await modal.getByRole("button", { name: "Dots", exact: true }).click();
  const corners = modal.getByRole("slider", { name: /Bubble corners/ });
  await corners.focus();
  await corners.press("Home");
  const preview = modal.getByRole("region", { name: "Dark chat preview" });
  assert.equal(await preview.locator(".msg-user-bubble").evaluate(el => getComputedStyle(el).color), "rgb(0, 0, 0)");
  assert.equal(await preview.locator(".assistant-bubble").evaluate(el => getComputedStyle(el).borderRadius), "4px");
  const shell = page.locator(".desktop-shell");
  const messages = page.locator(".chat .messages");
  assert.equal(await shell.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(24, 45, 36)");
  assert.equal(await shell.evaluate(el => getComputedStyle(el).backgroundSize), "14px 14px");
  assert.equal(await shell.evaluate(el => getComputedStyle(el).backgroundImage), await preview.evaluate(el => getComputedStyle(el).backgroundImage));
  assert.equal(await page.locator(".app-titlebar-name").evaluate(el => getComputedStyle(el).color), "rgb(255, 255, 255)");
  // All surfaces between the chat and the wallpaper must let the same image show through.
  const paintedLayers = await messages.evaluate(el => {
    const layers = [document.querySelector(".app-titlebar")];
    for (let layer = el; layer && !layer.matches(".desktop-shell"); layer = layer.parentElement) layers.push(layer);
    return layers.filter(layer => {
      const style = getComputedStyle(layer);
      return style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.backgroundImage !== "none";
    }).map(layer => layer.className);
  });
  assert.deepEqual(paintedLayers, []);
  const scrollbarColors = await messages.evaluate(el =>
    ["::-webkit-scrollbar", "::-webkit-scrollbar-track", "::-webkit-scrollbar-corner", "::-webkit-scrollbar-thumb"]
      .map(part => getComputedStyle(el, part).backgroundColor));
  assert.deepEqual(scrollbarColors.slice(0, 3), Array(3).fill("rgba(0, 0, 0, 0)"));
  assert.equal(scrollbarColors[3], "rgb(66, 188, 137)");
  const thumbColor = () => messages.evaluate(el => getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor);
  await modal.getByRole("button", { name: "Gradient", exact: true }).click();
  await modal.getByLabel("Gradient end").fill("#567abc");
  assert.ok(await shell.evaluate(el => getComputedStyle(el).backgroundImage.includes("rgb(86, 122, 188)")));
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.getContext("2d").fillRect(0, 0, 100, 75);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await modal.getByLabel("Wallpaper image").setInputFiles({ name: "wallpaper.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  await modal.getByRole("button", { name: "My photo", pressed: true }).waitFor();
  assert.ok(await shell.evaluate(el => getComputedStyle(el).backgroundImage.includes("data:image/jpeg;base64,")));
  await radio("Light").check();
  await waitForTheme("light");
  assert.equal(await modal.getByRole("button", { name: "Reset light appearance" }).isDisabled(), true);
  await modal.getByLabel("App accent", { exact: true }).fill("#ce674a");
  assert.equal(await thumbColor(), "rgb(206, 103, 74)");
  assert.ok(await shell.evaluate(el => !getComputedStyle(el).backgroundImage.includes("data:image")));
  await page.emulateMedia({ colorScheme: "dark" });
  await radio("System").check();
  await waitForTheme("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await waitForTheme("light");
  await page.reload();
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  await themes.click();
  assert.equal(await radio("System").isChecked(), true);
  assert.equal(await page.evaluate(() => window.__settingsQA.calls.some(({ command, args }) => command === "app_set_theme" && args.preference === "system" && args.theme === "light")), true);
  await modal.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await waitForTheme("dark");
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  await themes.click();
  assert.equal(await radio("Dark").isChecked(), true);
  await modal.getByRole("button", { name: "My photo", pressed: true }).waitFor();
  assert.equal(await modal.getByLabel("App accent", { exact: true }).inputValue(), "#42bc89");
  assert.equal(await thumbColor(), "rgb(66, 188, 137)");
  const picker = modal.getByRole("combobox", { name: "Saved theme", exact: true });
  const accent = modal.getByLabel("App accent", { exact: true });
  const saveName = modal.getByRole("button", { name: "Save", exact: true });
  const themeName = modal.getByRole("textbox", { name: "Theme name" });
  const choosePreset = async (name) => {
    await picker.click();
    await modal.getByRole("option", { name, exact: true }).click();
  };
  const saveAs = async (name) => {
    await choosePreset("+ Create theme…");
    await themeName.fill(name);
    await saveName.click();
  };
  await picker.press("End");
  await picker.press("Enter");
  assert.equal(await themeName.evaluate(el => el === document.activeElement), true);
  assert.equal(await picker.textContent(), "Default");
  await themeName.press("Escape");
  assert.equal(await picker.isEnabled(), true);
  await saveAs("Forest");
  assert.equal(await picker.textContent(), "Forest");
  await modal.getByRole("button", { name: "My photo", pressed: true }).waitFor();
  await accent.fill("#299877");
  await saveAs("Night");
  await accent.fill("#ab5080");
  await modal.getByRole("button", { name: "Rename theme" }).click();
  await themeName.fill(" forest ");
  assert.equal(await saveName.isDisabled(), true);
  await themeName.fill(" Night sky ");
  await themeName.press("Enter");
  assert.equal(await picker.textContent(), "Night sky");
  await radio("System").check();
  await waitForTheme("light");
  assert.equal(await accent.inputValue(), "#ce674a");
  await accent.fill("#dc8866");
  await page.reload();
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  await themes.click();
  assert.equal(await picker.textContent(), "Night sky");
  assert.equal(await accent.inputValue(), "#dc8866");
  await page.emulateMedia({ colorScheme: "dark" });
  await waitForTheme("dark");
  assert.equal(await accent.inputValue(), "#ab5080");
  await choosePreset("Forest");
  assert.equal(await accent.inputValue(), "#299877");
  await modal.getByRole("button", { name: "Delete theme" }).click();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await picker.textContent(), "Forest");
  await modal.getByRole("button", { name: "Delete theme" }).click();
  await modal.getByRole("button", { name: "Confirm delete" }).click();
  assert.equal(await picker.textContent(), "Default");
  assert.equal(await accent.inputValue(), "#42bc89");
  await modal.getByRole("button", { name: "My photo", pressed: true }).waitFor();
  // An existing personal theme with the same name must keep its appearance and identity.
  await page.evaluate(() => {
    const key = "nextbrowser.appearance.presets";
    const library = JSON.parse(localStorage.getItem(key));
    library.presets.push({ id: "qa-personal-hyellow", name: "hyellow" });
    localStorage.setItem(key, JSON.stringify(library));
    const prefix = "nextbrowser.appearance.preset.qa-personal-hyellow.";
    localStorage.setItem(prefix + "light", JSON.stringify({ accent: "#000000" }));
    localStorage.setItem(prefix + "dark", JSON.stringify({ accent: "#bb9f54", wallpaper: "gradient", gradientEnd: "#5d5128" }));
  });
  await page.reload();
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  await themes.click();
  await picker.click();
  const builtins = ["Blueprint", "Matcha", "Terracotta", "Afterglow", "hyellow"];
  assert.deepEqual(await modal.getByRole("option").allTextContents().then(names => names.map(name => name.trim())), ["Default", ...builtins, "Night sky", "hyellow · Personal", "+ Create theme…"]);
  for (const name of builtins) {
    await modal.getByRole("option", { name, exact: true }).click();
    assert.equal(await picker.textContent(), name);
    assert.equal(await modal.getByRole("button", { name: "Reset dark appearance" }).isDisabled(), true);
    for (const mode of ["Light", "Dark"]) {
      await radio(mode).check();
      const bubble = modal.getByRole("region", { name: mode + " chat preview" }).locator(".msg-user-bubble");
      const miniature = radio(mode).locator("xpath=ancestor::label").locator(".settings-theme-sample");
      assert.equal(await miniature.evaluate(el => getComputedStyle(el, "::after").backgroundColor),
        await bubble.evaluate(el => getComputedStyle(el).backgroundColor));
    }
    await picker.click();
  }
  await modal.getByRole("option", { name: "hyellow", exact: true }).click();
  for (const mode of ["Light", "Dark"]) {
    await radio(mode).check();
    assert.equal(await accent.inputValue(), mode === "Light" ? "#000000" : "#bb9f54");
    const region = modal.getByRole("region", { name: mode + " chat preview" });
    const sample = () => region.evaluate(async el => {
      await Promise.allSettled(document.getAnimations()
        .filter(animation => animation instanceof CSSTransition)
        .map(animation => animation.finished));
      const styles = [el, el.querySelector(".msg-user-bubble"), el.querySelector(".assistant-bubble")];
      return styles.map(node => {
        const { backgroundColor, backgroundImage, borderRadius, color } = getComputedStyle(node);
        return [backgroundColor, backgroundImage, borderRadius, color];
      });
    });
    const bundled = await sample();
    assert.notEqual(await picker.locator(".theme-preset-swatch").evaluate(el => getComputedStyle(el).backgroundImage), "none");
    await choosePreset("hyellow · Personal");
    assert.deepEqual(await sample(), bundled);
    await choosePreset("hyellow");
  }
  await picker.click();
  await modal.getByRole("option", { name: "Matcha", exact: true }).click();
  const matchaAccent = await accent.inputValue();
  await accent.fill("#8040dd");
  await page.reload();
  await page.getByRole("button", { name: /^Settings(?:,|$)/ }).click();
  await themes.click();
  assert.equal(await picker.textContent(), "Matcha");
  assert.equal(await accent.inputValue(), "#8040dd");
  await saveAs("Personal matcha");
  await choosePreset("Matcha");
  await modal.getByRole("button", { name: "Reset dark appearance" }).click();
  assert.equal(await accent.inputValue(), matchaAccent);
  await choosePreset("Personal matcha");
  assert.equal(await accent.inputValue(), "#8040dd");
  assert.equal(await modal.getByRole("button", { name: "Gradient", pressed: true }).count(), 1);
  await choosePreset("Afterglow");
  await picker.click();
  await modal.screenshot({ path: "e2e-out/settings-builtin-presets.png" });
  await modal.getByRole("option", { name: "Default", exact: true }).click();
  await modal.getByRole("button", { name: "Reset dark appearance" }).click();
  assert.equal(await corners.inputValue(), "20");
  assert.equal(await modal.getByRole("button", { name: "Glow", pressed: true }).count(), 1);
  assert.ok(await shell.evaluate(el => !getComputedStyle(el).backgroundImage.includes("data:image")));
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
  console.log("Settings journey passed: rail sizing, named theme creation, editing, switching, deletion, reload, system appearance, updates and proxy navigation.");
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
