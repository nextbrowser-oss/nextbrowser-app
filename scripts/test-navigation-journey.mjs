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
      customWindowControls: true,
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
      assert.ok(b.left >= 0 && b.right <= width - 8 && b.bottom <= 40, JSON.stringify({ width, b }));
      assert.equal(b.border, "0px");
      assert.equal(b.drag, "no-drag");
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await chrome.getByRole("button", { name: "Switch to light theme" }).click();
  let mainViews = page.getByRole('tablist', { name: 'Main views' });
  const projectName = page.locator('.chat-project-title');
  const titleBounds = await projectName.boundingBox();
  const viewBounds = await mainViews.boundingBox();
  assert.ok(viewBounds.x >= titleBounds.x + titleBounds.width, 'minimal main navigation sits after the project name');
  assert.ok(Math.abs(viewBounds.y - titleBounds.y) <= 2);
  assert.equal(await page.locator('.content-chat > .tabbar').count(), 0, 'no separate navigation row above the chat');
  await mainViews.getByRole('tab', { name: 'Open Live', exact: true }).click();
  await page.getByRole('tablist', { name: 'Main views' }).getByRole('tab', { name: 'Open Project', exact: true }).click();
  await page.getByRole("button", { name: "Open Projects", exact: true }).click();
  const projectPopover = page.getByRole('dialog', { name: 'Projects' });
  await projectPopover.waitFor();
  const side = await page.locator('#app-sidebar').boundingBox();
  assert.ok((await projectPopover.boundingBox()).x >= side.x + side.width, 'project popup stays beyond the left navigation');
  assert.ok((await projectPopover.boundingBox()).width <= 280);
  const original = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts');
    const state = useStore.getState(), project = state.activeConversation();
    return { id: project.id, title: project.title, messages: project.messages, workspaceId: state.activeWorkspaceId };
  });
  await projectPopover.getByRole('button', { name: `New session in ${original.title}`, exact: true }).click();
  await projectPopover.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(async ({ id, messages }) => {
    const { useStore } = await import('/src/store.ts'); const state = useStore.getState();
    return state.activeConversation().projectId === id && state.activeConversation().messages.length === 0 && JSON.stringify(state.conversations.find(item => item.id === id).messages) === JSON.stringify(messages);
  }, original), true, 'new sessions preserve the original project history');
  await page.getByRole('button', { name: 'Open Projects', exact: true }).click();
  await projectPopover.getByRole('button', { name: `Collapse project ${original.title}`, exact: true }).click();
  assert.equal(await projectPopover.getByRole('group', { name: `Sessions in ${original.title}`, exact: true }).count(), 0);
  await projectPopover.getByRole('button', { name: `Expand project ${original.title}`, exact: true }).click();
  await page.screenshot({ path: 'e2e-out/project-folders-light.png' });
  await projectPopover.getByRole('button', { name: `Open Main session in ${original.title}`, exact: true }).click();
  await page.getByRole('button', { name: /^Switch workspace,/ }).click();
  const workspacePopover = page.getByRole('dialog', { name: 'Workspaces', exact: true });
  await workspacePopover.waitFor();
  assert.ok((await workspacePopover.boundingBox()).y >= 30);
  await workspacePopover.getByRole('button', { name: 'Create workspace', exact: true }).click();
  const workspaceCreate = page.getByRole('dialog', { name: 'Create workspace', exact: true });
  await workspaceCreate.waitFor();
  await workspaceCreate.getByRole('button', { name: 'Cancel', exact: true }).click();
  const workspaceBefore = await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts'); const state = useStore.getState(), current = state.workspaces.find(item => item.id === state.activeWorkspaceId);
    const project = state.conversations.find(item => item.id === state.activeConvId[state.agentId]);
    useStore.setState({ workspaces: [...state.workspaces, { ...current, id: 'qa-second-workspace', name: 'Other QA workspace' }],
      conversations: [...state.conversations, { ...project, id: 'qa-second-project', title: 'Other workspace project', workspaceId: 'qa-second-workspace', projectId: undefined, messages: [] }] });
    return { id: current.id, name: current.name };
  });
  await page.getByRole('button', { name: /^Switch workspace,/ }).click();
  await workspacePopover.getByRole('button', { name: 'Other QA workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Switch workspace, Other QA workspace', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open Projects', exact: true }).click();
  await projectPopover.getByRole('button', { name: 'Expand project Other workspace project', exact: true }).count().then(async count => {
    if (count) await projectPopover.getByRole('button', { name: 'Expand project Other workspace project', exact: true }).click();
  });
  assert.equal(await projectPopover.getByRole('button', { name: `Open Main session in ${original.title}`, exact: true }).count(), 0, 'project listings stay scoped to the selected workspace');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Switch workspace,/ }).click();
  await workspacePopover.getByRole('button', { name: workspaceBefore.name, exact: true }).click();
  await page.getByRole('button', { name: 'Open Projects', exact: true }).click();
  await page.keyboard.press('Escape');
  const nav = page.getByRole("navigation", { name: "Sidebar pages" });
  const extensionsButton = () => nav.getByRole('button', { name: 'Open Extensions', exact: true });
  const openExtension = async name => {
    await extensionsButton().click();
    await page.getByRole('dialog', { name: 'Extensions', exact: true }).getByRole('button', { name: new RegExp(`^Open ${name}`) }).click();
  };
  const checkSidebarSurface = async () => {
    const surface = await page.locator('#app-sidebar').evaluate(node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      const container = node.closest('.desktop-shell-body').getBoundingClientRect();
      const icon = node.querySelector('.sidebar-destination svg');
      return { left: rect.left, top: rect.top - container.top, bottom: container.bottom - rect.bottom,
        radius: style.borderTopLeftRadius, blur: style.backdropFilter, bg: style.backgroundColor,
        text: style.color, icon: getComputedStyle(icon).color, overflow: node.scrollWidth > node.clientWidth };
    });
    assert.ok(surface.left >= 8 && surface.top >= 8 && surface.bottom >= 8, JSON.stringify(surface));
    assert.equal(surface.radius, '18px');
    assert.ok(surface.blur.includes('blur(18px)'));
    assert.match(surface.bg, /^rgba\(/);
    assert.equal(surface.icon, surface.text, 'navigation icons use the glass foreground');
    assert.equal(surface.overflow, false);
  };
  await checkSidebarSurface();
  await page.screenshot({ path: 'e2e-out/sidebar-glass-expanded-light.png' });
  await page.evaluate(async () => {
    const { useStore } = await import('/src/store.ts');
    useStore.setState(state => ({ runtime: { ...state.runtime, claude: { ...state.runtime.claude, ready: true, loggedIn: true } } }));
  });
  const draft = page.locator('.composer textarea');
  await draft.fill('Keep this unsent draft while opening utilities');
  await nav.getByRole('button', { name: /^Open Scheduled/ }).click();
  const scheduleDialog = page.getByRole('dialog', { name: 'Schedule', exact: true });
  await scheduleDialog.waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().tab), 'chat');
  await scheduleDialog.getByRole('button', { name: 'New schedule', exact: true }).click();
  const editorDialog = page.getByRole('dialog', { name: 'New scheduled run', exact: true });
  await editorDialog.waitFor();
  const editorBounds = await editorDialog.boundingBox();
  assert.ok(editorBounds.x >= 0 && editorBounds.y >= 0 && editorBounds.y + editorBounds.height <= 900);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    await page.waitForTimeout(250);
    const contrastResults = await editorDialog.evaluate(editor => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const over = (color, base) => color.slice(0, 3).map((v, i) => v * color[3] / 255 + base[i] * (1 - color[3] / 255));
      const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
      const base = rgba(getComputedStyle(editor).backgroundColor);
      const checks = [...editor.querySelectorAll('h3, p, label, .field-label, input, textarea, select, .weekday-btn, .preset-row button, .secondary')].map(node => {
        const style = getComputedStyle(node), background = over(rgba(style.backgroundColor), base);
        return { element: node.tagName + ':' + (node.textContent || node.getAttribute('placeholder') || node.getAttribute('type') || '').slice(0, 45), ratio: contrast(over(rgba(style.color), background), background) };
      });
      for (const node of editor.querySelectorAll('input[placeholder], textarea[placeholder]')) {
        const style = getComputedStyle(node), placeholder = getComputedStyle(node, '::placeholder'), background = over(rgba(style.backgroundColor), base);
        checks.push({ element: 'placeholder:' + node.getAttribute('placeholder'), ratio: contrast(over(rgba(placeholder.color), background), background) });
      }
      return { background: base, colorScheme: getComputedStyle(editor).colorScheme, checks };
    });
    assert.ok(contrastResults.background[3] >= 240 && contrastResults.background.slice(0, 3).every(c => theme === 'light' ? c > 220 : c < 110), `nested schedule follows ${theme} theme: ${JSON.stringify(contrastResults)}`);
    assert.equal(contrastResults.colorScheme, theme);
    assert.equal(await scheduleDialog.evaluate(node => getComputedStyle(node).backgroundColor), await editorDialog.evaluate(node => getComputedStyle(node).backgroundColor));
    for (const check of contrastResults.checks) assert.ok(check.ratio >= 4.5, `${theme} schedule contrast: ${JSON.stringify(check)}`);
    await page.screenshot({ path: `e2e-out/schedule-editor-${theme}.png` });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light'; });
  await page.keyboard.press('Escape');
  await editorDialog.waitFor({ state: 'detached' });
  assert.equal(await scheduleDialog.isVisible(), true);
  await page.screenshot({ path: 'e2e-out/schedule-modal-light.png' });
  await page.keyboard.press('Escape');
  await scheduleDialog.waitFor({ state: 'detached' });
  assert.equal(await draft.inputValue(), 'Keep this unsent draft while opening utilities');
  await draft.fill('');
  await openExtension('Skills');
  assert.equal(await page.getByRole('button', { name: /^(Expand|Collapse) sidebar$/ }).count(), 0);
  assert.equal(await page.locator('#sidebar-resize').count(), 0);
  assert.equal(await page.locator('.sidebar-collapsed').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Open Projects', exact: true }).isVisible(), true, 'projects stay available on Skills');
  assert.equal(await nav.getByRole('button').count(), 4);
  await checkSidebarSurface();
  assert.equal(await extensionsButton().innerText(), 'Extensions');
  await extensionsButton().hover();
  const extensionsPopup = page.getByRole('dialog', { name: 'Extensions', exact: true });
  await extensionsPopup.waitFor();
  const triggerBox = await extensionsButton().boundingBox(), flyoutBox = await extensionsPopup.boundingBox();
  assert.ok(flyoutBox.x > triggerBox.x + triggerBox.width, 'flyout sits to the right of the group');
  assert.ok(Math.abs(flyoutBox.y - triggerBox.y) <= 1, 'flyout aligns with the group top');
  assert.ok(flyoutBox.width <= 180);
  const rows = await extensionsPopup.getByRole('button').all();
  assert.equal(rows.length, 3);
  const rowBoxes = await Promise.all(rows.map(row => row.boundingBox()));
  assert.ok(rowBoxes[0].y < rowBoxes[1].y && rowBoxes[1].y < rowBoxes[2].y, 'extensions form one vertical column');
  await extensionsPopup.getByRole('button', { name: /^Open MCP/ }).hover();
  await page.waitForTimeout(250);
  assert.equal(await extensionsPopup.isVisible(), true, 'crossing the gap preserves the flyout');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    await page.waitForTimeout(250);
    const foregrounds = await extensionsPopup.getByRole('button').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
    assert.ok(foregrounds.every(color => color === foregrounds[0]), `active, hovered and normal actions share the glass foreground: ${foregrounds}`);
    assert.equal(foregrounds[0], await extensionsPopup.evaluate(node => getComputedStyle(node).color));
    await page.screenshot({ path: `e2e-out/extensions-rail-${theme}.png` });
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light'; });
  await extensionsPopup.getByRole('button', { name: /^Open MCP/ }).click();
  const mcpDialog = page.getByRole('dialog', { name: 'MCP', exact: true });
  await mcpDialog.waitFor();
  await mcpDialog.getByText('stdio', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().tab), 'skills');
  await mcpDialog.getByRole('button', { name: 'Agent settings', exact: true }).click();
  const agentSettings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await agentSettings.waitFor();
  await agentSettings.getByRole('button', { name: 'Close settings', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'MCP', exact: true }).count(), 0);
  await nav.getByRole("button", { name: /^Open Guide/ }).click();
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1, "navigation clicks must not expand the sidebar");
  await openExtension('Skills');
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
  await page.getByRole('button', { name: 'Manage profiles and proxies', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Profiles and proxies', exact: true });
  await tools.waitFor();
  await tools.getByRole('button', { name: 'Close Profiles and proxies' }).click();
  await tools.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 960, height: 640 });
  assert.equal(await page.locator(".skills-root").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await tabs.getByRole("tab", { name: "All skills", exact: true }).press("End");
  assert.equal(await tabs.getByRole("tab", { name: "Scripts", exact: true }).evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.waitForTimeout(350); // Let the theme transition settle before visual QA.
  await checkSidebarSurface();
  await page.screenshot({ path: "e2e-out/navigation-skills-narrow-dark.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openExtension('Connectors');
  const connectorsDialog = page.getByRole('dialog', { name: 'Connectors', exact: true });
  await connectorsDialog.waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
    await page.waitForTimeout(250);
    const colors = await connectorsDialog.evaluate(node => {
      const style = getComputedStyle(node);
      return { bg: style.backgroundColor, text: style.color, scheme: style.colorScheme, heading: getComputedStyle(node.querySelector('h2')).color };
    });
    assert.equal(colors.bg, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(52, 62, 76)');
    assert.equal(colors.text, theme === 'light' ? 'rgb(26, 28, 28)' : 'rgb(244, 246, 251)');
    assert.equal(colors.heading, colors.text);
    assert.equal(colors.scheme, theme);
    await page.screenshot({ path: `e2e-out/connectors-modal-${theme}.png` });
  }
  assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().tab), 'skills');
  await connectorsDialog.getByRole("button", { name: "Connect", exact: true }).click();
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
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  assert.equal(await connectorsDialog.isVisible(), true);
  await connectorsDialog.getByRole('button', { name: 'Close Connectors' }).click();
  await connectorsDialog.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(async () => (await import('/src/store.ts')).useStore.getState().tab), 'skills');
  assert.deepEqual(errors, []);
  console.log("Navigation journey passed: permanent rail, project folders/independent sessions, global project access, titlebar workspace switch/create, Extensions/MCP, profile management, themes, narrow layout and Multilogin connection.");
} catch (error) {
  if (page) {
    await mkdir("e2e-out", { recursive: true });
    await page.screenshot({ path: "e2e-out/navigation-qa-failure.png" });
    console.error((await page.locator("body").innerText()).slice(-6000));
  }
  throw error;
} finally { await browser?.close(); vite.kill(); }
