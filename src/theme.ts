export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

export function readThemePreference(saved: string | null): ThemePreference {
  return saved === "dark" || saved === "light" ? saved : "system";
}

const lightScheme = "(prefers-color-scheme: light)";

export function systemPrefersLight(): boolean {
  return window.matchMedia(lightScheme).matches;
}

export function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(lightScheme);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export const terminalColorKeys = [
  "background", "foreground", "cursor", "cursorAccent", "selectionBackground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
  "brightMagenta", "brightCyan", "brightWhite",
] as const;

/** Xterm accepts resolved colors, rather than CSS custom-property references. */
export function terminalThemeFromPalette(read: (property: string) => string): Record<typeof terminalColorKeys[number], string> {
  return Object.fromEntries(terminalColorKeys.map((key) => [
    key, read(`--terminal-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`).trim(),
  ])) as Record<typeof terminalColorKeys[number], string>;
}

export function resolveTheme(saved: string | null, prefersLight: boolean): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return prefersLight ? "light" : "dark";
}
