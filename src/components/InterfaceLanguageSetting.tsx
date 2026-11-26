import { useState } from "react";
import { Select } from "../shared/ui";
import { languageNames, translate, type LanguagePreference } from "../shared/lib/i18n";
import { readLanguagePreference, selectInterfaceLanguage } from "../lib/interfaceLanguage";

export function InterfaceLanguageSetting() {
  const [preference, setPreference] = useState(readLanguagePreference);
  return <div className="settings-row">
    <span className="muted small">{translate("Interface language")}</span>
    <Select label={translate("Interface language")} value={preference}
      options={[{ value: "auto", label: translate("Automatic (keyboard layout)") },
        ...Object.entries(languageNames).map(([value, label]) => ({ value, label }))]}
      onChange={value => {
        const next = value as LanguagePreference;
        setPreference(next);
        void selectInterfaceLanguage(next).catch(error => {
          console.warn("Could not load interface language", error);
          setPreference(readLanguagePreference());
        });
      }} />
  </div>;
}
