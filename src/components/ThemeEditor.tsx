import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../shared/ui";
import { colorFields, readWallpaper, type Appearance, type ColorField, type UpdateAppearance } from "../lib/appearance";
import type { Theme } from "../theme";

const patterns = [
  { value: "glow", label: "Glow" },
  { value: "solid", label: "Solid" },
  { value: "gradient", label: "Gradient" },
  { value: "dots", label: "Dots" },
] as const;
const fields = Object.keys(colorFields) as ColorField[];

export function ThemeEditor({ mode, appearance, updateAppearance }: {
  mode: Theme; appearance: Appearance; updateAppearance: UpdateAppearance;
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
      if (id === request.current) setError(reason instanceof Error ? reason.message : "Could not open this image.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  return <>
    <span hidden ref={sample} data-palette={mode} className="settings-theme-sample" />
    <section className="theme-chat-preview" aria-label={name + " chat preview"}>
      <div className="msg-user-bubble">Summarize this page for me.</div>
      <div className="assistant-bubble">Here are the highlights.</div>
    </section>
    <fieldset className="theme-editor-section">
      <legend>{name} colors</legend>
      <div className="theme-color-fields">
        {fields.map(key => <label className="theme-color-field" key={key}>
          <span>{colorFields[key].label}</span>
          {defaults[key] && <input type="color" value={appearance[key] ?? (key === "outgoing" ? appearance.accent : undefined) ?? defaults[key]}
            onChange={event => updateAppearance({ [key]: event.target.value })} />}
        </label>)}
      </div>
    </fieldset>
    <fieldset className="theme-editor-section">
      <legend>Wallpaper</legend>
      <div className="theme-patterns">
        {patterns.map(pattern => <Button key={pattern.value} disabled={loading} aria-pressed={wallpaper === pattern.value}
          onClick={() => updateAppearance({ wallpaper: pattern.value })}>{pattern.label}</Button>)}
        {appearance.photo && <Button disabled={loading} aria-pressed={wallpaper === "photo"}
          onClick={() => updateAppearance({ wallpaper: "photo" })}>My photo</Button>}
        <Button disabled={loading} onClick={() => upload.current?.click()}>{loading ? "Opening…" : appearance.photo ? "Change photo…" : "Choose photo…"}</Button>
        <input type="file" ref={upload} hidden accept="image/png,image/jpeg,image/webp" aria-label="Wallpaper image"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choosePhoto(file); }} />
      </div>
      {wallpaper === "gradient" && defaults.outgoing && <label className="theme-color-field theme-gradient-end">
        <span>Gradient end</span>
        <input type="color" value={appearance.gradientEnd ?? appearance.accent ?? defaults.outgoing}
          onChange={event => updateAppearance({ gradientEnd: event.target.value })} />
      </label>}
      {error && <p className="error small" role="alert">{error}</p>}
    </fieldset>
    <label className="theme-radius">
      <span>Bubble corners</span>
      <input type="range" min="4" max="28" value={radius} aria-valuetext={radius + " pixels"}
        onChange={event => updateAppearance({ radius: event.target.valueAsNumber })} />
      <output>{radius} px</output>
    </label>
    <Button className="theme-reset" disabled={!Object.keys(appearance).length || loading}
      onClick={() => { setError(""); updateAppearance(null); }}>Reset {mode} appearance</Button>
  </>;
}
