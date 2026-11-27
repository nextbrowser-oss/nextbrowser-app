import { describe, expect, it } from "vitest";
import { tooltipPosition, type TooltipSide } from "./tooltipPosition";

const viewport = { width: 800, height: 600 };
const size = { width: 160, height: 60 };
const rect = (left: number, top: number) => ({ left, top, right: left + 40, bottom: top + 40, width: 40, height: 40 });

describe("tooltip viewport placement", () => {
  it.each(["top", "right", "bottom", "left"] as TooltipSide[])("honors %s when it fits", side => {
    expect(tooltipPosition(rect(380, 280), size, viewport, side).side).toBe(side);
  });
  it.each([
    ["left", 0, 280, "right"], ["right", 760, 280, "left"],
    ["top", 380, 0, "bottom"], ["bottom", 380, 560, "top"],
  ] as const)("flips %s at the viewport edge", (side, left, top, expected) => {
    expect(tooltipPosition(rect(left, top), size, viewport, side).side).toBe(expected);
  });
  it.each([[0, 0], [760, 0], [0, 560], [760, 560]])("keeps a corner hint within the viewport (%i,%i)", (left, top) => {
    const position = tooltipPosition(rect(left, top), size, viewport, "top");
    expect(position.left).toBeGreaterThanOrEqual(8);
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(position.top + size.height).toBeLessThanOrEqual(viewport.height - 8);
  });
  it("uses the largest available space when neither preferred side fits", () => {
    expect(tooltipPosition(rect(380, 580), { width: 500, height: 80 }, { width: 800, height: 1200 }, "left").side).toBe("top");
  });
});
