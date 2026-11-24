// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LiveSessionOption } from "../lib/liveSessions";
import { settingsStorage } from "../lib/settingsStorage";
import { useStore } from "../store";
import { LiveSessionsGrid, LiveSessionsPopover } from "./LiveSessions";

afterEach(() => {
  cleanup();
  settingsStorage.removeItem("nextbrowser.profileNameSort");
  useStore.setState({ profileNameSort: undefined });
});

it("sorts both profile views by display name while preserving search and profile identity", () => {
  const sessions: LiveSessionOption[] = ["Профиль 10", "Альфа", "профиль 2"].map((label, index) => ({
    label, key: String(index), running: false, target: { runtime: "clawbrowser", profile: String(index) },
  }));
  const open = vi.fn();
  render(<>
    <LiveSessionsGrid sessions={sessions} onOpen={open} />
    <LiveSessionsPopover sessions={sessions} selected onOpen={open} onOverview={vi.fn()} />
  </>);
  const grid = within(screen.getByRole("region", { name: "Profiles" }));
  const cards = () => grid.getAllByRole("button", { name: /^Open / }).map(card => card.getAttribute("data-profile-key"));
  expect(cards()).toEqual(["0", "1", "2"]);
  fireEvent.change(grid.getByRole("searchbox"), { target: { value: "профиль" } });
  fireEvent.click(grid.getByRole("button", { name: "Сортировать" }));
  expect(cards()).toEqual(["2", "0"]);

  fireEvent.pointerEnter(screen.getByRole("button", { name: "Open Profiles" }), { pointerType: "mouse" });
  const flyout = within(screen.getByRole("dialog", { name: "Profiles" }));
  const names = () => flyout.getAllByRole("button", { name: /Stopped/ }).map(b => b.querySelector("strong")?.textContent);
  expect(names()).toEqual(["Альфа", "профиль 2", "Профиль 10"]);
  fireEvent.click(flyout.getByRole("button", { name: "Сортировать · А → Я" }));
  expect(names()).toEqual(["Профиль 10", "профиль 2", "Альфа"]);
  expect(cards()).toEqual(["0", "2"]);
  expect(settingsStorage.getItem("nextbrowser.profileNameSort")).toBe("desc");
  fireEvent.click(flyout.getByRole("button", { name: /профиль 2/ }));
  expect(open).toHaveBeenCalledWith("2");
  expect(sessions.map(s => s.key)).toEqual(["0", "1", "2"]);
});
