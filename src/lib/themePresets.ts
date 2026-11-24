import type { Theme } from "../theme";
import { parseAppearance, type Appearance } from "./appearance";

export const defaultPreset = { id: "default", name: "Default" };
type Preset = typeof defaultPreset;
export interface ThemeLibrary { activeId: string; presets: Preset[] }
const libraryKey = "nextbrowser.appearance.presets";

export function readThemeLibrary(storage: Storage): ThemeLibrary {
  const empty = { activeId: defaultPreset.id, presets: [] };
  try {
    const data = JSON.parse(storage.getItem(libraryKey) ?? "null");
    if (!Array.isArray(data?.presets)) return empty;
    const ids = new Set([defaultPreset.id]);
    const presets: Preset[] = [];
    for (const item of data.presets) {
      if (typeof item?.id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(item.id) || ids.has(item.id)) continue;
      if (typeof item.name !== "string" || !item.name.trim()) continue;
      ids.add(item.id);
      presets.push({ id: item.id, name: item.name.trim() });
    }
    return { presets, activeId: ids.has(data.activeId) ? data.activeId : defaultPreset.id };
  } catch { return empty; }
}

export function saveThemeLibrary(storage: Storage, library: ThemeLibrary) {
  storage.setItem(libraryKey, JSON.stringify(library));
}

// Keep legacy keys for Default. Store each palette separately: two photo
// wallpapers can exceed the desktop settings file's per-value size limit.
function paletteKey(id: string, mode: Theme) {
  return id === defaultPreset.id ? "nextbrowser.appearance." + mode : `nextbrowser.appearance.preset.${id}.${mode}`;
}

export function readPalettes(storage: Storage, id: string) {
  return {
    light: parseAppearance(storage.getItem(paletteKey(id, "light"))),
    dark: parseAppearance(storage.getItem(paletteKey(id, "dark"))),
  };
}

export function savePalette(storage: Storage, id: string, mode: Theme, appearance: Appearance | null) {
  const key = paletteKey(id, mode);
  if (appearance && Object.keys(appearance).length) storage.setItem(key, JSON.stringify(appearance));
  else storage.removeItem(key);
}
