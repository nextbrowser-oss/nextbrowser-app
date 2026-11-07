// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Popover } from "./index";

afterEach(cleanup);
function Fixture() {
  const [open, setOpen] = useState(false);
  return <><Popover label="Choices" open={open} onOpenChange={setOpen} trigger={props => <button {...props}>Open</button>}>
    <input aria-label="Query" /><button onClick={() => setOpen(false)}>Choose</button>
  </Popover><button>Outside</button></>;
}
it("opens a portaled dialog with focus and an accessible relationship", () => {
  const { container } = render(<Fixture />);
  const button = screen.getByRole("button", { name: "Open" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  const popup = screen.getByRole("dialog", { name: "Choices" });
  expect(container.contains(popup)).toBe(false);
  expect(button.getAttribute("aria-controls")).toBe(popup.id);
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
});
it("closes on Escape and restores focus to the trigger", () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
});
it("keeps inside actions open, closes on outside pointer and on keyboard focus leaving", () => {
  render(<Fixture />);
  const open = screen.getByRole("button", { name: "Open" });
  fireEvent.click(open);
  fireEvent.pointerDown(screen.getByRole("textbox"));
  expect(screen.queryByRole("dialog")).not.toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(open);
  act(() => screen.getByRole("button", { name: "Outside" }).focus());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside" }));
});
it("closes after a selection without stealing focus from the trigger", () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
});
