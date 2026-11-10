// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./index";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Fixture() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open utility</button>{open && <Dialog title="Utility" onClose={() => setOpen(false)}><button>Content action</button></Dialog>}</>;
}
it("portals the modal, names it, and restores opener focus after Escape", () => {
  const { container } = render(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open utility" });
  act(() => opener.focus()); fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Utility" });
  expect(container.contains(dialog)).toBe(false);
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
it("wraps keyboard focus and closes on its own backdrop", () => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Open utility" }));
  const dialog = screen.getByRole("dialog");
  const first = within(dialog).getByRole("button", { name: "Close Utility" });
  const last = within(dialog).getByRole("button", { name: "Content action" });
  act(() => first.focus()); fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" }); expect(document.activeElement).toBe(first);
  fireEvent.mouseDown(dialog.parentElement!);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("leaves Escape to a nested editor instead of closing its parent", () => {
  const close = vi.fn();
  render(<Dialog title="Parent" onClose={close}><div role="dialog" aria-modal="true" aria-label="Editor"><input aria-label="Nested input" /></div></Dialog>);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
