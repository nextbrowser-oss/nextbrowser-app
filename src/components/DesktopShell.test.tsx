// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopShell } from "./DesktopShell";
import { SidebarNavigation, SidebarSettingsButton } from "./SidebarNavigation";

const fixture = vi.hoisted(() => ({ state: { sidebarCollapsed: true, authed: true, checking: false, showOnboarding: false, setSidebarCollapsed: vi.fn() } }));
vi.mock("../store", () => ({ useStore: (select: (state: typeof fixture.state) => unknown) => select(fixture.state) }));
afterEach(() => { cleanup(); fixture.state.checking = false; fixture.state.authed = true; });

it("places the sidebar toggle in the global titlebar and preserves its expanded state", () => {
  render(<DesktopShell><aside id="app-sidebar">Navigation</aside></DesktopShell>);
  const toggle = screen.getByRole("button", { name: "Expand sidebar" });
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
it("allows local sidebar navigation without an account sign-in", () => {
  fixture.state.authed = false;
  render(<DesktopShell>Local workspace</DesktopShell>);
  expect((screen.getByRole("button", { name: "Expand sidebar" }) as HTMLButtonElement).disabled).toBe(false);
});
it("keeps five destinations with consistent monoline icons and a single active page", () => {
  const select = vi.fn();
  render(<SidebarNavigation collapsed tab="live" badgeFor={() => undefined} onSelect={select} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(5);
  for (const button of buttons) expect(button.querySelector("svg")?.style.strokeWidth).toBe("1.5");
  const live = screen.getByRole("button", { name: "Open Live profiles" });
  expect(live.getAttribute("aria-current")).toBe("page");
  fireEvent.click(live);
  expect(select).toHaveBeenCalledWith("live");
});
it("opens full Settings from the replacement footer and exposes update attention", () => {
  const open = vi.fn();
  render(<SidebarSettingsButton collapsed attention onClick={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings, update available" }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText("Agent")).toBeNull();
});
