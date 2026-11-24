import { useLayoutEffect, useRef, useState } from "react";
import type { Theme } from "../theme";
import { appearanceTokens, parseAppearance, type Appearance, type UpdateAppearance } from "./appearance";
import { settingsStorage } from "./settingsStorage";

export function useAppearance(theme: Theme) {
  const [palettes, setPalettes] = useState(() => ({
    light: parseAppearance(settingsStorage.getItem("nextbrowser.appearance.light")),
    dark: parseAppearance(settingsStorage.getItem("nextbrowser.appearance.dark")),
  }));
  const latest = useRef(palettes);
  const appearance = palettes[theme];
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const tokens = appearanceTokens(appearance);
    for (const [name, value] of Object.entries(tokens)) root.setProperty(name, value);
    return () => { for (const name of Object.keys(tokens)) root.removeProperty(name); };
  }, [appearance]);

  const updateAppearance: UpdateAppearance = patch => {
    const next: Appearance = patch ? { ...latest.current[theme], ...patch } : {};
    const key = "nextbrowser.appearance." + theme;
    if (Object.keys(next).length) settingsStorage.setItem(key, JSON.stringify(next));
    else settingsStorage.removeItem(key);
    latest.current = { ...latest.current, [theme]: next };
    setPalettes(latest.current);
  };
  return { appearance, updateAppearance };
}
