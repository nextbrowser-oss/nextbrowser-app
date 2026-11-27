// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { activityChanged, localDay, observeAccountActivity, readActivity, recentActivity } from "./accountActivity";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

it("reads existing local history before a worker snapshot arrives", () => {
  const day = localDay(Date.now());
  localStorage.setItem("nextbrowser.accountActivity.existing", JSON.stringify({ first: day, lastVisit: 1, days: { [day]: { ms: 12000, sessions: 1 } } }));
  expect(recentActivity("existing")).toEqual([{label: day, ms: 12000, sessions: 1}]);
});

it("updates the graph only for the tracked account and unsubscribes on logout", () => {
  const track = vi.fn(), unsubscribe = vi.fn(), changed = vi.fn();
  let receive!: (data: unknown) => void;
  vi.stubGlobal("nextbrowser", {trackAccountActivity: track, on: (_: string, fn: typeof receive) => { receive = fn; return unsubscribe; }});
  window.addEventListener(activityChanged, changed);
  const stop = observeAccountActivity("first");
  const log = {first: "2026-11-25", lastVisit: 20000, days: {"2026-11-25": {ms: 17000, sessions: 1}}};
  receive({owner: "another", log});
  expect(changed).not.toHaveBeenCalled();
  receive({owner: "first", log});
  expect(readActivity("first")).toEqual(log);
  expect(changed).toHaveBeenCalledOnce();
  stop();
  expect(track.mock.calls).toEqual([["first"], [null]]);
  expect(unsubscribe).toHaveBeenCalledOnce();
  window.removeEventListener(activityChanged, changed);
});
