import { ArrowDown, Blocks, BookOpen, Clock3, Folder, GitBranch, Monitor, PanelLeft, Plug, SlidersHorizontal, Sparkles, Unplug, Video, X } from "lucide-react";

const glyphs = { "arrow-down": ArrowDown, blocks: Blocks, "book-open": BookOpen, branch: GitBranch, clock: Clock3, folder: Folder, monitor: Monitor, "panel-left": PanelLeft, plug: Plug, sliders: SlidersHorizontal, sparkles: Sparkles, unplug: Unplug, video: Video, x: X };
export type GlyphName = keyof typeof glyphs;

/** A small monoline set for navigation; action labels belong to the owning control. */
export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  const Symbol = glyphs[name];
  return <Symbol size={size} strokeWidth={1.5} style={{ strokeWidth: 1.5 }} aria-hidden="true" focusable="false" />;
}
