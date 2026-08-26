import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MultiloginChatProfilePickerView } from "./MultiloginChatProfilePicker";
import type { MultiloginConnectionStatus } from "../lib/multiloginProfiles";

const noop = vi.fn();

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

function render({
  status = connectedStatus,
  open = false,
  query = "",
  profileKind = "browser" as const,
  selection,
}: {
  status?: MultiloginConnectionStatus | null;
  open?: boolean;
  query?: string;
  profileKind?: "browser" | "mobile";
  selection?: { kind: "browser" | "mobile"; id: string; name: string; folderId?: string };
} = {}) {
  return renderToStaticMarkup(
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
    />,
  );
}

describe("MultiloginChatProfilePickerView", () => {
  it("shows a compact chat trigger when Multilogin is connected", () => {
    const html = render();

    expect(html).toContain("Multilogin");
    expect(html).toContain("Choose a Multilogin profile");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("Search browser profiles");
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
