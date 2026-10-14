import { describe, expect, it } from "vitest";
import {
  activeMultiloginSelectionForWorkspace,
  clearAllMultiloginSelections,
  deactivateMultiloginSelection,
  multiloginSelectionForWorkspace,
  setMultiloginSelection,
} from "./multiloginSelection";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("Multilogin workspace selection", () => {
  it("persists a browser profile per workspace", () => {
    const storage = memoryStorage();
    setMultiloginSelection("work", {
      kind: "browser",
      id: "browser-1",
      name: "Amazon US",
      folderId: "folder-1",
    }, storage);

    expect(multiloginSelectionForWorkspace("work", storage)).toEqual({
      kind: "browser",
      id: "browser-1",
      name: "Amazon US",
      folderId: "folder-1",
    });
    expect(multiloginSelectionForWorkspace("other", storage)).toBeUndefined();
  });

  it("clears all saved Multilogin selections", () => {
    const storage = memoryStorage();
    setMultiloginSelection("one", { kind: "mobile", id: "1", name: "Phone" }, storage);
    setMultiloginSelection("two", { kind: "browser", id: "2", name: "Browser" }, storage);

    clearAllMultiloginSelections(storage);

    expect(multiloginSelectionForWorkspace("one", storage)).toBeUndefined();
    expect(multiloginSelectionForWorkspace("two", storage)).toBeUndefined();
  });

  it("keeps the profile in the workspace when another profile becomes the active target", () => {
    const storage = memoryStorage();
    setMultiloginSelection("work", { kind: "browser", id: "browser-1", name: "Amazon US" }, storage);
    deactivateMultiloginSelection("work", storage);
    expect(multiloginSelectionForWorkspace("work", storage)).toMatchObject({ id: "browser-1", active: false });
    expect(activeMultiloginSelectionForWorkspace("work", storage)).toBeUndefined();
    setMultiloginSelection("work", { kind: "browser", id: "browser-1", name: "Amazon US" }, storage);
    expect(activeMultiloginSelectionForWorkspace("work", storage)).toMatchObject({ id: "browser-1" });
  });
});
