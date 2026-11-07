const TITLEBAR_HEIGHT = 40;

function windowChromeOptions(platform) {
  return platform === "darwin"
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 13 } }
    : { titleBarStyle: "hidden", titleBarOverlay: false };
}

function applyWindowChrome(window, { background, foreground }) {
  // Only palette colors from the trusted application renderer; never arbitrary CSS or commands.
  if (!/^#[\da-f]{6}$/i.test(background || "") || !/^#[\da-f]{6}$/i.test(foreground || "")) return false;
  window.setBackgroundColor(background);
  return true;
}

function applyWindowZoom(window, factor, platform) {
  if (platform === "darwin") window.setWindowButtonPosition({ x: 14, y: Math.max(0, Math.round((TITLEBAR_HEIGHT * factor - 14) / 2)) });
}

function windowState(window) {
  return { maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
}

function controlWindow(window, action) {
  switch (action) {
    case "minimize": window.minimize(); break;
    case "toggle-maximize":
      if (window.isFullScreen()) window.setFullScreen(false);
      else if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
    case "close": window.close(); return null;
    default: throw new Error("Unknown window control action.");
  }
  return windowState(window);
}

function watchWindowState(window) {
  const publish = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("window-state", windowState(window));
  };
  const events = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"];
  for (const event of events) window.on(event, publish);
  window.once("closed", () => { for (const event of events) window.removeListener(event, publish); });
}

module.exports = { TITLEBAR_HEIGHT, windowChromeOptions, applyWindowChrome, applyWindowZoom, windowState, controlWindow, watchWindowState };
