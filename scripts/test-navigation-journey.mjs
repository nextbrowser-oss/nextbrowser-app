import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

// Actual renderer clicks; isolated preview state and IPC. No personal profile,
// credentials, sign-in, software installation or external requests are used.
const url = "http://127.0.0.1:1424";
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1424"], { windowsHide: true, stdio: "ignore" });
let browser;
let page;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt >= 100) throw new Error("Navigation QA server did not start.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (process.platform === "win32" ? path.join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe") : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome"), headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("nextbrowser.theme", "light");
    window.__navigationQA = { calls: [] };
    window.nextbrowser = {
      on() { return () => {}; },
      async invoke(command, args = {}) {
        window.__navigationQA.calls.push({ command, args });
        if (command === "nextctl_version") return "1.2.39";
        if (command === "nextctl_supports_skill") return true;
        if (command === "browser_runtime_update_status") return { status: "ready", checkedAt: Date.now(), runtimes: [] };
        if (command === "browser_runtime_install_status" || command === "browser_runtime_update_install_status") return { status: "idle" };
        if (command === "app_update_status") return { status: "not-available" };
        if (command === "app_platform") return { platform: "win32", arch: "x64" };
        if (command === "error_reporting_status") return { enabled: false, available: false };
        if (command === "github_stars") return 64;
        if (command === "github_star_status") return { eligible: false };
        if (command === "dashboard_auth_status") return { authed: true };
        if (command === "manual_proxies_list" || command === "browser_runtime_clawbrowser_active_sessions") return [];
        if (command === "multilogin_login_complete") return { connected: true, valid: true, secureStorageAvailable: true, account: { email: "qa@example.com", workspaceName: "QA workspace" }, browserProfiles: [], mobileProfiles: [] };
        return {};
      },
    };
  });
  await page.goto(`${url}/?preview=main`);
  const chrome = page.getByRole("banner", { name: "Application toolbar" });
  const community = chrome.getByRole("button", { name: "Join Nextbrowser on Discord" });
  await community.waitFor();
  assert.equal(await page.getByRole("button", { name: "Join Nextbrowser on Discord" }).count(), 1);
  assert.equal(await chrome.getByRole("button", { name: "Star Nextbrowser on GitHub" }).count(), 1);
  await mkdir("e2e-out", { recursive: true });
  for (const theme of ["light", "dark"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await chrome.getByRole("button", { name: /Switch to .* theme/ }).click();
    }
    for (const [tone, claimed, revoked] of [["missing", false, false], ["verified", true, false], ["missing", false, true], ["unknown", null, false]]) {
      await page.evaluate(async ({ claimed, revoked }) => {
        const { useStore } = await import("/src/store.ts");
        useStore.setState({ githubStar: claimed === null ? null : { required: !claimed, claimed, revoked, repoUrl: "https://github.com/nextbrowser-oss/nextbrowser-app", rewardBytes: 1e9 }, githubStarPromptOpen: false });
        // Let the existing once-per-launch reward prompt run, then dismiss it
        // in this isolated fixture so it does not cover the header under test.
        await new Promise(requestAnimationFrame);
        useStore.setState({ githubStarPromptOpen: false });
      }, { claimed, revoked });
      await page.waitForFunction(tone => document.querySelector(`.community-discord--${tone}`), tone);
      const style = await community.evaluate((node, tone) => {
        const s = getComputedStyle(node);
        const probe = document.createElement("span");
        probe.style.color = `var(${tone === "verified" ? "--green" : tone === "missing" ? "--red" : "--muted"})`;
        document.body.append(probe);
        const expected = getComputedStyle(probe).color; probe.remove();
        return { color: s.color, expected, border: s.borderTopWidth, shadow: s.boxShadow, background: s.backgroundColor };
      }, tone);
      assert.equal(style.color, style.expected);
      assert.equal(style.border, "0px");
      assert.equal(style.shadow, "none");
      if (tone !== "unknown") assert.notEqual(style.background, "rgba(0, 0, 0, 0)");
      await community.hover();
      const hint = page.getByRole("tooltip");
      await hint.waitFor();
      assert.match(await hint.innerText(), tone === "verified" ? /star verified/ : tone === "missing" ? /star is not verified/ : /verify your star/);
      const hintBox = await hint.boundingBox();
      assert.ok(hintBox.y >= 0 && hintBox.x >= 0 && hintBox.x + hintBox.width <= 1280);
      if (!revoked && tone !== "unknown") await page.screenshot({ path: `e2e-out/community-${theme}-${tone}.png` });
      await page.mouse.move(20, 100);
      await hint.waitFor({ state: "hidden" });
    }
  }
  for (const width of [1280, 540, 420, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await chrome.getByRole("button").evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(), s = getComputedStyle(node);
      return { left: b.left, right: b.right, bottom: b.bottom, border: s.borderTopWidth, drag: s.getPropertyValue("app-region") };
    }));
    for (const b of boxes) {
      assert.ok(b.left >= 0 && b.right <= width - 148 && b.bottom <= 40, JSON.stringify({ width, b }));
      assert.equal(b.border, "0px");
      assert.equal(b.drag, "no-drag");
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await chrome.getByRole("button", { name: "Switch to light theme" }).click();
  let mainViews = page.getByRole('tablist', { name: 'Main views' });
  const projectName = page.locator('.chat-project-switcher');
  const titleBounds = await projectName.boundingBox();
  const viewBounds = await mainViews.boundingBox();
  assert.ok(viewBounds.x >= titleBounds.x + titleBounds.width, 'minimal main navigation sits after the project name');
  assert.ok(Math.abs(viewBounds.y - titleBounds.y) <= 2);
  assert.equal(await page.locator('.content-chat > .tabbar').count(), 0, 'no separate navigation row above the chat');
  await mainViews.getByRole('tab', { name: 'Open Live', exact: true }).click();
  await page.getByRole('tablist', { name: 'Main views' }).getByRole('tab', { name: 'Open Project', exact: true }).click();
  await projectName.click();
  const projectPopover = page.getByRole('dialog', { name: 'Recent projects' });
  await projectPopover.waitFor();
  const side = await page.locator('#app-sidebar').boundingBox();
  assert.ok((await projectPopover.boundingBox()).x >= side.x + side.width, 'project popup stays beyond the left navigation');
  assert.ok((await projectPopover.boundingBox()).width <= 240);
  await page.keyboard.press('Escape');
  const nav = page.getByRole("navigation", { name: "Sidebar pages" });
  const skillsButton = () => nav.getByRole("button", { name: /^Open Skills/ });
  await skillsButton().click();
  const expandedY = (await skillsButton().boundingBox()).y;
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Expand sidebar", exact: true }).evaluate(node => !!node.closest(".app-titlebar")), true);
  assert.equal(await page.locator(".sidebar-mini").getByRole("button", { name: /^Agent:/ }).count(), 0);
  assert.equal(await nav.getByRole("button").count(), 5);
  assert.equal(await nav.locator("svg").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).strokeWidth === "1.5px")), true);
  assert.equal(await page.locator(".sidebar-mini").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  const collapsedY = (await skillsButton().boundingBox()).y;
  assert.ok(Math.abs(expandedY - collapsedY) < 1, `Navigation moved: ${expandedY} → ${collapsedY}`);
  assert.equal(await skillsButton().innerText().then((text) => text.includes("Skills")), true);
  await nav.getByRole("button", { name: /^Open Guide/ }).click();
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1, "navigation clicks must not expand the sidebar");
  await skillsButton().click();
  const tabs = page.getByRole("tablist", { name: "Skills sections" });
  await tabs.getByRole("tab", { name: "My skills", exact: true }).click();
  await page.getByRole("tabpanel").getByRole("heading", { name: "My skills", exact: true }).waitFor();
  await tabs.getByRole("tab", { name: "My skills", exact: true }).press("End");
  assert.equal(await tabs.getByRole("tab", { name: "Scripts", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tabpanel").getByRole("heading", { name: "Scripts", exact: true }).waitFor();
  await tabs.getByRole("tab", { name: "Scripts", exact: true }).press("Home");
  assert.equal(await tabs.getByRole("tab", { name: "All skills", exact: true }).getAttribute("aria-selected"), "true");
  await mkdir("e2e-out", { recursive: true });
  await page.screenshot({ path: "e2e-out/navigation-skills-light.png" });
  const rail = await page.locator(".sidebar-mini").boundingBox();
  await page.mouse.click(rail.x + rail.width / 2, rail.y + rail.height - 130);
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1, "blank rail space is no longer an expand trigger");
  await page.locator(".sidebar-mini").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).waitFor();
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(await page.locator(".skills-root").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await tabs.getByRole("tab", { name: "All skills", exact: true }).press("End");
  assert.equal(await tabs.getByRole("tab", { name: "Scripts", exact: true }).evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForTimeout(350); // Let the theme transition settle before visual QA.
  await page.screenshot({ path: "e2e-out/navigation-skills-narrow-dark.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await nav.getByRole("button", { name: /^Open Connectors/ }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const modal = page.getByRole("dialog", { name: /Multilogin/ });
  await modal.getByText("wails", { exact: true }).waitFor();
  await modal.getByText("Session storage", { exact: true }).waitFor();
  await modal.getByRole("tab", { name: "Web", exact: true }).click();
  await modal.getByText("https://app.multilogin.com", { exact: true }).first().waitFor();
  await modal.getByRole("button", { name: "Open Multilogin sign-in", exact: true }).click();
  await modal.getByRole("button", { name: "Connect selected workspace", exact: true }).waitFor();
  await page.screenshot({ path: "e2e-out/navigation-multilogin-connect.png" });
  await modal.getByRole("button", { name: "Connect selected workspace", exact: true }).click();
  await modal.getByText("qa@example.com", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__navigationQA.calls.filter((call) => call.command.startsWith("multilogin_login_")).map((call) => call.command).slice(-2)), ["multilogin_login_open", "multilogin_login_complete"]);
  assert.deepEqual(errors, []);
  console.log("Navigation journey passed: titlebar toggle, five monoline destinations, footer Settings, stable sidebar positions, no horizontal overflow, keyboard navigation, narrow layout, themes and Multilogin connection.");
} catch (error) {
  if (page) {
    await mkdir("e2e-out", { recursive: true });
    await page.screenshot({ path: "e2e-out/navigation-qa-failure.png" });
    console.error((await page.locator("body").innerText()).slice(-6000));
  }
  throw error;
} finally { await browser?.close(); vite.kill(); }
