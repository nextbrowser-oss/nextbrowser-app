// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileDropArea } from "./index";

afterEach(cleanup);
const file = new File(["hello"], "note.txt", { type: "text/plain" });
const transfer = () => ({ types: ["Files"], files: [file], dropEffect: "none" });

it("keeps feedback across nested elements and delivers a dropped file once", () => {
  const onFiles = vi.fn();
  render(<FileDropArea onFiles={onFiles}><div data-testid="parent"><textarea aria-label="Message" /></div></FileDropArea>);
  const parent = screen.getByTestId("parent");
  const input = screen.getByRole("textbox");
  const dataTransfer = transfer();
  fireEvent.dragEnter(parent, { dataTransfer });
  fireEvent.dragEnter(input, { dataTransfer });
  fireEvent.dragLeave(parent, { dataTransfer });
  expect(screen.getByRole("status").textContent).toBe("Drop files to attach");
  fireEvent.dragOver(input, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("copy");
  fireEvent.drop(input, { dataTransfer });
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  expect(screen.queryByRole("status")).toBeNull();
});

it.each(["dragend", "blur", "Escape"])("clears cancelled file feedback on %s", event => {
  render(<FileDropArea onFiles={vi.fn()}><textarea aria-label="Message" /></FileDropArea>);
  fireEvent.dragEnter(screen.getByRole("textbox"), { dataTransfer: transfer() });
  expect(screen.getByRole("status")).toBeTruthy();
  if (event === "Escape") fireEvent.keyDown(window, { key: "Escape" });
  else fireEvent(window, new Event(event));
  expect(screen.queryByRole("status")).toBeNull();
});

it("ignores text dragging and explains a disabled file drop without attaching it", () => {
  const onFiles = vi.fn();
  render(<FileDropArea onFiles={onFiles} disabled unavailableLabel="Connect an agent to attach files"><textarea aria-label="Message" /></FileDropArea>);
  const input = screen.getByRole("textbox");
  fireEvent.dragEnter(input, { dataTransfer: { types: ["text/plain"], files: [] } });
  expect(screen.queryByRole("status")).toBeNull();
  const dataTransfer = transfer();
  fireEvent.dragEnter(input, { dataTransfer });
  expect(screen.getByRole("status").textContent).toBe("Connect an agent to attach files");
  fireEvent.dragOver(input, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("none");
  fireEvent.drop(input, { dataTransfer });
  expect(onFiles).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("consumes Escape only while a file drag is active, preserving parent navigation otherwise", () => {
  const parentEscape = vi.fn();
  document.addEventListener("keydown", parentEscape);
  try {
    render(<FileDropArea onFiles={vi.fn()}><textarea aria-label="Message" /></FileDropArea>);
    const input = screen.getByRole("textbox");
    fireEvent.dragEnter(input, { dataTransfer: transfer() });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(parentEscape).toHaveBeenCalledOnce();
  } finally { document.removeEventListener("keydown", parentEscape); }
});
