// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecentProjects } from "./RecentProjects";

const fixture = vi.hoisted(() => ({
  agentId: "codex", activeWorkspaceId: "work", activeConvId: { codex: "one" },
  conversations: [
    { id: "one", title: "Research", agent: "codex", workspaceId: "work", messages: [], createdAt: 1, updatedAt: 1 },
    { id: "two", title: "Marketing", agent: "codex", workspaceId: "work", messages: [], createdAt: 1, updatedAt: 2 },
    { id: "session", projectId: "one", title: "Session 2", agent: "codex", workspaceId: "work", messages: [], createdAt: 2, updatedAt: 3 },
    { id: "other", title: "Private other workspace", agent: "codex", workspaceId: "other", messages: [], createdAt: 1, updatedAt: 4 },
  ], moveProjectTreeItem: vi.fn(), selectConversation: vi.fn(), createProjectSession: vi.fn(() => "fresh"), setTab: vi.fn(),
}));
vi.mock("../store", () => ({ useStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it("opens Projects on hover without taking draft focus and remains open across the pointer gap", () => {
  vi.useFakeTimers();
  render(<><input aria-label="Draft" /><RecentProjects /></>);
  const draft = screen.getByRole("textbox", { name: "Draft" });
  draft.focus();
  const trigger = screen.getByRole("button", { name: "Open Projects" });
  fireEvent.pointerEnter(trigger);
  expect(document.activeElement).toBe(draft);
  const popup = screen.getByRole("dialog", { name: "Projects" });
  fireEvent.pointerLeave(trigger);
  act(() => vi.advanceTimersByTime(100));
  fireEvent.pointerEnter(popup);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByRole("dialog", { name: "Projects" })).not.toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerLeave(popup);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByRole("dialog", { name: "Projects" })).not.toBeNull();
});

it("groups existing history and independent sessions into collapsible workspace-scoped folders", () => {
  render(<RecentProjects />);
  fireEvent.click(screen.getByRole("button", { name: "Open Projects" }));
  const popup = screen.getByRole("dialog", { name: "Projects" });
  expect(within(popup).getAllByRole("treeitem").filter(item => item.getAttribute("aria-level") === "2")).toHaveLength(2);
  expect(screen.queryByText("Private other workspace")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Collapse project Research" }));
  expect(screen.queryByRole("treeitem", { name: "Open Session 2 in Research" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand project Research" }));
  fireEvent.click(screen.getByRole("treeitem", { name: "Open Session 2 in Research" }));
  expect(fixture.selectConversation).toHaveBeenCalledWith("session");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("searches all folder/session titles and reveals matching sessions inside collapsed folders", () => {
  render(<RecentProjects />);
  fireEvent.click(screen.getByRole("button", { name: "Open Projects" }));
  const search = screen.getByRole("searchbox", { name: "Search projects" });
  expect(document.activeElement).toBe(search);
  fireEvent.change(search, { target: { value: " MARKETING " } });
  expect(screen.getByRole("treeitem", { name: "Open Main session in Marketing" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Collapse project Research" })).toBeNull();
  fireEvent.change(search, { target: { value: "Session 2" } });
  expect(screen.getByRole("treeitem", { name: "Open Session 2 in Research" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "unmatched" } });
  expect(screen.getByText("No matching projects.")).toBeTruthy();
});
it("creates a session in its folder rather than another project", () => {
  render(<RecentProjects />);
  fireEvent.click(screen.getByRole("button", { name: "Open Projects" }));
  fireEvent.click(screen.getByRole("button", { name: "New session in Marketing" }));
  expect(fixture.createProjectSession).toHaveBeenCalledWith("two");
  expect(screen.queryByRole("dialog")).toBeNull();
});
