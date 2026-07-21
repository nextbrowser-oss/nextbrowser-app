// CDP screencast + interactive control — port of ScreencastClient.swift

import { invoke } from "./electronBridge";
import { internalError } from "./lib/userFacingError";

export type ScreencastState = "idle" | "connecting" | "live" | "error";

export interface ScreencastCallbacks {
  onState: (s: ScreencastState) => void;
  onFrame: (dataUrl: string) => void;
  onFps: (fps: number) => void;
  onError: (msg: string) => void;
}

export function httpBaseFromEndpoint(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    const port = u.port || (endpoint.startsWith("https") ? "443" : "80");
    return `http://${u.hostname}:${port}`;
  } catch {
    return endpoint.startsWith("http") ? endpoint : null;
  }
}

interface JsonTarget {
  id: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function resolvePageWsUrl(httpBase: string): Promise<string> {
  try {
    return await invoke<string>("cdp_page_ws_url", { httpBase });
  } catch {
    const res = await fetch(`${httpBase}/json/list`);
    const targets = (await res.json()) as JsonTarget[];
    const page =
      targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ??
      targets.find((t) => t.webSocketDebuggerUrl);
    if (!page?.webSocketDebuggerUrl) {
      throw new Error("No page targets found. Open a tab in NextBrowser first.");
    }
    return page.webSocketDebuggerUrl;
  }
}

export class Screencast {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private running = false;
  private frameTimes: number[] = [];
  private cb: ScreencastCallbacks;
  interactive = false;
  deviceWidth = 1440;
  deviceHeight = 900;
  lastClick: { x: number; y: number } | null = null;

  constructor(cb: ScreencastCallbacks) {
    this.cb = cb;
  }

  stop() {
    this.running = false;
    this.interactive = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send("Page.stopScreencast", {}).catch(() => {});
    }
    this.ws?.close();
    this.ws = null;
    this.cb.onState("idle");
    this.cb.onFps(0);
  }

  async start(httpBase: string) {
    this.stop();
    this.running = true;
    this.cb.onState("connecting");
    try {
      const wsUrl = await resolvePageWsUrl(httpBase);
      await this.connect(wsUrl);
    } catch {
      this.cb.onState("error");
      this.cb.onError(internalError("We couldn't start the browser preview."));
    }
  }

  private async connect(wsUrl: string) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = async () => {
        try {
          await this.send("Page.enable", {});
          await this.send("Input.enable", {});
          await this.send("Page.startScreencast", {
            format: "jpeg",
            quality: 75,
            maxWidth: 1440,
            maxHeight: 900,
            everyNthFrame: 1,
          });
          this.cb.onState("live");
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onmessage = (ev) => this.onMessage(String(ev.data));
      ws.onerror = () => {
        if (this.running) {
          this.cb.onState("error");
          this.cb.onError(internalError("We couldn't connect the browser preview."));
        }
        reject(new Error("WebSocket error"));
      };
      ws.onclose = () => {
        if (this.running) this.cb.onState("idle");
      };
    });
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const id = ++this.msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return Promise.resolve(null);
  }

  private onMessage(raw: string) {
    let msg: {
      method?: string;
      params?: {
        data?: string;
        sessionId?: number;
        metadata?: { deviceWidth?: number; deviceHeight?: number };
      };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.method === "Page.screencastFrame" && msg.params?.data) {
      if (msg.params.metadata?.deviceWidth) {
        this.deviceWidth = msg.params.metadata.deviceWidth;
        this.deviceHeight = msg.params.metadata.deviceHeight ?? 900;
      }
      const now = Date.now();
      this.frameTimes.push(now);
      this.frameTimes = this.frameTimes.filter((t) => now - t < 1000);
      this.cb.onFps(this.frameTimes.length);
      this.cb.onFrame(`data:image/jpeg;base64,${msg.params.data}`);
      if (msg.params.sessionId != null) {
        this.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
      }
    }
  }

  devicePoint(nx: number, ny: number) {
    return {
      x: Math.min(Math.max(nx, 0), 1) * this.deviceWidth,
      y: Math.min(Math.max(ny, 0), 1) * this.deviceHeight,
    };
  }

  async click(nx: number, ny: number) {
    if (!this.interactive) return;
    this.lastClick = { x: nx, y: ny };
    setTimeout(() => {
      this.lastClick = null;
    }, 350);
    const { x, y } = this.devicePoint(nx, ny);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  async scroll(nx: number, ny: number, deltaX: number, deltaY: number) {
    if (!this.interactive) return;
    const { x, y } = this.devicePoint(nx, ny);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
    });
  }

  async typeText(text: string) {
    if (!this.interactive || !text) return;
    await this.send("Input.insertText", { text });
  }

  async specialKey(key: string, code: string) {
    if (!this.interactive) return;
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  }
}
