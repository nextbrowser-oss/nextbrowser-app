import { describe, expect, it } from "vitest";
import { setMultiloginSelection } from "./multiloginSelection";
import {
  clearAllSelectedProfiles,
  forgetSelectedProfileName,
  forgetWorkspaceSelectedProfile,
  rememberSelectedProfile,
  rememberedSelectedProfile,
} from "./selectedProfileMemory";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const work = { id: "work", profileNames: ["US shop", "DE shop"] };
const personal = { id: "personal", profileNames: ["Home"] };

describe("selected profile memory", () => {
  it("remembers the selected profile per workspace", () => {
    const storage = memoryStorage();
    rememberSelectedProfile("work", "DE shop", storage);
    rememberSelectedProfile("personal", "Home", storage);

    expect(rememberedSelectedProfile(work, storage)).toBe("DE shop");
    expect(rememberedSelectedProfile(personal, storage)).toBe("Home");
  });

  it("remembers the agent default as no profile", () => {
    const storage = memoryStorage();
    rememberSelectedProfile("work", "DE shop", storage);
    rememberSelectedProfile("work", undefined, storage);

    expect(rememberedSelectedProfile(work, storage)).toBeUndefined();
  });

  it("does not restore a profile that left the workspace", () => {
    const storage = memoryStorage();
    rememberSelectedProfile("work", "Old shop", storage);

    expect(rememberedSelectedProfile(work, storage)).toBeUndefined();
    expect(rememberedSelectedProfile(undefined, storage)).toBeUndefined();
  });

  it("yields to the workspace's active Multilogin profile", () => {
    const storage = memoryStorage();
    rememberSelectedProfile("work", "US shop", storage);
    setMultiloginSelection("work", { kind: "browser", id: "ml-1", name: "Multilogin US" }, storage);
    expect(rememberedSelectedProfile(work, storage)).toBeUndefined();

    setMultiloginSelection("work", { kind: "browser", id: "ml-1", name: "Multilogin US", active: false }, storage);
    expect(rememberedSelectedProfile(work, storage)).toBe("US shop");
  });

  it("forgets a deleted profile in every workspace and nothing else", () => {
    const storage = memoryStorage();
    rememberSelectedProfile("work", "US shop", storage);
    rememberSelectedProfile("other", "US shop", storage);
    rememberSelectedProfile("personal", "Home", storage);

    forgetSelectedProfileName("US shop", storage);

    expect(rememberedSelectedProfile(work, storage)).toBeUndefined();
    expect(rememberedSelectedProfile({ id: "other", profileNames: ["US shop"] }, storage)).toBeUndefined();
    expect(rememberedSelectedProfile(personal, storage)).toBe("Home");
  });

  it("forgets a deleted workspace and clears every workspace on account switch", () => {
    const storage = memoryStorage();
    storage.setItem("unrelated", "kept");
    rememberSelectedProfile("work", "US shop", storage);
    rememberSelectedProfile("personal", "Home", storage);

    forgetWorkspaceSelectedProfile("work", storage);
    expect(rememberedSelectedProfile(work, storage)).toBeUndefined();
    expect(rememberedSelectedProfile(personal, storage)).toBe("Home");

    clearAllSelectedProfiles(storage);
    expect(rememberedSelectedProfile(personal, storage)).toBeUndefined();
    expect(storage.getItem("unrelated")).toBe("kept");
  });

  it("keeps working when storage is unavailable", () => {
    const broken = {
      ...memoryStorage(),
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    } as Storage;

    expect(() => rememberSelectedProfile("work", "US shop", broken)).not.toThrow();
    expect(rememberedSelectedProfile(work, broken)).toBeUndefined();
  });
});
