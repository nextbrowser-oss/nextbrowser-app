// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecentProjects } from "./RecentProjects";

const fixture = vi.hoisted(() => ({
  conversations: Array.from({ length: 10 }, (_, i) => ({ id: `project-${i}`, title: `Project ${i}`, updatedAt: i, workspaceId: i % 2 ? "work" : "other" })),
  workspaces: [{ id: "work", name: "Work" }, { id: "other", name: "Other workspace" }],
  selectConversation: vi.fn(),
}));
vi.mock("../store", () => ({ useStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
afterEach(() => { cleanup(); fixture.selectConversation.mockClear(); });
it("shows the eight most recently updated projects across the user's workspaces", () => {
  render(<RecentProjects title="Project 9" activeId="project-9" />);
  fireEvent.click(screen.getByRole("button", { name: "Project 9" }));
  const popup = screen.getByRole("dialog", { name: "Recent projects" });
  const projects = within(popup).getAllByRole("button");
  expect(projects).toHaveLength(8);
  expect(projects[0].textContent).toContain("Project 9");
  expect(projects[0].getAttribute("aria-current")).toBe("true");
  expect(projects[1].textContent).toContain("Other workspace");
  expect(projects[7].textContent).toContain("Project 2");
  fireEvent.click(projects[1]);
  expect(fixture.selectConversation).toHaveBeenCalledWith("project-8");
  expect(screen.queryByRole("dialog")).toBeNull();
});
