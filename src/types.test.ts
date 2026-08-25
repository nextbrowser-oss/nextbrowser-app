import { describe, expect, it } from "vitest";
import {
  clampWatchlistInterval,
  conversationPreview,
  humanBytes,
  normalizeWatchHandle,
  parseWatchState,
  weekdaysSummary,
  type Conversation,
} from "./types";
import { countryFlag, countryLabel, filterCountries, ROTATION_COUNTRIES } from "./lib/countryFlag";
import { normalizeNextctlVersion } from "./lib/version";

const conversation = (messages: Conversation["messages"]): Conversation => ({
  id: "c", title: "Test", agent: "claude", messages, createdAt: 0, updatedAt: 0,
});

describe("Swift-compatible model helpers", () => {
  it("normalizes nextctl version output for the footer", () => {
    expect(normalizeNextctlVersion("nextctl 1.2.0\n")).toBe("1.2.0");
    expect(normalizeNextctlVersion("nbc 1.0.1\n")).toBe("1.0.1");
    expect(normalizeNextctlVersion("1.2.0")).toBe("1.2.0");
  });
  it("prefers the last non-system command chip in conversation previews", () => {
    expect(conversationPreview(conversation([
      { id: "1", role: "user", text: "full internal prompt", status: "done", createdAt: 0,
        commandChip: { kind: "skill", title: "Cian listings" } },
      { id: "2", role: "system", text: "ignored", status: "done", createdAt: 1 },
    ]))).toBe("▸ Cian listings");
  });

  it("matches weekday summaries and ISO country formatting", () => {
    expect(weekdaysSummary([2, 3, 4, 5, 6])).toBe("Mon–Fri");
    expect(weekdaysSummary([1, 7])).toBe("Weekends");
    expect(countryFlag("es")).toBe("🇪🇸");
    expect(countryLabel("es", "Madrid")).toBe("🇪🇸 ES Madrid");
    expect(ROTATION_COUNTRIES).toHaveLength(249);
    expect(new Set(ROTATION_COUNTRIES.map((country) => country.code)).size).toBe(249);
    expect(filterCountries("cote").map((country) => country.code)).toContain("CI");
    expect(filterCountries("united").map((country) => country.code)).toEqual(expect.arrayContaining(["GB", "US"]));
    expect(filterCountries("jp").map((country) => country.code)).toEqual(["JP"]);
    expect(ROTATION_COUNTRIES.map((c) => c.name)).toEqual(
      [...ROTATION_COUNTRIES.map((c) => c.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    );
  });

  it("labels binary byte units accurately", () => {
    expect(humanBytes(1_000)).toBe("1000 B");
    expect(humanBytes(1_024)).toBe("1 KiB");
    expect(humanBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
    expect(humanBytes(1024 * 1024 * 1024)).toBe("1 GiB");
  });
});

describe("watched profile handles", () => {
  it("accepts what a user actually pastes and rejects the rest", () => {
    expect(normalizeWatchHandle(" @NextBrowser ")).toBe("NextBrowser");
    expect(normalizeWatchHandle("https://x.com/nextbrowser")).toBe("nextbrowser");
    expect(normalizeWatchHandle("https://x.com/@nextbrowser/")).toBe("nextbrowser");
    expect(normalizeWatchHandle("x.com/nextbrowser?lang=en")).toBe("nextbrowser");
    expect(normalizeWatchHandle("sixteen_char_handle_x")).toBe("");
    expect(normalizeWatchHandle("has spaces")).toBe("");
    expect(normalizeWatchHandle("")).toBe("");
  });
});

describe("watchlist intervals", () => {
  it("snaps any stored value onto the offered choices", () => {
    expect(clampWatchlistInterval(1)).toBe(1);
    expect(clampWatchlistInterval(2)).toBe(2);
    expect(clampWatchlistInterval(15)).toBe(20);
    expect(clampWatchlistInterval(0)).toBe(1);
    expect(clampWatchlistInterval(999)).toBe(20);
    expect(clampWatchlistInterval(Number.NaN)).toBe(2);
  });
});

describe("agent watch state file", () => {
  it("reads the reports an agent recorded and keeps the panel usable", () => {
    const { reports } = parseWatchState(JSON.stringify({
      version: 1,
      handles: [
        { handle: "@NextBrowser", following: true, notifications: true, last_post_id: "1899", last_checked_at: "2026-08-25T09:40:00Z", replies_sent: 3, last_reply_url: "https://x.com/me/status/1900" },
        { handle: "not a handle", notifications: true },
      ],
    }));
    expect(Object.keys(reports)).toEqual(["nextbrowser"]);
    expect(reports.nextbrowser).toMatchObject({
      handle: "NextBrowser",
      following: true,
      notifications: true,
      lastPostId: "1899",
      repliesSent: 3,
      lastReplyUrl: "https://x.com/me/status/1900",
    });
    expect(reports.nextbrowser.lastCheckedAt).toBe(Date.parse("2026-08-25T09:40:00Z"));
  });

  it("survives a missing, malformed, or differently shaped file", () => {
    expect(parseWatchState(null).reports).toEqual({});
    expect(parseWatchState("{ half written").reports).toEqual({});
    expect(parseWatchState(JSON.stringify({ handles: { nextbrowser: { notifications: false } } })).reports)
      .toMatchObject({ nextbrowser: { handle: "nextbrowser", notifications: false } });
    expect(parseWatchState(JSON.stringify({ handles: [{ handle: "a", last_reply_url: "javascript:alert(1)" }] })).reports.a.lastReplyUrl)
      .toBeUndefined();
  });
});
