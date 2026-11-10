// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./electronBridge", () => ({ invoke: vi.fn(async () => undefined), listen: vi.fn(async () => () => {}), filePathForFile: () => "" }));
vi.mock("./lib/analytics", () => ({ setAnalyticsUserId: vi.fn(), trackEvent: vi.fn(), trackScreenView: vi.fn(), trackTiming: vi.fn() }));
import { useStore } from "./store";

beforeEach(() => useStore.setState({ tab: "chat", utilityDialog: undefined, connectorPrompt: undefined }));
it.each(["connectors", "scheduled", "mcp"] as const)("opens %s without changing the underlying screen", modal => {
  useStore.setState({ tab: "skills" });
  useStore.getState().setTab(modal);
  expect(useStore.getState().tab).toBe("skills");
  expect(useStore.getState().utilityDialog).toBe(modal);
  useStore.getState().closeUtilityDialog();
  expect(useStore.getState().tab).toBe("skills");
  expect(useStore.getState().utilityDialog).toBeUndefined();
});
it("clears an obsolete connector resume request when opening MCP", () => {
  useStore.getState().openConnectorPrompt("multilogin", "profile-create");
  useStore.getState().setTab("mcp");
  expect(useStore.getState().connectorPrompt).toBeUndefined();
  expect(useStore.getState().utilityDialog).toBe("mcp");
});
it("opens connector setup over its originating screen and preserves the resume request", () => {
  useStore.setState({ tab: "live" });
  useStore.getState().openConnectorPrompt("multilogin", "profile-create");
  expect(useStore.getState().tab).toBe("live");
  expect(useStore.getState().utilityDialog).toBe("connectors");
  expect(useStore.getState().connectorPrompt?.returnTab).toBe("live");
  useStore.getState().completeConnectorPrompt();
  expect(useStore.getState().tab).toBe("live");
  expect(useStore.getState().utilityDialog).toBeUndefined();
  expect(useStore.getState().connectorPrompt).toBeUndefined();
});
it("clears a dismissed connector request and closes utilities on regular navigation", () => {
  useStore.getState().openConnectorPrompt("multilogin");
  useStore.getState().closeUtilityDialog();
  expect(useStore.getState().connectorPrompt).toBeUndefined();
  useStore.getState().setTab("scheduled");
  useStore.getState().setTab("chat");
  expect(useStore.getState().utilityDialog).toBeUndefined();
});
