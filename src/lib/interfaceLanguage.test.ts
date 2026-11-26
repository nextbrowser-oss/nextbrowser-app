// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../electronBridge";
import { applyLanguage, getLanguage } from "../shared/lib/i18n";
import { readLanguagePreference, resolveInterfaceLanguage, selectInterfaceLanguage } from "./interfaceLanguage";
import { settingsStorage } from "./settingsStorage";

vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const key = "nextbrowser.interfaceLanguage";

afterEach(async () => {
  await applyLanguage("en");
  ipc.mockReset();
  settingsStorage.removeItem(key);
});

describe("interface language preferences", () => {
  it("uses the active layout for new and existing users without a saved preference", async () => {
    ipc.mockResolvedValueOnce(["de-DE", "en-US"]).mockResolvedValue(undefined);
    expect(readLanguagePreference()).toBe("auto");
    await resolveInterfaceLanguage();
    expect(getLanguage()).toBe("de");
    expect(ipc).toHaveBeenCalledWith("app_set_interface_language", { language: "de" });
  });

  it("remembers an explicit preference on restart without querying the keyboard", async () => {
    ipc.mockResolvedValue(undefined);
    await selectInterfaceLanguage("ja");
    await applyLanguage("en");
    await resolveInterfaceLanguage();
    expect(getLanguage()).toBe("ja");
    expect(ipc).not.toHaveBeenCalledWith("app_input_languages");
  });

  it("discards a late keyboard response after an explicit choice", async () => {
    let finish!: (languages: string[]) => void;
    ipc.mockReturnValueOnce(new Promise<string[]>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const pending = resolveInterfaceLanguage("auto");
    await selectInterfaceLanguage("vi");
    finish(["uk-UA"]);
    await pending;
    expect(getLanguage()).toBe("vi");
  });
});
