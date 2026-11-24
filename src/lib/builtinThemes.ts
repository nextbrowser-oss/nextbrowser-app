import type { Theme } from "../theme";
import type { Wallpaper } from "./appearance";

interface BuiltinTheme {
  id: string;
  name: string;
  wallpaper: Wallpaper;
  radius: number;
}

export const builtinThemes: readonly BuiltinTheme[] = [
  { id: "builtin:blueprint", name: "Blueprint", wallpaper: "dots", radius: 9 },
  { id: "builtin:matcha", name: "Matcha", wallpaper: "gradient", radius: 23 },
  { id: "builtin:terracotta", name: "Terracotta", wallpaper: "solid", radius: 15 },
  { id: "builtin:afterglow", name: "Afterglow", wallpaper: "gradient", radius: 26 },
];

export function builtinTheme(id: string) {
  return builtinThemes.find(theme => theme.id === id);
}

export function builtinAppearance(preset: BuiltinTheme, mode: Theme,
  style: Pick<CSSStyleDeclaration, "getPropertyValue"> = getComputedStyle(document.documentElement)) {
  const prefix = `--${preset.id.slice("builtin:".length)}-${mode}-`;
  const color = (field: string) => style.getPropertyValue(prefix + field).trim();
  return {
    accent: color("accent"), background: color("bg"), incoming: color("incoming"), outgoing: color("outgoing"),
    wallpaper: preset.wallpaper, radius: preset.radius,
    ...(preset.wallpaper === "gradient" && { gradientEnd: color("end") }),
  };
}
