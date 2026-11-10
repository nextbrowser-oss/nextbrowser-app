import { ArrowDown, Blocks, BookOpen, ChevronDown, Clock3, Copy, Folder, GitBranch, Minus, Monitor, PanelLeft, Plug, SlidersHorizontal, Sparkles, Square, Unplug, Users, Video, X } from "lucide-react";

const glyphs = { "arrow-down": ArrowDown, "chevron-down": ChevronDown, blocks: Blocks, "book-open": BookOpen, branch: GitBranch, clock: Clock3, copy: Copy, folder: Folder, minus: Minus, monitor: Monitor, "panel-left": PanelLeft, plug: Plug, sliders: SlidersHorizontal, sparkles: Sparkles, square: Square, unplug: Unplug, users: Users, video: Video, x: X };
export type GlyphName = keyof typeof glyphs;

/** A small monoline set for navigation; action labels belong to the owning control. */
export function Glyph({ name, size = 20 }: { name: GlyphName; size?: number }) {
  const Symbol = glyphs[name];
  return <Symbol size={size} strokeWidth={1.5} style={{ strokeWidth: 1.5 }} aria-hidden="true" focusable="false" />;
}
