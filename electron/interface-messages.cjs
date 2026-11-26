const languages = new Set(["en", "ru", "de", "ja", "zh", "uk", "vi", "tr"]);
let messages = {};

function setInterfaceLanguage(language) {
  if (!languages.has(language)) throw Error("Unknown interface language.");
  messages = language === "en" ? {} : require(`../src/shared/lib/i18n/messages/${language}.json`);
}

function translate(source, ...values) {
  const text = Object.hasOwn(messages, source) ? messages[source] : source;
  return text.replace(/%([1-9]\d*)/g, (slot, index) =>
    Number(index) <= values.length ? String(values[Number(index) - 1]) : slot);
}

module.exports = { setInterfaceLanguage, translate };
