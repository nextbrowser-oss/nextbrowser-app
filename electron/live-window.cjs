const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { randomUUID } = require("node:crypto");

function startHelper(executable, reportFocus, onEvent = () => {}) {
  const child = spawn(executable, [], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let pending, failure;
  const fail = error => {
    failure = error;
    reportFocus(false);
    pending?.settle(error);
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("close", () => fail(new Error("The native Live helper stopped.")));
  lines.on("line", line => {
    try {
      const result = JSON.parse(line);
      if (result.event === "browser-focus") {
        if (!failure) reportFocus(result.focused === true);
        return;
      }
      if (result.event) {
        if (!failure) onEvent(result);
        return;
      }
      pending?.settle(result.error ? new Error(result.error) : null, result);
    } catch (error) {
      fail(error);
    }
  });
  return {
    send(message) {
      if (failure) return Promise.reject(failure);
      if (pending) return Promise.reject(new Error("The native Live helper is busy."));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error("The native Live helper did not respond."));
          child.stdin.end();
        }, 4000);
        pending = { settle(error, result) {
          pending = undefined;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(result);
        } };
        child.stdin.write(JSON.stringify(message) + "\n");
      });
    },
    close() { child.stdin.end(); },
  };
}

const nativeSessionRuntimes = new Map([
  ["clawbrowser", ["clawbrowser"]],
  ["dasbrowser", ["chromium", "dasbrowser"]],
  ["camoufox", ["camoufox"]],
]);

function nativeLiveRuntime(runtime) {
  return nativeSessionRuntimes.has(runtime);
}

function managedBrowserPID(status, runtime = "clawbrowser") {
  const pid = Number(status?.pid);
  const actualRuntime = status?.session?.runtime || "clawbrowser";
  if (status?.status !== "running" || status.session?.source !== "state_file" ||
      !nativeSessionRuntimes.get(runtime)?.includes(actualRuntime) ||
      !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return null;
  try {
    const endpoint = new URL(status.session.endpoint);
    if (["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) return pid;
  } catch { /* Missing or unusable endpoint. */ }
  return null;
}

function nativeLayout(raw, zoom) {
  const box = value => {
    if (!value || !["x", "y", "width", "height"].every(key =>
      typeof value[key] === "number" && Number.isFinite(value[key]) && Math.abs(value[key]) <= 32768) ||
      value.width <= 0 || value.height <= 0) return null;
    const x = Math.round(value.x * zoom);
    const y = Math.round(value.y * zoom);
    return {
      x, y, width: Math.round((value.x + value.width) * zoom) - x,
      height: Math.round((value.y + value.height) * zoom) - y,
    };
  };
  const bounds = box(raw?.bounds);
  if (raw?.hidden === true || !bounds) return { hidden: true };
  if (bounds.x < 0 || bounds.y < 0) return { hidden: true };
  const holes = Array.isArray(raw.holes) ? raw.holes.slice(0, 32).flatMap(value => {
    const rect = box(value);
    if (!rect) return [];
    const radius = Number.isFinite(value.radius) ? Math.max(0, Math.min(value.radius * zoom, rect.width / 2, rect.height / 2)) : 0;
    return [{ ...rect, radius: Math.round(radius) }];
  }) : [];
  return { bounds, holes, fill: raw.fill === true };
}

// macOS: the browser lies directly below the Nextbrowser window, which is
// transparent over the panel. App controls over the panel stay on top and keep
// the mouse; everywhere else in the panel the mouse goes to the browser.
// Bounds are relative to the host window frame, in points.
function macLayout(raw, zoom, offset = { x: 0, y: 0 }) {
  const layout = nativeLayout(raw, zoom);
  if (layout.hidden) return layout;
  const move = ({ x, y, width, height }) => ({ x: x + offset.x, y: y + offset.y, width, height });
  return { bounds: move(layout.bounds), controls: layout.holes.map(move) };
}

// macOS identifies windows across processes by their CGWindowID.
function macWindowID(window) {
  const match = /^window:(\d+):/.exec(window.getMediaSourceId());
  return match ? Number(match[1]) : 0;
}

function createLiveWindowManager({ helperPath, sessionPID, browserExecutable, onBrowserFocus = () => {}, platform = process.platform }) {
  const layoutFor = (window, raw) => {
    const zoom = window.webContents.getZoomFactor();
    if (platform !== "darwin") return nativeLayout(raw, zoom);
    if (window.isMinimized() || !window.isVisible()) return { hidden: true };
    const host = window.getBounds();
    const content = window.getContentBounds();
    const layout = macLayout(raw, zoom, { x: content.x - host.x, y: content.y - host.y });
    // Electron keeps the real frame while macOS animates a Space change.
    return layout.hidden ? layout : { ...layout, host };
  };
  // macOS may keep the browser smaller than the panel (it clamps windows to
  // the visible screen); the renderer then matches its transparent area.
  const browserFrame = (window, frame) => {
    if (!frame) return null;
    const zoom = window.webContents.getZoomFactor();
    const host = window.getBounds();
    const content = window.getContentBounds();
    return {
      x: (frame.x - content.x + host.x) / zoom, y: (frame.y - content.y + host.y) / zoom,
      width: frame.width / zoom, height: frame.height / zoom,
    };
  };
  const windows = new WeakMap();
  const queues = new WeakMap();
  const closing = new WeakSet();
  const boundsPending = new WeakSet();
  const serialize = (window, operation) => {
    const next = (queues.get(window) ?? Promise.resolve()).then(operation);
    const settled = next.catch(() => undefined);
    queues.set(window, settled);
    void settled.then(() => { if (queues.get(window) === settled) queues.delete(window); });
    return next;
  };
  // macOS: the window shadow would fall into the transparent panel.
  const showHole = (window, visible) => {
    if (platform !== "darwin" || window.isDestroyed()) return;
    window.setHasShadow(!visible);
    if (!visible) window.setIgnoreMouseEvents(false);
  };
  // macOS full screen moves the window to its own Space, where another app's
  // window cannot appear. While a browser is attached the green button zooms
  // the window on the same Space instead, which Windows does too.
  const holdFullScreen = (window, attached) => {
    if (platform !== "darwin" || window.isDestroyed()) return;
    if (attached && window.isFullScreen()) {
      // Changing it during the transition would cancel the exit.
      window.once("leave-full-screen", () => {
        if (window.isDestroyed()) return;
        window.maximize();
        if (windows.has(window)) window.setFullScreenable(false);
      });
      window.setFullScreen(false);
      return;
    }
    window.setFullScreenable(!attached);
  };
  const release = async window => {
    const session = windows.get(window);
    if (!session) return;
    windows.delete(window);
    showHole(window, false);
    holdFullScreen(window, false);
    onBrowserFocus(window, false);
    try { await session.helper.send({ operation: "detach" }); }
    catch (error) {
      // Recover the main window if the helper exited before restoring its shape.
      if (!window.isDestroyed()) window.setShape([]);
      throw error;
    }
    finally { session.helper.close(); }
  };
  const attach = (session, layout) => session.helper.send({ operation: "attach", ...session.target, layout });
  return {
    async handle(window, { operation, profile, runtime, id, layout }) {
      return serialize(window, async () => {
        if (closing.has(window) || window.isDestroyed()) return null;
        const getLayout = () => layoutFor(window, layout);
        if (operation === "start") {
          if (!nativeLiveRuntime(runtime)) return null;
          await release(window);
          const pid = await sessionPID(profile, runtime);
          const executable = pid && await browserExecutable(runtime);
          if (!pid || !executable || closing.has(window) || window.isDestroyed()) return null;
          const helper = startHelper(helperPath, focused => {
            if (windows.get(window) === session) onBrowserFocus(window, focused);
          }, event => {
            if (windows.get(window) !== session || window.isDestroyed()) return;
            // macOS: only Nextbrowser may reorder its own window, so the
            // helper asks for it to go back directly above the browser.
            if (event.event === "host-order" && Number.isInteger(event.above) && event.above > 0) {
              try { window.moveAbove(`window:${event.above}:0`); }
              catch { /* That window closed in the meantime. */ }
            }
            if (event.event === "pointer") window.setIgnoreMouseEvents(event.passthrough === true);
            if (event.event === "browser-frame") window.webContents.send("live-window:frame", browserFrame(window, event.frame));
            if (event.event === "browser-visible") window.webContents.send("live-window:visible", event.visible === true);
          });
          const host = platform === "darwin" ? macWindowID(window) : Number(window.getNativeWindowHandle().readBigUInt64LE());
          const session = {
            helper, id: randomUUID(), attached: true, layout: getLayout(), raw: layout,
            target: { pid, executable, runtime, host },
          };
          // The attach reply and the first focus event can share a stdout chunk.
          windows.set(window, session);
          try {
            const result = await attach(session, session.layout);
            if (result.attached) {
              holdFullScreen(window, true);
              showHole(window, !session.layout.hidden);
              return { id: session.id, attached: true };
            }
            if (result.permission) {
              windows.delete(window);
              helper.close();
              return { permission: result.permission };
            }
          } catch (error) {
            console.warn("[live-window]", error.message);
          }
          windows.delete(window);
          onBrowserFocus(window, false);
          helper.close();
          return null;
        }
        const session = windows.get(window);
        if (!session || session.id !== id) return null;
        if (operation === "release") {
          await release(window);
          return null;
        }
        if (operation === "embed" && !session.attached) {
          // Return the existing HWND, even if the user moved or minimized it.
          const nextLayout = getLayout();
          session.raw = layout;
          const result = await attach(session, nextLayout);
          if (result.attached) {
            session.attached = true;
            session.layout = nextLayout;
            holdFullScreen(window, true);
            showHole(window, !nextLayout.hidden);
          }
          if (!result.available) return null;
        } else if (operation === "detach" && session.attached) {
          const result = await session.helper.send({ operation: "detach" });
          session.attached = false;
          showHole(window, false);
          holdFullScreen(window, false);
          onBrowserFocus(window, false);
          if (!result.available) return null;
        } else if (operation === "layout") {
          session.layout = getLayout();
          session.raw = layout;
          showHole(window, session.attached && !session.layout.hidden);
          const result = await session.helper.send({ operation: "layout", layout: session.layout });
          if (!result.available) return null;
        } else if (operation === "status") {
          const result = await session.helper.send({ operation: "status" });
          if (!result.available) return null;
        }
        return { id: session.id, attached: session.attached };
      });
    },
    close(window) {
      closing.add(window);
      return serialize(window, () => release(window));
    },
    reset(window) { return serialize(window, () => release(window)); },
    syncBounds(window) {
      if (!windows.get(window)?.attached || boundsPending.has(window)) return;
      boundsPending.add(window);
      void serialize(window, async () => {
        const session = windows.get(window);
        if (session?.attached && !closing.has(window)) {
          if (platform === "darwin") session.layout = layoutFor(window, session.raw);
          await session.helper.send({ operation: "layout", layout: session.layout });
        }
      }).catch(error => console.warn("[live-window]", error.message)).finally(() => boundsPending.delete(window));
    },
    hasWork(window) { return windows.has(window) || queues.has(window); },
  };
}

module.exports = { createLiveWindowManager, managedBrowserPID, nativeLayout, macLayout, nativeLiveRuntime };
