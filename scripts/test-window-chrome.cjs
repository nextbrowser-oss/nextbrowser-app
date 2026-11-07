// Isolated Electron/production-renderer test. Never load a personal profile or make external requests.
const { app, BrowserWindow, ipcMain } = require("electron");
const { windowChromeOptions, applyWindowChrome, applyWindowZoom } = require("../electron/window-chrome.cjs");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const output = path.resolve("e2e-out/window-chrome");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, `profile-${process.pid}`));
ipcMain.on("nextbrowser:settings-read", event => { event.returnValue = {}; });
ipcMain.on("nextbrowser:settings-update", () => {});
ipcMain.handle("nextbrowser:invoke", (event, command, args = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
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
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, title: "Nextbrowser chrome QA", width: 1180, height: 760,
    ...windowChromeOptions(process.platform), webPreferences: { preload: path.resolve("electron/preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith("file:") && !details.url.startsWith("data:") && !details.url.startsWith("devtools:") }));
  await window.loadFile(path.resolve("dist/index.html"), { query: { preview: "main", tab: "skills" } });
  await pause(800);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.app-titlebar button:not(:disabled)')`), true);
  await window.webContents.executeJavaScript(`document.querySelector('.app-titlebar button').click()`);
  await pause(100);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('.sidebar-collapsed')`), true);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.sidebar-mini .sidebar-settings-button').length`), 1);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.sidebar-mini [aria-label="Expand sidebar"], .sidebar-mini [aria-label^="Agent:"]').length`), 0);
  for (const theme of ["light", "dark"]) {
    await window.webContents.executeJavaScript(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('.theme-toggle').click()`);
    await pause(250);
    for (const factor of [0.75, 1, 1.5]) {
      window.webContents.setZoomFactor(factor);
      applyWindowZoom(window, factor, process.platform);
      await pause(100);
      const info = await window.webContents.executeJavaScript(`(() => {
        const header=document.querySelector('.app-titlebar'), button=header.querySelector('button'), rect=button.getBoundingClientRect();
        const overlay=navigator.windowControlsOverlay;
        const actions=header.querySelector('.app-titlebar-actions'), actionRect=actions.getBoundingClientRect();
        return { headerHeight:header.getBoundingClientRect().height, buttonBottom:rect.bottom, buttonRight:rect.right, native:overlay?.visible, area:overlay?.getTitlebarAreaRect().toJSON(), drag:getComputedStyle(header).getPropertyValue('app-region'), controlDrag:getComputedStyle(button).getPropertyValue('app-region'), actionsRight:actionRect.right, actionsBottom:actionRect.bottom, actionsCount:actions.querySelectorAll('button').length, actionsSafe:[...actions.querySelectorAll('button')].every(b=>getComputedStyle(b).getPropertyValue('app-region')==='no-drag'&&getComputedStyle(b).borderTopWidth==='0px') };
      })()`);
      assert.ok(Math.abs(info.headerHeight - 40) < 0.1);
      assert.ok(info.buttonBottom <= info.headerHeight);
      assert.equal(info.drag, "drag");
      assert.equal(info.controlDrag, "no-drag");
      assert.equal(info.actionsCount, 3);
      assert.equal(info.actionsSafe, true);
      assert.ok(info.actionsBottom <= info.headerHeight);
      if (process.platform !== "darwin") {
        assert.equal(info.native, true, "Native minimize/maximize/close controls remain enabled");
        assert.ok(info.buttonRight < info.area.x + info.area.width);
        assert.ok(info.actionsRight <= info.area.x + info.area.width, `Community controls must stay left of native caption buttons: ${JSON.stringify({factor, info})}`);
        assert.ok(Math.abs(info.area.height - info.headerHeight) <= 2, JSON.stringify(info));
      }
    }
    window.webContents.setZoomFactor(1);
    applyWindowZoom(window, 1, process.platform);
    await pause(100);
    const image = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    fs.writeFileSync(path.join(output, `${theme}.png`), image.toPNG());
  }
  await window.webContents.executeJavaScript(`document.querySelector('.sidebar-settings-button').click()`);
  await pause(150);
  assert.equal(await window.webContents.executeJavaScript(`!!document.querySelector('[role="dialog"][aria-labelledby="settings-title"]')`), true);
  console.log("Native window chrome passed: production renderer, caption overlay, drag/no-drag regions, 75–150% scale, both themes, relocated toggle and footer Settings.");
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
