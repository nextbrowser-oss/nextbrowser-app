import { useLayoutEffect, useRef, useState } from "react";
import type { Theme } from "../theme";
import { appearanceTokens, type UpdateAppearance } from "./appearance";
import { settingsStorage } from "./settingsStorage";
import { defaultPreset, readPalettes, readThemeLibrary, savePalette, saveThemeLibrary, type ThemeLibrary } from "./themePresets";

export function useAppearance(theme: Theme) {
  const [library, setLibrary] = useState(() => readThemeLibrary(settingsStorage));
  const [palettes, setPalettes] = useState(() => readPalettes(settingsStorage, library.activeId));
  const [saveError, setSaveError] = useState("");
  const latest = useRef(palettes);
  const appearance = palettes[theme];
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const tokens = appearanceTokens(appearance);
    for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
    return () => { for (const name of Object.keys(tokens)) root.removeProperty(name); };
  }, [appearance]);

  function persist(action: () => void) {
    try {
      action();
      setSaveError("");
      return true;
    } catch {
      setSaveError("Could not save your theme on this device. Check the available storage and try again.");
      return false;
    }
  }
  function applyLibrary(next: ThemeLibrary) {
    const colors = next.activeId === library.activeId ? latest.current : readPalettes(settingsStorage, next.activeId);
    saveThemeLibrary(settingsStorage, next);
    latest.current = colors;
    setPalettes(colors);
    setLibrary(next);
  }
  const updateAppearance: UpdateAppearance = patch => persist(() => {
    const next = patch ? { ...latest.current[theme], ...patch } : {};
    savePalette(settingsStorage, library.activeId, theme, next);
    latest.current = { ...latest.current, [theme]: next };
    setPalettes(latest.current);
  });
  function selectPreset(id: string) {
    if (id === defaultPreset.id || library.presets.some(preset => preset.id === id)) {
      persist(() => applyLibrary({ ...library, activeId: id }));
    }
  }
  function createPreset(name: string) {
    return persist(() => {
      const id = crypto.randomUUID();
      try {
        savePalette(settingsStorage, id, "light", latest.current.light);
        savePalette(settingsStorage, id, "dark", latest.current.dark);
        applyLibrary({ activeId: id, presets: [...library.presets, { id, name }] });
      } catch (error) {
        savePalette(settingsStorage, id, "light", null);
        savePalette(settingsStorage, id, "dark", null);
        throw error;
      }
    });
  }
  function renamePreset(name: string) {
    return persist(() => applyLibrary({ ...library, presets: library.presets.map(preset =>
      preset.id === library.activeId ? { ...preset, name } : preset) }));
  }
  function deletePreset() {
    const id = library.activeId;
    if (id === defaultPreset.id) return false;
    return persist(() => {
      applyLibrary({ activeId: defaultPreset.id, presets: library.presets.filter(preset => preset.id !== id) });
      savePalette(settingsStorage, id, "light", null);
      savePalette(settingsStorage, id, "dark", null);
    });
  }
  return { appearance, updateAppearance, library, selectPreset, createPreset, renamePreset, deletePreset, saveError };
}
