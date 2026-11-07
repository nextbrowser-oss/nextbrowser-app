// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopShell, TitlebarActions } from "./DesktopShell";
import { SidebarNavigation, SidebarSettingsButton } from "./SidebarNavigation";

const fixture = vi.hoisted(() => ({ state: { sidebarCollapsed: true, authed: true, checking: false, showOnboarding: false, setSidebarCollapsed: vi.fn(), setTab: vi.fn() } }));
vi.mock("../store", () => ({ useStore: (select: (state: typeof fixture.state) => unknown) => select(fixture.state) }));
afterEach(() => { cleanup(); fixture.state.checking = false; fixture.state.authed = true; delete window.nextbrowser; });

it("places the sidebar toggle in the global titlebar and preserves its expanded state", () => {
  render(<DesktopShell><aside id="app-sidebar">Navigation</aside></DesktopShell>);
  const toggle = screen.getByRole("button", { name: "Expand sidebar" });
  const home = screen.getByRole("button", { name: "Back to main view" });
  const buttons = toggle.closest("header")!.querySelectorAll("button");
  expect(buttons[0]).toBe(home);
  expect(buttons[1]).toBe(toggle);
  expect(home.querySelector('img')?.getAttribute('alt')).toBe('Nextbrowser');
  const brand = toggle.closest("header")!.querySelector(".app-titlebar-brand")!;
  expect(brand.firstElementChild?.textContent).toBe(`(${__APP_VERSION__})`);
  expect(brand.lastElementChild?.textContent).toBe("Nextbrowser");
  fireEvent.click(home);
  expect(fixture.state.setTab).toHaveBeenCalledWith("chat");
  expect(toggle.closest("header")).not.toBeNull();
  expect(toggle.closest("aside")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.getAttribute("aria-controls")).toBe("app-sidebar");
  fireEvent.click(toggle);
  expect(fixture.state.setSidebarCollapsed).toHaveBeenCalledWith(false);
});
it("does not offer sidebar interaction while startup is pending", () => {
  fixture.state.checking = true;
  render(<DesktopShell>Loading</DesktopShell>);
  expect((screen.getByRole("button", { name: "Expand sidebar" }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps page-owned actions in the global titlebar with working event handlers", () => {
  const click = vi.fn();
  render(<DesktopShell><TitlebarActions><button onClick={click}>Community action</button></TitlebarActions><main>Page</main></DesktopShell>);
  const action = screen.getByRole("button", { name: "Community action" });
  expect(action.closest("header")?.getAttribute("aria-label")).toBe("Application toolbar");
  expect(action.closest("main")).toBeNull();
  fireEvent.click(action);
  expect(click).toHaveBeenCalledOnce();
});
it("allows local sidebar navigation without an account sign-in", () => {
  fixture.state.authed = false;
  render(<DesktopShell>Local workspace</DesktopShell>);
  expect((screen.getByRole("button", { name: "Expand sidebar" }) as HTMLButtonElement).disabled).toBe(false);
});
it("dispatches caption actions and follows OS maximize/fullscreen events", async () => {
  let publish: ((value: unknown) => void) | undefined;
  const unlisten = vi.fn();
  const invoke = vi.fn(async () => ({ maximized: false, fullscreen: false }));
  window.nextbrowser = { platform: "win32", customWindowControls: true, invoke: invoke as never, on: (_channel, callback) => { publish = callback; return unlisten; } };
  const view = render(<DesktopShell>Chat</DesktopShell>);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
  expect(invoke).toHaveBeenCalledWith("app_window_control", { action: "minimize" });
  fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
  expect(invoke).toHaveBeenCalledWith("app_window_control", { action: "toggle-maximize" });
  act(() => publish?.({ maximized: true, fullscreen: false }));
  expect(screen.getByRole("button", { name: "Restore window" })).not.toBeNull();
  act(() => publish?.({ maximized: false, fullscreen: true }));
  expect(screen.getByRole("button", { name: "Restore window" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close window" }));
  expect(invoke).toHaveBeenCalledWith("app_window_control", { action: "close" });
  view.unmount();
  expect(unlisten).toHaveBeenCalledOnce();
});
it("keeps native macOS controls and avoids duplicate captions in an older main process", () => {
  window.nextbrowser = { platform: "darwin", customWindowControls: true, invoke: vi.fn(), on: vi.fn() };
  const view = render(<DesktopShell>Chat</DesktopShell>);
  expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  view.unmount();
  window.nextbrowser = { ...window.nextbrowser, platform: "win32", customWindowControls: false };
  render(<DesktopShell>Chat</DesktopShell>);
  expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
});
it("groups extensions while keeping the remaining destinations and a single active page", () => {
  const select = vi.fn();
  render(<SidebarNavigation collapsed tab="live" badgeFor={() => undefined} onSelect={select} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(4);
  for (const button of buttons) expect(button.querySelector("svg")?.style.strokeWidth).toBe("1.5");
  const live = screen.getByRole("button", { name: "Open Live profiles" });
  expect(live.getAttribute("aria-current")).toBe("page");
  fireEvent.click(live);
  expect(select).toHaveBeenCalledWith("live");
  expect(screen.queryByRole("button", { name: "Open Skills" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Extensions" }));
  expect(screen.getByRole("dialog", { name: "Extensions" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Open Skills" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Open Connectors" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open MCP" }));
  expect(select).toHaveBeenLastCalledWith("mcp");
  expect(screen.queryByRole("dialog", { name: "Extensions" })).toBeNull();
});
it("opens full Settings from the replacement footer and exposes update attention", () => {
  const open = vi.fn();
  render(<SidebarSettingsButton collapsed attention onClick={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings, update available" }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText("Agent")).toBeNull();
});
