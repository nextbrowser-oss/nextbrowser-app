import type { Theme, ThemePreference } from "../theme";
import "./themePicker.css";

const choices = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

function ThemeSample({ palette }: { palette: Theme }) {
  return <span className="settings-theme-sample" data-palette={palette} />;
}

export function ThemePicker({ value, onChange }: { value: ThemePreference; onChange: (next: ThemePreference) => void }) {
  return (
    <fieldset className="settings-theme-picker">
      <legend>Theme</legend>
      <div className="settings-theme-choices">
        {choices.map((choice) => (
          <label key={choice.value} className="settings-theme-choice">
            <span className="settings-theme-preview" aria-hidden="true">
              <ThemeSample palette={choice.value === "dark" ? "dark" : "light"} />
              {choice.value === "system" && <ThemeSample palette="dark" />}
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
