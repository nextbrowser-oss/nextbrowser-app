import { describe, expect, it } from "vitest";
import { conversationPreview, weekdaysSummary, type Conversation } from "./types";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "./lib/countryFlag";
import { normalizeClawctlVersion } from "./lib/version";

const conversation = (messages: Conversation["messages"]): Conversation => ({
  id: "c", title: "Test", agent: "claude", messages, createdAt: 0, updatedAt: 0,
});

describe("Swift-compatible model helpers", () => {
  it("normalizes clawctl version output for the footer", () => {
    expect(normalizeClawctlVersion("clawctl 1.2.0\n")).toBe("1.2.0");
    expect(normalizeClawctlVersion("1.2.0")).toBe("1.2.0");
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
    expect(ROTATION_COUNTRIES.map((c) => c.name)).toEqual(
      [...ROTATION_COUNTRIES.map((c) => c.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    );
  });
});
