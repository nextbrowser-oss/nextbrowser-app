// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatCommands } from "./ChatCommands";

afterEach(cleanup);
it("runs an explicit command through the caller and closes, keeping output in chat", () => {
  const run = vi.fn();
  render(<ChatCommands ready remote={false} onRun={run} />);
  fireEvent.click(screen.getByRole("button", { name: "Open commands" }));
  const submit = screen.getByRole("button", { name: "Run in chat" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Command to run" }), { target: { value: " git status " } });
  fireEvent.click(submit);
  expect(run).toHaveBeenCalledWith("git status");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("explains a VPS target and cannot run without a connected agent", () => {
  const run = vi.fn();
  const { rerender } = render(<ChatCommands ready remote onRun={run} />);
  fireEvent.click(screen.getByRole("button", { name: "Open commands" }));
  expect(screen.getByText(/selected VPS/)).toBeTruthy();
  rerender(<ChatCommands ready={false} remote onRun={run} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "pwd" } });
  const submit = screen.getByRole("button", { name: "Run in chat" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.submit(submit.closest("form")!);
  expect(run).not.toHaveBeenCalled();
});
