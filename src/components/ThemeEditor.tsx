import { translate } from "../shared/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../shared/ui";
import { colorFields, readWallpaper, type Appearance, type ColorField, type UpdateAppearance } from "../lib/appearance";
import type { Theme } from "../theme";

const patterns = [
  { value: "glow", get label() { return translate("Glow"); } },
  { value: "solid", get label() { return translate("Solid"); } },
  { value: "gradient", get label() { return translate("Gradient"); } },
  { value: "dots", get label() { return translate("Dots"); } },
] as const;
const fields = Object.keys(colorFields) as ColorField[];
export function ThemeColorFields({ control, readOnly = false }: { control: (key: ColorField) => ReactNode; readOnly?: boolean }) {
  const Field = readOnly ? "div" : "label";
  return <div className="theme-color-fields">{fields.map(key => <Field className="theme-color-field" key={key}>
    <span>{colorFields[key].label}</span>{control(key)}
  </Field>)}</div>;
}

export function ThemeEditor({ mode, appearance, canReset, updateAppearance }: {
  mode: Theme; appearance: Appearance; canReset: boolean; updateAppearance: UpdateAppearance;
}) {
  const sample = useRef<HTMLSpanElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const [defaults, setDefaults] = useState<Partial<Record<ColorField, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wallpaper = appearance.wallpaper ?? "glow";
  const radius = appearance.radius ?? 20;
  const name = mode === "light" ? "Light" : "Dark";

  useLayoutEffect(() => {
    if (!sample.current) return;
    const palette = getComputedStyle(sample.current);
    setDefaults(Object.fromEntries(fields.map(key => [key, palette.getPropertyValue(colorFields[key].token).trim()])));
  }, [mode]);
  useEffect(() => () => { request.current++; }, []);

  async function choosePhoto(file: File) {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const photo = await readWallpaper(file);
      if (id === request.current) updateAppearance({ photo, wallpaper: "photo" });
    } catch (reason) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : translate("Could not open this image."));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  return <>
    <span hidden ref={sample} data-palette={mode} className="settings-theme-sample" />
    <fieldset className="theme-editor-section">
      <legend>{name} {translate("colors")}</legend>
      <ThemeColorFields control={key => defaults[key] && <input type="color"
        value={appearance[key] ?? (key === "outgoing" ? appearance.accent : undefined) ?? defaults[key]}
        onChange={event => updateAppearance({ [key]: event.target.value })} />} />
    </fieldset>
    <fieldset className="theme-editor-section">
      <legend>{translate("Wallpaper")}</legend>
      <div className="theme-patterns">
        {patterns.map(pattern => <Button key={pattern.value} disabled={loading} aria-pressed={wallpaper === pattern.value}
          onClick={() => updateAppearance({ wallpaper: pattern.value })}>{pattern.label}</Button>)}
        {appearance.photo && <Button disabled={loading} aria-pressed={wallpaper === "photo"}
          onClick={() => updateAppearance({ wallpaper: "photo" })}>{translate("My photo")}</Button>}
        <Button disabled={loading} onClick={() => upload.current?.click()}>{loading ? translate("Opening…") : appearance.photo ? translate("Change photo…") : translate("Choose photo…")}</Button>
        <input type="file" ref={upload} hidden accept="image/png,image/jpeg,image/webp" aria-label={translate("Wallpaper image")}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choosePhoto(file); }} />
      </div>
      {wallpaper === "gradient" && defaults.outgoing && <label className="theme-color-field theme-gradient-end">
        <span>{translate("Gradient end")}</span>
        <input type="color" value={appearance.gradientEnd ?? appearance.accent ?? defaults.outgoing}
          onChange={event => updateAppearance({ gradientEnd: event.target.value })} />
      </label>}
      {error && <p className="error small" role="alert">{error}</p>}
    </fieldset>
    <label className="theme-radius">
      <span>{translate("Bubble corners")}</span>
      <input type="range" min="4" max="28" value={radius} aria-valuetext={radius + " pixels"}
        onChange={event => updateAppearance({ radius: event.target.valueAsNumber })} />
      <output>{radius} {translate("px")}</output>
    </label>
    <Button className="theme-reset" disabled={!canReset || loading}
      onClick={() => { setError(""); updateAppearance(null); }}>{translate("Reset")} {mode} {translate("appearance")}</Button>
  </>;
}
