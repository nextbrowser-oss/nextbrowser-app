import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button, IconButton, Select } from "../shared/ui";
import { defaultPreset } from "../lib/themePresets";
import type { useAppearance } from "../lib/useAppearance";

type Props = Omit<ReturnType<typeof useAppearance>, "appearance" | "updateAppearance">;
const createOption = { value: ":create", label: "+ Create theme…" };

export function ThemePresets({ library, selectPreset, createPreset, renamePreset, deletePreset, saveError }: Props) {
  const [action, setAction] = useState<"create" | "rename" | "delete" | null>(null);
  const [name, setName] = useState("");
  const presets = [defaultPreset, ...library.presets];
  const current = presets.find(preset => preset.id === library.activeId) ?? defaultPreset;
  const cleanName = name.trim();
  const duplicate = presets.some(preset => !(action === "rename" && preset.id === current.id)
    && preset.name.toLowerCase() === cleanName.toLowerCase());

  return <fieldset className="theme-editor-section theme-presets">
    <legend>Saved themes</legend>
    <div className="theme-preset-controls">
      <Select label="Saved theme" value={current.id} disabled={!!action}
        options={[...presets.map(preset => ({ value: preset.id, label: preset.name })), createOption]}
        onChange={id => {
          if (id === createOption.value) {
            setName("");
            setAction("create");
          } else {
            selectPreset(id);
          }
        }} />
      {current.id !== defaultPreset.id && <>
        <IconButton size="small" appearance="plain" label="Rename theme" disabled={!!action}
          onClick={() => { setName(current.name); setAction("rename"); }}><Pencil size={15} /></IconButton>
        <IconButton size="small" appearance="plain" label="Delete theme" disabled={!!action}
          onClick={() => setAction("delete")}><Trash2 size={15} /></IconButton>
      </>}
    </div>
    {action === "create" || action === "rename" ? <form className="theme-preset-form" onSubmit={event => {
      event.preventDefault();
      if (!cleanName || duplicate) return;
      if (action === "create" ? createPreset(cleanName) : renamePreset(cleanName)) setAction(null);
    }} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); setAction(null); }
    }}>
      <label>Theme name<input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)}
        aria-invalid={duplicate} /></label>
      <Button type="submit" disabled={!cleanName || duplicate}>Save</Button>
      <Button onClick={() => setAction(null)}>Cancel</Button>
      {duplicate && <span className="error small" role="alert">A theme with this name already exists.</span>}
    </form> : action === "delete" ? <div className="theme-preset-form">
      <span>Delete “{current.name}” and switch to Default?</span>
      <Button autoFocus onClick={() => setAction(null)}>Cancel</Button>
      <Button onClick={() => { if (deletePreset()) setAction(null); }}>Confirm delete</Button>
    </div> : <small className="muted">Light and dark settings are saved automatically in this theme.</small>}
    {saveError && <p className="error small" role="alert">{saveError}</p>}
  </fieldset>;
}
