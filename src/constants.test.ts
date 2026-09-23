import { describe, expect, it } from "vitest";
import { discordUrl } from "./constants";

describe("support links", () => {
  it("uses the current Nextbrowser Discord invite", () => {
    expect(discordUrl).toBe("https://discord.com/invite/gHXEvkGXnz");
  });
});
