// Isolated Electron/production-renderer test. Never load a personal profile or make external requests.
const { app, BrowserWindow, ipcMain } = require("electron");
const { windowChromeOptions, applyWindowChrome, applyWindowZoom, windowState, controlWindow, watchWindowState } = require("../electron/window-chrome.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const output = path.resolve("e2e-out/window-chrome");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, `profile-${process.pid}`));
// Keep the harness alive long enough to assert the final Close action and save its result.
app.on("window-all-closed", () => {});
ipcMain.on("nextbrowser:settings-read", event => { event.returnValue = {}; });
ipcMain.on("nextbrowser:settings-update", () => {});
ipcMain.handle("nextbrowser:invoke", (event, command, args = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (command === "app_window_state") return windowState(owner);
  if (command === "app_window_control") return controlWindow(owner, args.action);
  if (command === "app_set_theme") return applyWindowChrome(owner, { ...args, factor: event.sender.getZoomFactor() }, process.platform);
  if (command === "app_set_zoom_factor") { event.sender.setZoomFactor(args.factor); applyWindowZoom(owner, args.factor, process.platform); return null; }
  if (command === "browser_runtime_update_status") return { status: "ready", runtimes: [] };
  if (command === "browser_runtime_install_status" || command === "browser_runtime_update_install_status") return { status: "idle" };
  if (command === "app_update_status") return { status: "not-available" };
  if (command === "error_reporting_status") return { enabled: false, available: false };
  if (command === "github_stars") return 64;
  if (command === "github_star_status") return { eligible: false };
  if (command === "manual_proxies_list") return [];
  return {};
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (check, label) => { for (let attempt = 0; attempt < 60; attempt++) { if (await check()) return; await pause(50); } throw new Error(`Timed out: ${label}`); };
const resultFile = path.join(output, "custom-caption-result.json");
fs.writeFileSync(resultFile, JSON.stringify({ status: "running", pid: process.pid }));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, title: "Nextbrowser chrome QA", width: 1180, height: 760,
    ...windowChromeOptions(process.platform), webPreferences: { preload: path.resolve("electron/preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      additionalArguments: process.platform === "darwin" ? [] : ["--nextbrowser-custom-caption"] } });
  watchWindowState(window);
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith("file:") && !details.url.startsWith("data:") && !details.url.startsWith("devtools:") }));
  await window.loadFile(path.resolve("dist/index.html"), { query: { preview: "main", tab: "skills" } });
  window.showInactive();
  await pause(800);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.sidebar-collapsed')`), true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.app-titlebar [aria-controls="app-sidebar"]').length`), 0);
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('.theme-toggle').click()`);
    await pause(250);
    for (const factor of [0.75, 1, 1.5]) {
      window.webContents.setZoomFactor(factor);
      applyWindowZoom(window, factor, process.platform);
      await pause(100);
      const info = await window.webContents.executeJavaScript(`(() => {
        const header=document.querySelector('.app-titlebar'), button=header.querySelector('.app-titlebar-logo'), rect=button.getBoundingClientRect();
        const overlay=navigator.windowControlsOverlay;
        const actions=header.querySelector('.app-titlebar-actions'), actionRect=actions.getBoundingClientRect(), controls=header.querySelector('.shared-window-controls'), controlRect=controls?.getBoundingClientRect();
        return { headerHeight:header.getBoundingClientRect().height, buttonBottom:rect.bottom, native:overlay?.visible, drag:getComputedStyle(header).getPropertyValue('app-region'), controlDrag:getComputedStyle(button).getPropertyValue('app-region'), actionsRight:actionRect.right, actionsBottom:actionRect.bottom, actionsCount:actions.querySelectorAll('button').length, actionsSafe:[...header.querySelectorAll('button')].every(b=>getComputedStyle(b).getPropertyValue('app-region')==='no-drag'&&getComputedStyle(b).borderTopWidth==='0px'), caption:controlRect?.toJSON(), captionCount:controls?.querySelectorAll('button').length, viewport:innerWidth };
      })()`);
      assert.ok(Math.abs(info.headerHeight - 40) < 0.1);
      assert.ok(info.buttonBottom <= info.headerHeight);
      assert.equal(info.drag, "drag");
      assert.equal(info.controlDrag, "no-drag");
      assert.equal(info.actionsCount, 3);
      assert.equal(info.actionsSafe, true);
      assert.ok(info.actionsBottom <= info.headerHeight);
      if (process.platform !== "darwin") {
        assert.equal(info.native, false, "No native buttons may sit above modal blur");
        assert.equal(info.captionCount, 3);
        assert.ok(info.actionsRight <= info.caption.x && info.caption.right <= info.viewport && info.caption.bottom <= 40, JSON.stringify({ factor, info }));
      }
    }
    window.webContents.setZoomFactor(1);
    applyWindowZoom(window, 1, process.platform);
    await pause(100);
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    fs.writeFileSync(path.join(output, `${theme}.png`), image.toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-mini [aria-label="Settings"]').click()`);
    await pause(150);
    assert.equal(await window.webContents.executeJavaScript(`(() => { const overlay=document.querySelector('.settings-overlay'), controls=document.querySelector('.shared-window-controls'); if (!overlay || !controls) return false; const r=controls.getBoundingClientRect(); return getComputedStyle(overlay).backdropFilter.includes('blur(') && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===overlay; })()`), process.platform !== "darwin");
    fs.writeFileSync(path.join(output, `modal-${theme}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="Close settings"]').click()`);
  }
  if (process.platform !== "darwin") {
    window.showInactive();
    const click = label => window.webContents.executeJavaScript(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`);
    await click("Maximize window");
    await waitFor(() => window.isMaximized(), "maximize");
    await waitFor(() => window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Restore window"]')`), "restore label");
    await click("Restore window");
    await waitFor(() => !window.isMaximized(), "restore");
    // OS-side changes (e.g. titlebar double click) must update the renderer too.
    window.maximize();
    await waitFor(() => window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Restore window"]')`), "OS maximize event");
    window.unmaximize();
    await waitFor(() => window.webContents.executeJavaScript(`!!document.querySelector('[aria-label="Maximize window"]')`), "OS restore event");
    await click("Minimize window");
    await waitFor(() => window.isMinimized(), "minimize");
    window.restore();
    await waitFor(() => !window.isMinimized(), "restore minimized");
    await click("Close window").catch(error => { if (!window.isDestroyed()) throw error; });
    await waitFor(() => window.isDestroyed(), "close");
  }
  fs.writeFileSync(resultFile, JSON.stringify({ status: "passed", checks: "caption actions, OS state events, modal blur/hit testing, 75–150% scale, both themes, drag regions" }));
  console.log("Custom window chrome passed: production renderer, caption actions/state, modal blur, drag/no-drag regions, 75–150% scale and both themes.");
  app.exit(0);
}).catch(error => { fs.writeFileSync(resultFile, JSON.stringify({ status: "failed", error: error.stack })); console.error(error.stack); app.exit(1); });
