/** Interface copy only. The English source is also the offline fallback. */
export const languageNames = {
  en: "English", ru: "Русский", de: "Deutsch", ja: "日本語",
  zh: "简体中文", uk: "Українська", vi: "Tiếng Việt", tr: "Türkçe",
} as const;
export type Language = keyof typeof languageNames;
export type LanguagePreference = Language | "auto";
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(languageNames, value);
}

export function matchLanguage(candidates: readonly string[]): Language {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const code = candidate.trim().toLowerCase().split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return "en";
}

type Messages = Record<string, string>;
const catalogues = {
  ru: () => import("./messages/ru.json"), de: () => import("./messages/de.json"),
  ja: () => import("./messages/ja.json"), zh: () => import("./messages/zh.json"),
  uk: () => import("./messages/uk.json"), vi: () => import("./messages/vi.json"),
  tr: () => import("./messages/tr.json"),
};
const listeners = new Set<() => void>();
let active: Language = "en";
let messages: Messages = {};
let request = 0;
export const getLanguage = () => active;
export const formattingLocale = () => active === "zh" ? "zh-CN" : active;
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function applyLanguage(language: Language) {
  const revision = ++request;
  const next = language === "en" ? {} : (await catalogues[language]()).default;
  if (revision !== request) return;
  if (typeof document !== "undefined") document.documentElement.lang = language === "zh" ? "zh-Hans" : language;
  if (active === language) return;
  messages = next;
  active = language;
  listeners.forEach(listener => listener());
}

/** Arguments are substituted only after lookup. User text, paths and names stay literal. */
export function translate(source: string, ...values: unknown[]): string {
  const text = Object.prototype.hasOwnProperty.call(messages, source) ? messages[source] : source;
  return values.length ? text.replace(/%([1-9]\d*)/g, (slot, number) =>
    Number(number) <= values.length ? String(values[Number(number) - 1]) : slot) : text;
}
