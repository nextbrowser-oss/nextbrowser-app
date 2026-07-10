export type RemoteIceServer = {
  urls?: string[];
  username?: string;
  credential?: string;
};

export type RemoteStreamInfo = {
  id: string;
  dashboard_url?: string;
  viewer_url?: string;
  viewer_ws_url?: string;
  ice_servers?: RemoteIceServer[];
  expires_at?: string;
  profile?: string;
  target?: { title?: string; url?: string };
};

export type RemoteLiveTab = {
  target_id: string;
  title?: string;
  url?: string;
  origin?: string;
  type?: string;
  active?: boolean;
  attached?: boolean;
  loading?: boolean;
  can_close?: boolean;
};

export type RemoteMediaStats = {
  frame_width?: number;
  frame_height?: number;
  viewport_width?: number;
  viewport_height?: number;
  device_width?: number;
  device_height?: number;
  page_scale_factor?: number;
};

export type RemoteControlState = "idle" | "connecting" | "connected" | "error";

type CallbackSet = {
  onState?: (state: RemoteControlState) => void;
  onError?: (message: string) => void;
  onStream?: (stream: MediaStream) => void;
  onTabs?: (tabs: RemoteLiveTab[]) => void;
  onTabSelected?: (targetID: string) => void;
  onMediaStats?: (stats: RemoteMediaStats) => void;
};

type InputEnvelope = {
  type: "mouse" | "wheel" | "key" | "text";
  payload: Record<string, unknown>;
};

export class RemoteControlClient {
  private info: RemoteStreamInfo;
  private cb: CallbackSet;
  private ws: WebSocket | null = null;
  private signalID = "";
  private unlistenSignal: (() => void) | null = null;
  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private input: RTCDataChannel | null = null;
  private revision = 1;
  private seq = 0;
  private closed = false;
  private helloSent = false;
  private pendingControl: string[] = [];
  private pendingInput: string[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(info: RemoteStreamInfo, cb: CallbackSet) {
    this.info = info;
    this.cb = cb;
  }

  async start() {
    if (!this.info.viewer_ws_url) throw new Error("Remote stream did not include viewer_ws_url.");
    this.closed = false;
    this.cb.onState?.("connecting");
    const pc = new RTCPeerConnection({
      iceServers: (this.info.ice_servers || [])
        .filter((server) => server.urls?.length)
        .map((server) => ({
          urls: server.urls || [],
          username: server.username,
          credential: server.credential,
        })),
    });
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    this.control = pc.createDataChannel("remote-control", { ordered: true });
    this.input = pc.createDataChannel("remote-input", { ordered: true });
    this.control.onopen = () => {
      this.sendHello();
      this.flushControl();
    };
    this.control.onmessage = (event) => this.handleControlMessage(String(event.data));
    this.input.onopen = () => this.flushInput();
    this.input.onmessage = () => undefined;
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) this.cb.onStream?.(stream);
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        this.sendSignal({ type: "ice_complete", session_id: this.info.id, revision: this.revision, payload: null });
        return;
      }
      const candidate = event.candidate.toJSON();
      this.sendSignal({
        type: "ice_candidate",
        session_id: this.info.id,
        revision: this.revision,
        payload: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        },
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.cb.onState?.("connected");
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (!this.closed) this.cb.onState?.("error");
      }
    };

    await this.openSignalSocket();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({
      type: "rtc_offer",
      session_id: this.info.id,
      revision: this.revision,
      payload: { type: offer.type, sdp: offer.sdp },
    });
  }

  close() {
    this.closed = true;
    this.sendControl({ type: "close" });
    if (this.signalID) void invoke("remote_signal_close", { id: this.signalID }).catch(() => undefined);
    this.unlistenSignal?.();
    this.ws?.close();
    this.control?.close();
    this.input?.close();
    this.pc?.close();
    this.ws = null;
    this.signalID = "";
    this.unlistenSignal = null;
    this.control = null;
    this.input = null;
    this.pc = null;
    this.cb.onState?.("idle");
  }

  selectTab(targetID: string) {
    this.sendControl({
      type: "tab_select",
      seq: this.nextSeq(),
      ts: Date.now(),
      payload: { target_id: targetID },
    });
  }

  sendInput(message: InputEnvelope) {
    this.sendInputText(JSON.stringify({
      type: message.type,
      seq: this.nextSeq(),
      ts: Date.now(),
      payload: message.payload,
    }));
  }

  private async openSignalSocket() {
    this.unlistenSignal = await listen<{ id: string; type: string; data?: string; message?: string }>("remote_signal_event", ({ payload }) => {
      if (payload.id !== this.signalID) return;
      if (payload.type === "message" && payload.data) void this.handleSignalMessage(payload.data);
      if (payload.type === "error") this.cb.onError?.(payload.message || "Remote viewer signaling failed.");
      if (payload.type === "close" && !this.closed) this.cb.onError?.("Remote viewer signaling closed.");
    });
    this.signalID = await invoke<string>("remote_signal_open", { url: this.info.viewer_ws_url || "" });
  }

  private async handleSignalMessage(raw: string) {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === "rtc_answer" && message.payload?.sdp && this.pc) {
      await this.pc.setRemoteDescription({ type: "answer", sdp: message.payload.sdp });
      const candidates = this.pendingCandidates.splice(0);
      for (const candidate of candidates) await this.pc.addIceCandidate(candidate);
      return;
    }
    if (message.type === "ice_candidate" && message.payload?.candidate && this.pc) {
      const candidate = {
        candidate: message.payload.candidate,
        sdpMid: message.payload.sdpMid || undefined,
        sdpMLineIndex: message.payload.sdpMLineIndex ?? undefined,
      };
      if (!this.pc.remoteDescription) this.pendingCandidates.push(candidate);
      else await this.pc.addIceCandidate(candidate);
      return;
    }
    if (message.type === "error") this.cb.onError?.(message.message || "Remote viewer error.");
    if (message.type === "closed") this.cb.onError?.(message.message || "Remote session closed.");
  }

  private handleControlMessage(raw: string) {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type === "hello_ack") {
      this.cb.onState?.("connected");
      return;
    }
    if (message.type === "tabs_snapshot" && Array.isArray(message.payload?.tabs)) {
      this.cb.onTabs?.(message.payload.tabs);
      return;
    }
    if (message.type === "tabs_changed" && Array.isArray(message.payload?.upserted)) {
      this.cb.onTabs?.(message.payload.upserted);
      return;
    }
    if (message.type === "tab_selected" && message.payload?.target_id) {
      this.cb.onTabSelected?.(message.payload.target_id);
      return;
    }
    if (message.type === "tab_error") {
      this.cb.onError?.(message.payload?.message || "Tab switch failed.");
      return;
    }
    if (message.type === "media_stats") this.cb.onMediaStats?.(message.payload || {});
  }

  private sendHello() {
    if (this.helloSent) return;
    this.helloSent = true;
    this.sendControl({
      type: "hello",
      role: "viewer",
      session_id: this.info.id,
      revision: this.revision,
      protocol_version: 1,
      capabilities: ["mouse", "wheel", "keyboard", "text", "close", "quality_hint"],
    });
  }

  private sendSignal(payload: Record<string, unknown>) {
    if (this.signalID) void invoke("remote_signal_send", { id: this.signalID, data: JSON.stringify(payload) }).catch(() => undefined);
  }

  private sendControl(payload: Record<string, unknown>) {
    const raw = JSON.stringify(payload);
    if (this.control?.readyState === "open") this.control.send(raw);
    else this.pendingControl.push(raw);
  }

  private sendInputText(raw: string) {
    if (this.input?.readyState === "open") this.input.send(raw);
    else this.pendingInput.push(raw);
  }

  private flushControl() {
    while (this.control?.readyState === "open" && this.pendingControl.length) {
      this.control.send(this.pendingControl.shift() || "");
    }
  }

  private flushInput() {
    while (this.input?.readyState === "open" && this.pendingInput.length) {
      this.input.send(this.pendingInput.shift() || "");
    }
  }

  private nextSeq() {
    this.seq += 1;
    return this.seq;
  }
}
import { invoke, listen } from "./electronBridge";
