export type Theme = "dark" | "light";

export function resolveTheme(saved: string | null, prefersLight: boolean): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return prefersLight ? "light" : "dark";
}
