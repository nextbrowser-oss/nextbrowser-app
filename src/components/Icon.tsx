import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowRightCircle,
  ArrowUpCircle,
  Book,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleEllipsis,
  CirclePlay,
  CirclePause,
  CircleX,
  CircleCheck,
  Cpu,
  FileSearch,
  File,
  FolderOpen,
  GitBranch,
  Globe,
  History,
  Info,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  MessagesSquare,
  Network,
  Pencil,
  Clapperboard,
  Plus,
  PlusCircle,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Terminal,
  Timer,
  Trash2,
  UserCircle,
  Users,
  Video,
  Wrench,
  Zap,
  Copy,
  Gauge,
  Inbox,
  Sidebar,
  Eraser as EraserIcon,
  Moon,
  Paperclip,
  Sun,
} from "lucide-react";

/** Maps Swift SF Symbol names → Lucide icons for visual parity. */
const SF_MAP: Record<string, LucideIcon> = {
  "bubble.left.and.bubble.right.fill": MessagesSquare,
  "square.grid.2x2.fill": LayoutGrid,
  "video.fill": Video,
  "book.fill": Book,
  "arrow.triangle.2.circlepath": RefreshCw,
  terminal: Terminal,
  "exclamationmark.triangle.fill": AlertTriangle,
  "plus.circle": PlusCircle,
  pencil: Pencil,
  trash: Trash2,
  "ellipsis.circle": CircleEllipsis,
  "play.rectangle.on.rectangle.fill": Clapperboard,
  "chevron.right": ChevronRight,
  "key.fill": KeyRound,
  "chart.bar.fill": Gauge,
  "person.2.fill": Users,
  globe: Globe,
  "trash.fill": Trash2,
  "cpu.fill": Cpu,
  "person.badge.key.fill": KeyRound,
  "tray.full.fill": Inbox,
  timer: Timer,
  "clock.arrow.circlepath": History,
  sparkles: Sparkles,
  "bolt.fill": Zap,
  "checkmark.seal.fill": CheckCircle2,
  "person.badge.key": KeyRound,
  magnifyingglass: Search,
  "doc.text.magnifyingglass": FileSearch,
  "square.stack.3d.up.fill": Layers,
  "paperplane.fill": Send,
  "scroll.fill": ScrollText,
  "xmark.circle.fill": CircleX,
  checkmark: Check,
  "checkmark.circle.fill": CircleCheck,
  "arrow.clockwise": RefreshCw,
  "rectangle.portrait.and.arrow.right": LogOut,
  "square.and.pencil": SquarePen,
  "sidebar.left": Sidebar,
  "sidebar.leading": Sidebar,
  eraser: EraserIcon,
  "arrow.triangle.branch": GitBranch,
  "stop.circle.fill": CirclePause,
  "arrow.up.circle.fill": ArrowUpCircle,
  scroll: ScrollText,
  "info.circle": Info,
  "doc.on.doc": Copy,
  "stop.fill": CirclePause,
  wrench: Wrench,
  network: Network,
  "checkmark.shield.fill": ShieldCheck,
  "checkmark.shield": ShieldCheck,
  "arrow.right.circle": ArrowRightCircle,
  "play.circle": CirclePlay,
  clock: Timer,
  "lock.fill": Lock,
  plus: Plus,
  "arrow.down.circle": ArrowDownCircle,
  play: CirclePlay,
  "play.fill": CirclePlay,
  stop: CirclePause,
  speedometer: Gauge,
  "hand.wave.fill": Sparkles,
  "globe.americas.fill": Globe,
  mint: Sparkles,
  "person.crop.circle": UserCircle,
  "person.crop.circle.fill": UserCircle,
  moon: Moon,
  sun: Sun,
  paperclip: Paperclip,
  doc: File,
  folder: FolderOpen,
};

export type SFSymbol = keyof typeof SF_MAP | string;

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth,
  fill,
  style,
}: {
  name: SFSymbol;
  size?: number;
  className?: string;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
}) {
  const Cmp = SF_MAP[name] ?? Sparkles;
  const resolvedStroke = strokeWidth ?? (size <= 14 ? 1.65 : size <= 18 ? 1.85 : 2);
  const resolvedFill = fill ?? "none";
  return (
    <Cmp
      size={size}
      className={className}
      strokeWidth={fill != null && fill !== "none" ? 0 : resolvedStroke}
      fill={resolvedFill}
      style={style}
      aria-hidden
    />
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden />;
}
