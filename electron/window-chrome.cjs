const TITLEBAR_HEIGHT = 40;
const SIZE_SETTING = "nextbrowser.windowSize";
const MIN_WINDOW_SIZE = { width: 960, height: 640 };
const restoredSizes = new WeakMap();

function interfaceZoomShortcut(input, platform) {
  if (input.type !== "keyDown" || input.alt || input.isComposing) return;
  if (!input.control && !(platform === "darwin" && input.meta)) return;
  if (input.meta && (platform !== "darwin" || input.control)) return;
  if (input.key === "+" || input.key === "=" || input.code === "NumpadAdd") return "increase";
  if (input.key === "-" || input.code === "NumpadSubtract") return "decrease";
  if (input.key === "0" && !input.shift) return "reset";
}

function restoredWindowSize(settings, workArea) {
  let saved;
  try { saved = JSON.parse(settings.snapshot().values[SIZE_SETTING] || "null"); }
  catch { /* Use the normal startup size when an older preference is unreadable. */ }
  function dimension(value, fallback, min, max) {
    return Math.max(min, Math.min(Number.isSafeInteger(value) && value > 0 ? value : fallback, max));
  }
  return {
    width: dimension(saved?.width, 1180, MIN_WINDOW_SIZE.width, workArea.width),
    height: dimension(saved?.height, 760, MIN_WINDOW_SIZE.height, workArea.height),
    maximized: saved?.maximized === true,
  };
}

function saveWindowSize(window, settings) {
  if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized() || window.isFullScreen()) return;
  const bounds = window.getNormalBounds();
  const initial = restoredSizes.get(window);
  // A different display origin can round an unchanged edge by a logical pixel.
  // Persist the requested dimension until the user actually resizes that edge.
  const width = bounds.width === initial?.actualWidth ? initial.width : bounds.width;
  const height = bounds.height === initial?.actualHeight ? initial.height : bounds.height;
  const value = JSON.stringify({ width, height, maximized: window.isMaximized() });
  if (settings.snapshot().values[SIZE_SETTING] !== value) {
    void settings.update({ values: { [SIZE_SETTING]: value } }).catch(error => console.warn("[window size]", error));
  }
}

// At fractional Windows display scales, the native frame can round outward
// both when it is created and when its size is read back in logical pixels.
function fitWindowSize(window, size) {
  let requestWidth = size.width;
  let requestHeight = size.height;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [width, height] = window.getSize();
    if (width === size.width && height === size.height) break;
    if (attempt > 0) {
      requestWidth = Math.max(MIN_WINDOW_SIZE.width, requestWidth + size.width - width);
      requestHeight = Math.max(MIN_WINDOW_SIZE.height, requestHeight + size.height - height);
    }
    window.setSize(requestWidth, requestHeight);
  }
}

function rememberWindowSize(window, settings, size) {
  const [actualWidth, actualHeight] = window.getSize();
  restoredSizes.set(window, { width: size.width, height: size.height, actualWidth, actualHeight });
  let timer;
  const save = () => saveWindowSize(window, settings);
  const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 200); };
  for (const event of ["resize", "maximize", "unmaximize"]) window.on(event, schedule);
  window.on("close", save);
  window.once("closed", () => clearTimeout(timer));
}

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

module.exports = { TITLEBAR_HEIGHT, MIN_WINDOW_SIZE, interfaceZoomShortcut, restoredWindowSize, fitWindowSize, saveWindowSize, rememberWindowSize,
  windowChromeOptions, applyWindowChrome, applyWindowZoom, windowState, controlWindow, watchWindowState };
