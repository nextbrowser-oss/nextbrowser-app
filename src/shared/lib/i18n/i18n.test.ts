import { afterEach, describe, expect, it } from "vitest";
import { applyLanguage, getLanguage, isLanguage, languageNames, matchLanguage, translate } from "./index";

afterEach(() => applyLanguage("en"));

describe("interface language", () => {
  it("uses the first supported input or system language and falls back to English", () => {
    expect(matchLanguage(["fr-CA", "uk-UA", "en-GB"])).toBe("uk");
    expect(matchLanguage(["zh_Hant_TW"])).toBe("zh");
    expect(matchLanguage(["", "fi"])).toBe("en");
    expect(isLanguage("constructor")).toBe(false);
  });

  it("keeps the most recent selection when loading dictionaries overlaps", async () => {
    await Promise.all([applyLanguage("vi"), applyLanguage("en")]);
    expect(getLanguage()).toBe("en");
    expect(translate("Settings")).toBe("Settings");
  });

  it("ships matching message keys and substitution slots in every translation", async () => {
    const files = import.meta.glob<Record<string, string>>("./messages/*.json", { import: "default" });
    const reference = (await files["./messages/ru.json"]());
    const keys = Object.keys(reference).sort();
    expect(keys).toContain("Interface language");
    expect(Object.keys(files)).toHaveLength(Object.keys(languageNames).length - 1);
    const slots = (s: string) => (s.match(/%[1-9]\d*/g) || []).sort().join(",");
    for (const [file, load] of Object.entries(files)) {
      const messages = await load();
      expect(Object.keys(messages).sort()).toEqual(keys);
      const invalid = keys.filter(k => !messages[k].trim() || slots(k) !== slots(messages[k]));
      expect(invalid, file).toEqual([]);
    }
  });

  it("keeps user input literal, including dollar signs and strings that resemble placeholders", async () => {
    await applyLanguage("ru");
    expect(translate("Settings")).toBe("Настройки");
    expect(translate("Failed checks: %1.", "$& %1 Settings")).toContain("$& %1 Settings");
    expect(translate("An unknown message")).toBe("An unknown message");
  });
});
