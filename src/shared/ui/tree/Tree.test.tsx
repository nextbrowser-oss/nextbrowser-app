// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Tree } from "./index";

afterEach(cleanup);
const nodes = [{ id: "folder", label: "Folder", children: [{ id: "leaf", label: "Session" }] }, { id: "target", label: "Target", children: [{ id: "other", label: "Other" }] }];
it("supports FractalUI keyboard expansion/navigation and built-in search with ancestor retention", () => {
  const select = vi.fn();
  render(<Tree label="Files" nodes={nodes} searchable searchPlaceholder="Find" onSelect={select} />);
  const folder = screen.getByRole("treeitem", { name: "Folder" });
  folder.focus();
  fireEvent.keyDown(folder, { key: "ArrowRight" });
  const leaf = screen.getByRole("treeitem", { name: "Session" });
  expect(leaf.getAttribute("aria-level")).toBe("2");
  fireEvent.keyDown(folder, { key: "ArrowDown" });
  expect(document.activeElement).toBe(leaf);
  fireEvent.keyDown(leaf, { key: "Enter" });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "leaf" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find" }), { target: { value: "session" } });
  expect(screen.getByRole("treeitem", { name: "Folder" })).toBeTruthy();
  expect(screen.queryByRole("treeitem", { name: "Target" })).toBeNull();
});
it("validates drops before showing feedback and disables drag while searching", () => {
  const drop = vi.fn(), canDrop = vi.fn(() => false);
  render(<Tree nodes={nodes} defaultExpandAll searchable searchPlaceholder="Find" onDrop={drop} canDrop={canDrop} />);
  const leaf = screen.getByRole("treeitem", { name: "Session" }), target = screen.getByRole("treeitem", { name: "Target" });
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
  const transfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(leaf, { dataTransfer: transfer });
  const over = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperties(over, { clientY: { value: 20 }, dataTransfer: { value: transfer } });
  fireEvent(target, over);
  expect(canDrop).toHaveBeenCalledWith({ dragId: "leaf", targetId: "target", position: "inside" });
  expect(target.getAttribute("data-drop")).toBeNull();
  fireEvent.drop(target, { dataTransfer: transfer });
  expect(drop).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find" }), { target: { value: "session" } });
  expect(screen.getByRole("treeitem", { name: "Session" }).getAttribute("draggable")).toBe("false");
});
