const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { randomUUID } = require("node:crypto");

function startHelper(executable, reportFocus) {
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

function createLiveWindowManager({ helperPath, sessionPID, browserExecutable, onBrowserFocus = () => {} }) {
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
  const release = async window => {
    const session = windows.get(window);
    if (!session) return;
    windows.delete(window);
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
        const getLayout = () => nativeLayout(layout, window.webContents.getZoomFactor());
        if (operation === "start") {
          if (!nativeLiveRuntime(runtime)) return null;
          await release(window);
          const pid = await sessionPID(profile, runtime);
          const executable = pid && await browserExecutable(runtime);
          if (!pid || !executable || closing.has(window) || window.isDestroyed()) return null;
          const helper = startHelper(helperPath, focused => {
            if (windows.get(window) === session) onBrowserFocus(window, focused);
          });
          const session = {
            helper, id: randomUUID(), attached: true, layout: getLayout(),
            target: { pid, executable, runtime, host: Number(window.getNativeWindowHandle().readBigUInt64LE()) },
          };
          // The attach reply and the first focus event can share a stdout chunk.
          windows.set(window, session);
          try {
            const result = await attach(session, session.layout);
            if (result.attached) {
              return { id: session.id, attached: true };
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
          const result = await attach(session, nextLayout);
          if (result.attached) {
            session.attached = true;
            session.layout = nextLayout;
          }
          if (!result.available) return null;
        } else if (operation === "detach" && session.attached) {
          const result = await session.helper.send({ operation: "detach" });
          session.attached = false;
          onBrowserFocus(window, false);
          if (!result.available) return null;
        } else if (operation === "layout") {
          session.layout = getLayout();
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
          await session.helper.send({ operation: "layout", layout: session.layout });
        }
      }).catch(error => console.warn("[live-window]", error.message)).finally(() => boundsPending.delete(window));
    },
    hasWork(window) { return windows.has(window) || queues.has(window); },
  };
}

module.exports = { createLiveWindowManager, managedBrowserPID, nativeLayout, nativeLiveRuntime };
