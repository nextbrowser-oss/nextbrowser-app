// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../electronBridge";
import { showLiveStartPage } from "../lib/liveStartPage";
import { TooltipProvider } from "../shared/ui";
import { LiveView } from "./LiveView";
import { clawbrowserTargetKey } from "../lib/liveProfileSwitch";

const state = vi.hoisted(() => ({
  activeWorkspaceId: "work",
  workspaces: [{ id: "work", profileNames: ["local"], profileToolsets: { local: "clawbrowser" } }],
  profiles: [{ name: "local" }],
  statuses: { local: "running" },
  selectedProfile: "local",
  tab: "live",
  startProfile: vi.fn(),
  startRemoteStream: vi.fn(),
}));

vi.mock("../store", () => ({ useStore: Object.assign(() => state, { getState: () => state }) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
vi.mock("../lib/liveStartPage", () => ({ showLiveStartPage: vi.fn(async () => {}) }));

const session = { id: "native-session", attached: true };
const onControlsChange = () => {};
const localKey = clawbrowserTargetKey("local");
const mount = () => render(<TooltipProvider><LiveView active controlsOpen requestedKey={localKey}
  profileOptions={[{ key: localKey, label: "Local", running: true, target: { runtime: "clawbrowser", profile: "local" } }]}
  onControlsChange={onControlsChange} onOverview={() => {}} /></TooltipProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("nextbrowser", { platform: "win32" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens an already running profile inside Live after Windows attaches its window", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "live_window_available") return true;
    if (command === "live_window" && args?.operation === "release") return null;
    if (command === "live_window") return session;
    throw new Error(`Unexpected command: ${command}`);
  });
  mount();
  await screen.findByRole("button", { name: "Open in separate window" });
  expect(screen.queryByRole("tablist", { name: "Main views" })).toBeNull();
  expect(invoke).toHaveBeenCalledWith("live_window", expect.objectContaining({
    operation: "start", profile: "local", runtime: "clawbrowser",
  }));
  expect(showLiveStartPage).toHaveBeenCalledOnce();
  expect(state.startProfile).not.toHaveBeenCalled();
  expect(state.startRemoteStream).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Restart in Processes" })).toBeNull();
});

it("offers a restart when the running profile has no window to attach", async () => {
  vi.mocked(invoke).mockImplementation(async command => command === "live_window_available" ? true : null);
  mount();
  await screen.findByRole("button", { name: "Restart in Processes" });
  expect(showLiveStartPage).not.toHaveBeenCalled();
  expect(state.startRemoteStream).not.toHaveBeenCalled();
});
