import type { Theme, ThemePreference } from "../theme";
import { appearanceTokens, type Appearance } from "../lib/appearance";
import "./themePicker.css";

const choices = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function ThemeSample({ mode, appearance }: { mode: Theme; appearance: Appearance }) {
  return <span className="settings-theme-sample" data-palette={mode} style={appearanceTokens(appearance)} />;
}

export function ThemePicker({ value, onChange, palettes }: {
  value: ThemePreference; onChange: (next: ThemePreference) => void; palettes: Record<Theme, Appearance>;
}) {
  return (
    <fieldset className="settings-theme-picker">
      <legend>Theme</legend>
      <div className="settings-theme-choices">
        {choices.map((choice) => (
          <label key={choice.value} className="settings-theme-choice">
            <span className="settings-theme-preview" aria-hidden="true">
              {choice.value !== "dark" && <ThemeSample mode="light" appearance={palettes.light} />}
              {choice.value !== "light" && <ThemeSample mode="dark" appearance={palettes.dark} />}
            </span>
            <span className="settings-theme-caption">
              <input type="radio" name="appearance-theme" checked={value === choice.value} value={choice.value} onChange={() => onChange(choice.value)} />
              {choice.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
