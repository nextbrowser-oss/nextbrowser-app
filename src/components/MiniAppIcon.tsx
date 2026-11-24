import { CalendarDays, ChartColumn, Kanban, LayoutGrid, List, Music2, Notebook } from 'lucide-react';
import type { AppInfo } from '../lib/miniAppLibrary';

const icons = { board: Kanban, calendar: CalendarDays, chart: ChartColumn, grid: LayoutGrid, list: List, notebook: Notebook, music: Music2 };

export function MiniAppIcon({ app }: { app: AppInfo }) {
  const name = app.icon ?? (app.id === 'kanban' ? 'board' : undefined);
  if (!name) return <span className="mini-app-monogram" aria-hidden="true">{Array.from(app.name.trim())[0]?.toUpperCase()}</span>;
  const Icon = icons[name];
  return <Icon size={18} strokeWidth={1.5} aria-hidden="true" />;
}
