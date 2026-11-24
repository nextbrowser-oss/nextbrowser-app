import type { Theme } from "../theme";
import type { Appearance, Wallpaper } from "./appearance";

interface BuiltinTheme {
  id: string;
  name: string;
  wallpaper: Wallpaper | Partial<Record<Theme, Wallpaper>>;
  radius?: number;
}

export const builtinThemes: readonly BuiltinTheme[] = [
  { id: "builtin:blueprint", name: "Blueprint", wallpaper: "dots", radius: 9 },
  { id: "builtin:matcha", name: "Matcha", wallpaper: "gradient", radius: 23 },
  { id: "builtin:terracotta", name: "Terracotta", wallpaper: "solid", radius: 15 },
  { id: "builtin:afterglow", name: "Afterglow", wallpaper: "gradient", radius: 26 },
  { id: "builtin:hyellow", name: "hyellow", wallpaper: { dark: "gradient" } },
];

export function builtinTheme(id: string) {
  return builtinThemes.find(theme => theme.id === id);
}

export function builtinAppearance(preset: BuiltinTheme, mode: Theme,
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> = getComputedStyle(document.documentElement)): Appearance {
  const prefix = `--${preset.id.slice("builtin:".length)}-${mode}-`;
  const appearance: Appearance = {};
  const wallpaper = typeof preset.wallpaper === "string" ? preset.wallpaper : preset.wallpaper[mode];
  if (wallpaper) appearance.wallpaper = wallpaper;
  if (preset.radius !== undefined) appearance.radius = preset.radius;
  const colors = { accent: "accent", background: "bg", incoming: "incoming", outgoing: "outgoing", gradientEnd: "end" } as const;
  for (const key of Object.keys(colors) as (keyof typeof colors)[]) {
    const value = style.getPropertyValue(prefix + colors[key]).trim();
    if (value) appearance[key] = value;
  }
  return appearance;
}
