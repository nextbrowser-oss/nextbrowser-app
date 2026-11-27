import { describe, expect, it } from "vitest";
import { accountAvatarHues, accountDisplayName, accountInitials } from "./accountAvatar";

describe("account avatar", () => {
  it("prefers the trimmed account name and falls back to the email local part", () => {
    expect(accountDisplayName("  Север  ", "other@example.com")).toBe("Север");
    expect(accountDisplayName(" ", " lee.park@example.com ")).toBe("lee.park");
    expect(accountDisplayName()).toBe("");
  });
  it("uses initials from nicknames and names in different scripts", () => {
    expect(accountInitials("@север")).toBe("СЕ");
    expect(accountInitials("Ana María Núñez")).toBe("AN");
    expect(accountInitials("a\u0301.lvarez")).toBe("ÁL");
    expect(accountInitials("林田")).toBe("林田");
    expect(accountInitials("...")).toBe("");
  });
  it("derives both hues from the normalized owner ID alone", () => {
    const id = "18259a1e-9e88-4d3c-8655-6119f75b1599";
    expect(accountAvatarHues(id)).toEqual(accountAvatarHues(id.toUpperCase()));
    expect(accountAvatarHues(id)).not.toEqual(accountAvatarHues("ea0b1f65-010b-4dec-a77c-c24a3070ce3e"));
  });
});
