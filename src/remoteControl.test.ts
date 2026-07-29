import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("./electronBridge", () => bridge);

import { RemoteControlClient } from "./remoteControl";

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.readyState = "closed";
  }

  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  connectionState: RTCPeerConnectionState = "new";
  remoteDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: { candidate: null }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  channels: FakeDataChannel[] = [];

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addTransceiver() {
    return {};
  }

  createDataChannel() {
    const channel = new FakeDataChannel();
    this.channels.push(channel);
    return channel;
  }

  async createOffer() {
    return { type: "offer" as RTCSdpType, sdp: "offer-sdp" };
  }

  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}

  close() {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }

  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

describe("RemoteControlClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakePeerConnection.instances = [];
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    bridge.listen.mockResolvedValue(() => undefined);
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "remote_signal_open") return "signal-1";
      return undefined;
    });
  });

  it("creates a fresh offer and revision after a disconnected peer times out", async () => {
    const states: string[] = [];
    const client = new RemoteControlClient(
      { id: "session-1", viewer_ws_url: "wss://example.test/viewer" },
      { onState: (state) => states.push(state) },
    );

    await client.start();
    expect(FakePeerConnection.instances).toHaveLength(1);
    FakePeerConnection.instances[0].setConnectionState("disconnected");

    await vi.advanceTimersByTimeAsync(1500);
    expect(FakePeerConnection.instances).toHaveLength(2);

    const offers = bridge.invoke.mock.calls
      .filter(([command]) => command === "remote_signal_send")
      .map(([, args]) => JSON.parse(args.data))
      .filter((message) => message.type === "rtc_offer");
    expect(offers.map((message) => message.revision)).toEqual([1, 2]);
    expect(states).toContain("connecting");
    client.close();
  });

  it("reports rejected input results from the agent", async () => {
    const onInputError = vi.fn();
    const client = new RemoteControlClient(
      { id: "session-1", viewer_ws_url: "wss://example.test/viewer" },
      { onInputError },
    );

    await client.start();
    const input = FakePeerConnection.instances[0].channels[1];
    input.onmessage?.({ data: JSON.stringify({ type: "input_result", seq: 7, ok: false }) });

    expect(onInputError).toHaveBeenCalledOnce();
    client.close();
  });
});
