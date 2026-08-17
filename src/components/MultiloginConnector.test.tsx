import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MultiloginConnectorView, type MultiloginConnectionStatus } from "./MultiloginConnector";

const noop = vi.fn();

function render(
  status: MultiloginConnectionStatus,
  dialogOpen = false,
  profileKind: "browser" | "mobile" = "browser",
) {
  return renderToStaticMarkup(
    <MultiloginConnectorView
      status={status}
      checking={false}
      busy={false}
      dialogOpen={dialogOpen}
      bearerToken=""
      confirmDisconnect={false}
      profileKind={profileKind}
      workspaceName="Work"
      onOpen={noop}
      onClose={noop}
      onBearerTokenChange={noop}
      onConnect={noop}
      onDisconnectRequest={noop}
      onDisconnectCancel={noop}
      onDisconnect={noop}
      onOpenMultilogin={noop}
      onOpenGuide={noop}
      onProfileKindChange={noop}
      onSelectProfile={noop}
      onClearSelection={noop}
    />,
  );
}

describe("MultiloginConnectorView", () => {
  it("shows a compact disconnected connector card", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: true });

    expect(html).toContain("Multilogin");
    expect(html).toContain("Mimic browser profiles and Android cloud phones");
    expect(html).toContain("./multilogin-icon.svg");
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect");
    expect(html).not.toContain("Bearer token");
  });

  it("shows separate browser profile and cloud phone counts", () => {
    const status = {
      connected: true,
      valid: true,
      secureStorageAvailable: true,
      browserProfiles: [
        { id: "browser-1", name: "Amazon US" },
        { id: "browser-2", name: "Work EU" },
      ],
      cloudPhones: [{ id: "17", name: "Android US" }],
    };
    const html = render(status);

    expect(html).toContain("Connected");
    expect(html).toContain("Manage");
    expect(html).not.toContain("Bearer token");

    const dialogHtml = render(status, true);
    expect(dialogHtml).toContain("Multilogin connected");
    expect(dialogHtml).toContain("Browser profiles");
    expect(dialogHtml).toContain("Cloud phones");
    expect(dialogHtml).toContain("Amazon US");
    expect(dialogHtml).toContain("2 profiles");
    expect(dialogHtml).toContain("No-expiration token");

    const mobileHtml = render(status, true, "mobile");
    expect(mobileHtml).toContain("Android cloud phones");
    expect(mobileHtml).toContain("Android US");
    expect(mobileHtml).toContain("1 phone");
  });

  it("shows compact bearer instructions and official Multilogin links in the dialog", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: true }, true);

    expect(html).toContain("Connect Multilogin");
    expect(html).toContain("Open Multilogin");
    expect(html).toContain("Multilogin token guide");
    expect(html).toContain("Local or Session storage");
    expect(html).toContain("wails");
    expect(html).toContain('type="password"');
    expect(html).toContain('role="dialog"');
  });

  it("blocks connection when secure storage is unavailable", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: false });

    expect(html).toContain("Unlock your system credential store");
    expect(html).toContain("disabled");
  });
});
