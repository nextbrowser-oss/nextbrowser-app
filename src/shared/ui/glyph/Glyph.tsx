import { ArrowDown, BookOpen, Clock3, Monitor, PanelLeft, Plug, SlidersHorizontal, Sparkles } from "lucide-react";

const glyphs = { "arrow-down": ArrowDown, "book-open": BookOpen, clock: Clock3, monitor: Monitor, "panel-left": PanelLeft, plug: Plug, sliders: SlidersHorizontal, sparkles: Sparkles };
export type GlyphName = keyof typeof glyphs;

/** A small monoline set for navigation; action labels belong to the owning control. */
export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  const Symbol = glyphs[name];
  return <Symbol size={size} strokeWidth={1.5} style={{ strokeWidth: 1.5 }} aria-hidden="true" focusable="false" />;
}
