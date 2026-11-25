// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeviceSessions } from "./DeviceSessions";
import { invoke } from "../electronBridge";
import { TooltipProvider } from "../shared/ui";

const account = vi.hoisted(() => ({ authed: true, accountOwnerId: "owner-a" }));
vi.mock("../store", () => ({ useStore: (select: (value: typeof account) => unknown) => select(account) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); account.accountOwnerId = "owner-a"; });

it("distinguishes session contact from old pairings and clears results on account switch", async () => {
  const lastSeen = "2026-11-25T00:00:00Z";
  vi.mocked(invoke).mockResolvedValueOnce({ current: "here", sessions: [
    { id: "here", name: "Laptop", platform: "win32", last_seen_at: lastSeen, paired_only: false },
    { id: "remote", name: "Studio", platform: "darwin", last_seen_at: lastSeen, paired_only: false },
    { id: "pairing", name: "Old installation", platform: "", last_seen_at: lastSeen, paired_only: true },
  ] }).mockRejectedValueOnce(new Error("Could not load device sessions."))
    .mockResolvedValueOnce({ current: "here", sessions: [] });
  const view = () => <TooltipProvider><DeviceSessions /></TooltipProvider>;
  const mounted = render(view());
  expect((await screen.findByText("Laptop")).parentElement?.textContent).toContain("This device");
  expect(screen.getByText("Studio").parentElement?.textContent).toContain("macOS");
  expect(screen.getAllByText("Last seen")).toHaveLength(2);
  expect(screen.getByText("Earlier pairings")).toBeTruthy();
  expect(screen.getByText("Paired")).toBeTruthy();
  account.accountOwnerId = "owner-b";
  mounted.rerender(view());
  expect(screen.queryByText("Studio")).toBeNull();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Refresh device sessions" }));
  expect(await screen.findByText("No devices have reported a session yet.")).toBeTruthy();
});
