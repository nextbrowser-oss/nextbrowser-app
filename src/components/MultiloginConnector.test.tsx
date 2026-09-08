import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MultiloginConnectorView, type MultiloginConnectionStatus } from "./MultiloginConnector";

const noop = vi.fn();

function render(
  status: MultiloginConnectionStatus,
  dialogOpen = false,
  profileKind: "browser" | "mobile" = "browser",
  tokenSource: "app" | "web" = "app",
) {
  return renderToStaticMarkup(
    <MultiloginConnectorView
      status={status}
      checking={false}
      busy={false}
      dialogOpen={dialogOpen}
      bearerToken=""
      confirmDisconnect={false}
      reconnecting={false}
      folders={[]}
      foldersLoading={false}
      profileKind={profileKind}
      tokenSource={tokenSource}
      workspaceName="Work"
      onOpen={noop}
      onClose={noop}
      onBearerTokenChange={noop}
      onConnect={noop}
      onDisconnectRequest={noop}
      onDisconnectCancel={noop}
      onDisconnect={noop}
      onReconnect={noop}
      onReconnectCancel={noop}
      onSelectFolder={noop}
      onOpenMultilogin={noop}
      onOpenMultiloginApp={noop}
      onOpenGuide={noop}
      onProfileKindChange={noop}
      onTokenSourceChange={noop}
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
    expect(dialogHtml).toContain("Use another token");

    const mobileHtml = render(status, true, "mobile");
    expect(mobileHtml).toContain("Android cloud phones");
    expect(mobileHtml).toContain("Android US");
    expect(mobileHtml).toContain("1 phone");
  });

  it("shows desktop app token instructions by default", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: true }, true);

    expect(html).toContain("Connect Multilogin");
    expect(html).toContain("Desktop app");
    expect(html).toContain("Web");
    expect(html).toContain("<button type=\"button\">Open the Multilogin desktop app</button>");
    expect(html).toContain("Info");
    expect(html).toContain("API token");
    expect(html).not.toContain("Multilogin token guide");
    expect(html).not.toContain("DevTools");
    expect(html).not.toContain("Local storage");
    expect(html).toContain('type="password"');
    expect(html).toContain('role="dialog"');
  });

  it("shows the DevTools instructions on the web tab", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: true }, true, "browser", "web");

    expect(html).toContain("Open Multilogin");
    expect(html).toContain("Multilogin token guide");
    expect(html).toContain("DevTools");
    expect(html).toContain("F12");
    expect(html).toContain("<strong>Application</strong> in Chrome, <strong>Storage</strong> in Firefox and Safari");
    expect(html).toContain("Local storage");
    expect(html).toContain("https://app.multilogin.com");
    expect(html).toContain("token");
    expect(html).toContain("Bearer token");
    expect(html).not.toContain("Information dialog");
  });

  it("names the account and workspace a token belongs to", () => {
    const html = render({
      connected: true,
      valid: true,
      secureStorageAvailable: true,
      account: { email: "pasha@example.com", workspaceName: "Shared team", workspaceRole: "manager" },
      browserProfiles: [{ id: "browser-1", name: "Amazon US" }],
    }, true);

    expect(html).toContain("Shared team · manager");
    expect(html).toContain("pasha@example.com");
  });

  it("falls back to a workspace id when the token carries no email", () => {
    const html = render({
      connected: true,
      valid: true,
      secureStorageAvailable: true,
      account: { workspaceId: "4f3a91c2-7788" },
    }, true);

    expect(html).toContain("Workspace 4f3a91c2");
  });

  it("offers the folders of the selected profile kind", () => {
    const html = renderToStaticMarkup(
      <MultiloginConnectorView
        status={{ connected: true, valid: true, secureStorageAvailable: true, folders: { browser: "f-1" } }}
        checking={false}
        busy={false}
        dialogOpen
        bearerToken=""
        confirmDisconnect={false}
        reconnecting={false}
        folders={[
          { id: "f-1", name: "Shared with me", kind: "browser", profilesCount: 3 },
          { id: "f-2", name: "Phones", kind: "mobile", profilesCount: 0 },
        ]}
        foldersLoading={false}
        profileKind="browser"
        tokenSource="app"
        workspaceName="Work"
        onOpen={noop}
        onClose={noop}
        onBearerTokenChange={noop}
        onConnect={noop}
        onDisconnectRequest={noop}
        onDisconnectCancel={noop}
        onDisconnect={noop}
        onReconnect={noop}
        onReconnectCancel={noop}
        onSelectFolder={noop}
        onOpenMultilogin={noop}
        onOpenMultiloginApp={noop}
        onOpenGuide={noop}
        onProfileKindChange={noop}
        onTokenSourceChange={noop}
        onSelectProfile={noop}
        onClearSelection={noop}
      />,
    );

    expect(html).toContain("Shared with me (3)");
    expect(html).not.toContain("Phones");
    expect(html).toContain("All folders");
  });

  it("blocks connection when secure storage is unavailable", () => {
    const html = render({ connected: false, valid: false, secureStorageAvailable: false });

    expect(html).toContain("Unlock your system credential store");
    expect(html).toContain("disabled");
  });
});
