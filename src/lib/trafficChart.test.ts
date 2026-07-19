import { describe, expect, it } from "vitest";
import {
  formatHistoryDateLabel,
  sortTrafficHistoryPoints,
  trafficChartMaximumBytes,
  trafficChartTickIndices,
} from "./trafficChart";

describe("traffic chart labels", () => {
  it("formats NodeMaven dotted dates without the year", () => {
    expect(formatHistoryDateLabel("2026.07.05", "en-US")).toBe("Jul 5");
    expect(formatHistoryDateLabel("2026-07-19", "en-US")).toBe("Jul 19");
  });

  it("keeps an unknown label intact", () => {
    expect(formatHistoryDateLabel("Current period", "en-US")).toBe("Current period");
  });

  it("orders dated points from oldest to newest without mutating the response", () => {
    const response = [
      { label: "2026.07.19", used_bytes: 19 },
      { label: "2026.07.13", used_bytes: 13 },
      { label: "2026.07.16", used_bytes: 16 },
    ];

    expect(sortTrafficHistoryPoints(response).map(({ label }) => label)).toEqual([
      "2026.07.13",
      "2026.07.16",
      "2026.07.19",
    ]);
    expect(response.map(({ label }) => label)).toEqual([
      "2026.07.19",
      "2026.07.13",
      "2026.07.16",
    ]);
  });

  it("preserves response order when labels are not dates", () => {
    const response = [{ label: "Today" }, { label: "Yesterday" }];
    expect(sortTrafficHistoryPoints(response)).toEqual(response);
  });
});

describe("traffic chart scale", () => {
  it("selects evenly distributed ticks including both ends", () => {
    expect(trafficChartTickIndices(14)).toEqual([0, 2, 4, 7, 9, 11, 13]);
    expect(trafficChartTickIndices(3)).toEqual([0, 1, 2]);
  });

  it("rounds the traffic ceiling to a readable binary unit", () => {
    expect(trafficChartMaximumBytes(9.5 * 1024 * 1024)).toBe(10 * 1024 * 1024);
    expect(trafficChartMaximumBytes(0)).toBe(1);
  });
});
