const TITLEBAR_HEIGHT = 40;

function windowChromeOptions(platform, dark = true) {
  return platform === "darwin"
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 13 } }
    : { titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: dark ? "#ffffff" : "#17171c", height: TITLEBAR_HEIGHT } };
}

function applyWindowChrome(window, { background, foreground, factor = 1 }, platform, overlay = true) {
  // Only palette colors from the trusted application renderer; never arbitrary CSS or commands.
  if (!/^#[\da-f]{6}$/i.test(background || "") || !/^#[\da-f]{6}$/i.test(foreground || "")) return false;
  window.setBackgroundColor(background);
  if (platform !== "darwin" && overlay) window.setTitleBarOverlay({ color: background, symbolColor: foreground, height: Math.round(TITLEBAR_HEIGHT * factor) });
  return true;
}

function applyWindowZoom(window, factor, platform) {
  if (platform === "darwin") window.setWindowButtonPosition({ x: 14, y: Math.max(0, Math.round((TITLEBAR_HEIGHT * factor - 14) / 2)) });
  else window.setTitleBarOverlay({ height: Math.round(TITLEBAR_HEIGHT * factor) });
}

module.exports = { TITLEBAR_HEIGHT, windowChromeOptions, applyWindowChrome, applyWindowZoom };
