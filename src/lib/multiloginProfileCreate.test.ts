import { describe, expect, it } from "vitest";
import {
  multiloginConnected,
  multiloginCreateCountry,
  multiloginProfileSelection,
  multiloginSubmitError,
  multiloginSubmitLabel,
} from "./multiloginProfileCreate";

describe("multiloginConnected", () => {
  it("requires both a stored token and a validated one", () => {
    expect(multiloginConnected({ connected: true, valid: true, secureStorageAvailable: true })).toBe(true);
    expect(multiloginConnected({ connected: true, valid: false, secureStorageAvailable: true })).toBe(false);
    expect(multiloginConnected({ connected: false, valid: false, secureStorageAvailable: true })).toBe(false);
    expect(multiloginConnected(null)).toBe(false);
  });
});

describe("multiloginCreateCountry", () => {
  it("passes a normalized country only for a managed proxy", () => {
    expect(multiloginCreateCountry("managed", "us")).toBe("US");
    expect(multiloginCreateCountry("managed", "USA")).toBe("");
    expect(multiloginCreateCountry("direct", "US")).toBe("");
    expect(multiloginCreateCountry("personal", "US")).toBe("");
  });
});

describe("multiloginProfileSelection", () => {
  it("keeps the folder that scopes a Multilogin profile", () => {
    expect(multiloginProfileSelection("browser", { id: "p1", name: "Shop US", folderId: "f1" }))
      .toEqual({ kind: "browser", id: "p1", name: "Shop US", folderId: "f1" });
    expect(multiloginProfileSelection("mobile", { id: "17", name: "Android US" }))
      .toEqual({ kind: "mobile", id: "17", name: "Android US", folderId: undefined });
  });
});

describe("multiloginSubmitError", () => {
  it("requires a chosen profile when linking an existing one", () => {
    expect(multiloginSubmitError("existing", "managed", "US")).toBe("Choose a Multilogin profile.");
    expect(multiloginSubmitError("existing", "managed", "US", { kind: "browser", id: "p1", name: "Shop US" }))
      .toBeUndefined();
  });

  it("requires a country only when creating behind the managed proxy", () => {
    expect(multiloginSubmitError("new", "managed", "")).toBe("Choose a valid proxy country.");
    expect(multiloginSubmitError("new", "managed", "US")).toBeUndefined();
    expect(multiloginSubmitError("new", "direct", "")).toBeUndefined();
  });
});

describe("multiloginSubmitLabel", () => {
  it("names the action for each mode", () => {
    expect(multiloginSubmitLabel("new")).toBe("Create profile");
    expect(multiloginSubmitLabel("existing")).toBe("Use profile");
  });
});
