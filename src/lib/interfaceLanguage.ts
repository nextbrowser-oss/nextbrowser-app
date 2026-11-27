import { invoke } from "../electronBridge";
import { applyLanguage, isLanguage, matchLanguage, type Language, type LanguagePreference } from "../shared/lib/i18n";
import { settingsStorage } from "./settingsStorage";

const key = "nextbrowser.interfaceLanguage";
let selection = 0;

export function readLanguagePreference(): LanguagePreference {
  const saved = settingsStorage.getItem(key);
  return isLanguage(saved) ? saved : "auto";
}

export async function resolveInterfaceLanguage(preference = readLanguagePreference()) {
  const revision = ++selection;
  let language: Language;
  if (preference === "auto") {
    const system = await invoke<string[]>("app_input_languages").catch(() => []);
    language = matchLanguage([...(Array.isArray(system) ? system : []), ...(navigator.languages || [navigator.language])]);
  } else {
    language = preference;
  }
  if (revision !== selection) return;
  await applyLanguage(language);
  if (revision === selection) {
    await invoke("app_set_interface_language", { language }).catch(() => {});
  }
}

export async function selectInterfaceLanguage(preference: LanguagePreference) {
  const previous = readLanguagePreference();
  settingsStorage.setItem(key, preference);
  try {
    await resolveInterfaceLanguage(preference);
  } catch (error) {
    if (readLanguagePreference() === preference) settingsStorage.setItem(key, previous);
    throw error;
  }
}
