import { CalendarDays, ChartColumn, Clapperboard, Kanban, LayoutGrid, List, Music2, Notebook } from 'lucide-react';
import type { AppInfo } from '../lib/miniAppLibrary';
import swipeforgeDark from '../assets/swipeforge-mark-dark.png';
import swipeforgeLight from '../assets/swipeforge-mark-light.png';

const icons = { board: Kanban, calendar: CalendarDays, chart: ChartColumn, grid: LayoutGrid, list: List, notebook: Notebook, music: Music2, video: Clapperboard };

export function MiniAppIcon({ app }: { app: AppInfo }) {
  const name = app.icon ?? (app.id === 'kanban' ? 'board' : undefined);
  if (!name) return <span className="mini-app-monogram" aria-hidden="true">{Array.from(app.name.trim())[0]?.toUpperCase()}</span>;
  // Brand marks keep their own colors; each theme gets the variant drawn for it.
  if (name === 'swipeforge') return <span className="mini-app-brand-icon" aria-hidden="true">
    <img className="mini-app-brand-dark" src={swipeforgeDark} alt="" /><img className="mini-app-brand-light" src={swipeforgeLight} alt="" />
  </span>;
  const Icon = icons[name];
  return <Icon size={18} strokeWidth={1.5} aria-hidden="true" />;
}
