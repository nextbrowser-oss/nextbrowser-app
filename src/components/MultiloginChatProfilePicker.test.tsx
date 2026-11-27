// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, fireEvent, render as renderDom, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../shared/ui";
import { MultiloginChatProfilePickerView } from "./MultiloginChatProfilePicker";
import type { MultiloginConnectionStatus } from "../lib/multiloginProfiles";

const noop = vi.fn();
afterEach(() => { cleanup(); vi.useRealTimers(); });

const connectedStatus: MultiloginConnectionStatus = {
  connected: true,
  valid: true,
  secureStorageAvailable: true,
  browserProfiles: [
    { id: "browser-1", name: "7_GitHub_acc", status: "Stopped" },
    { id: "browser-2", name: "Amazon US", status: "Running" },
  ],
  cloudPhones: [{ id: "17", name: "Android US", status: "Running" }],
};

function picker({
  status = connectedStatus,
  open = false,
  query = "",
  profileKind = "browser" as const,
  selection,
  onReconnect,
}: {
  status?: MultiloginConnectionStatus | null;
  open?: boolean;
  query?: string;
  profileKind?: "browser" | "mobile";
  selection?: { kind: "browser" | "mobile"; id: string; name: string; folderId?: string };
  onReconnect?: () => void;
} = {}) {
  return (
    <MultiloginChatProfilePickerView
      status={status}
      selection={selection}
      open={open}
      checking={false}
      refreshing={false}
      profileKind={profileKind}
      query={query}
      onToggle={noop}
      onClose={noop}
      onRefresh={noop}
      onProfileKindChange={noop}
      onQueryChange={noop}
      onSelect={noop}
      onClear={noop}
      onManage={noop}
      onReconnect={onReconnect}
    />
  );
}
const render = (options?: Parameters<typeof picker>[0]) => renderToStaticMarkup(picker(options));

describe("MultiloginChatProfilePickerView", () => {
  it("shows a compact chat trigger when Multilogin is connected", () => {
    vi.useFakeTimers();
    renderDom(<TooltipProvider>{picker()}</TooltipProvider>);
    const trigger = screen.getByRole("button", { name: "Multilogin" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByPlaceholderText("Search browser profiles")).toBeNull();
    fireEvent.pointerOver(trigger);
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("tooltip").textContent).toBe("Choose a Multilogin profile");
  });

  it("lists browser profiles and cloud phone counts in the open picker", () => {
    const html = render({ open: true });

    expect(html).toContain("Used by this chat");
    expect(html).toContain("Browsers");
    expect(html).toContain("Phones");
    expect(html).toContain("7_GitHub_acc");
    expect(html).toContain("Amazon US");
    expect(html).toContain("Search browser profiles");
    expect(html).toContain("Manage connector");
  });

  it("filters the visible profiles and marks the selected profile", () => {
    const html = render({
      open: true,
      query: "github",
      selection: { kind: "browser", id: "browser-1", name: "7_GitHub_acc" },
    });

    expect(html).toContain("7_GitHub_acc");
    expect(html).not.toContain("Amazon US");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Clear selection");
  });

  it("shows cloud phones on the mobile tab", () => {
    const html = render({ open: true, profileKind: "mobile" });

    expect(html).toContain("Android US");
    expect(html).toContain("Search cloud phones");
    expect(html).not.toContain("Amazon US");
  });

  it("stays hidden when the connector is not connected and nothing is selected", () => {
    const html = render({ status: { connected: false, valid: false, secureStorageAvailable: true } });

    expect(html).toBe("");
  });

  it("keeps the selected profile visible and offers recovery when reconnecting is required", () => {
    const html = render({
      open: true,
      status: { connected: true, valid: false, secureStorageAvailable: true, error: "Token expired" },
      selection: { kind: "browser", id: "browser-1", name: "7_GitHub_acc" },
    });

    expect(html).toContain("7_GitHub_acc");
    expect(html).toContain("Token expired");
    expect(html).toContain("Manage connector");
  });

  it("explains an expired token and offers to reconnect", () => {
    const html = render({
      open: true,
      status: { connected: true, valid: false, secureStorageAvailable: true, error: "Multilogin automation token is invalid or expired" },
      onReconnect: noop,
    });

    expect(html).toContain("The Multilogin token expired. Reconnect Multilogin with a fresh token.");
    expect(html).toContain("Reconnect Multilogin</button>");
    expect(html).not.toContain("automation token is invalid");
  });

  it("offers to reconnect only for a token problem", () => {
    const html = render({
      open: true,
      status: { ...connectedStatus, browserProfilesError: "Multilogin took too long to respond." },
      onReconnect: noop,
    });

    expect(html).toContain("Multilogin took too long to respond.");
    expect(html).not.toContain("Reconnect Multilogin</button>");
  });

  it("renders a saved selection without treating an unopened credential as disconnected", () => {
    const html = render({
      status: null,
      selection: { kind: "browser", id: "browser-1", name: "7_GitHub_acc" },
    });

    expect(html).toContain("7_GitHub_acc");
    expect(html).not.toContain("is-warning");
    expect(html).not.toContain("Reconnect");
  });
});
