import { describe, expect, it } from "vitest";
import { userFacingMultiloginError } from "./userFacingMultiloginError";

describe("userFacingMultiloginError", () => {
  it("explains a workspace without the default browser folder", () => {
    const message = userFacingMultiloginError(
      new Error(`Error invoking remote method 'nextbrowser:invoke': Error: multilogin workspace has no "Default folder" browser folder; pass --multilogin-folder-id`),
    );

    expect(message).toContain("no \"Default folder\" for browser profiles");
    expect(message).toContain("Create that folder in Multilogin");
    expect(message).not.toContain("--multilogin-folder-id");
    expect(message).not.toContain("remote method");
  });

  it("names cloud phones when the mobile folder is missing", () => {
    const message = userFacingMultiloginError(
      new Error(`multilogin workspace has no "Default folder" mobile folder; pass --multilogin-folder-id`),
      "mobile",
    );

    expect(message).toContain("cloud phones");
  });

  it("asks for a rename when several default folders exist", () => {
    const message = userFacingMultiloginError(new Error('multilogin workspace has multiple "Default folder" browser folders; pass --multilogin-folder-id'));

    expect(message).toContain("more than one");
    expect(message).toContain("Rename");
  });

  it("points expired tokens at reconnecting", () => {
    expect(userFacingMultiloginError(new Error("Multilogin automation token is invalid or expired")))
      .toBe("The Multilogin token expired. Reconnect Multilogin with a fresh token.");
  });

  it("keeps an unknown message but hides local paths", () => {
    expect(userFacingMultiloginError(new Error("mimic core failed; see /Users/someone/Library/logs/mlx.log")))
      .toBe("mimic core failed; see the local diagnostic log");
  });

  it("falls back when there is no message at all", () => {
    expect(userFacingMultiloginError(new Error(""))).toBe("Multilogin did not respond. Try again.");
  });
});
