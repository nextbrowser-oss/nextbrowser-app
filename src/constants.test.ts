import { describe, expect, it } from "vitest";
import { discordUrl } from "./constants";

describe("support links", () => {
  it("uses the current NextBrowser Discord invite", () => {
    expect(discordUrl).toBe("https://discord.gg/qnKUKMvGB9");
  });
});
