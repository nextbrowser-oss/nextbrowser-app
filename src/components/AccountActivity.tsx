import { useEffect, useId, useState } from "react";
import { Clock3, Activity } from "lucide-react";
import { activityChanged, recentActivity } from "../lib/accountActivity";
import { formatHistoryDateLabel } from "../lib/trafficChart";
import { Tooltip } from "../shared/ui";

function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (!minutes) return ms > 0 ? "<1 min" : "0 min";
  return minutes < 60 ? minutes + " min" : Math.floor(minutes / 60) + " h " + minutes % 60 + " min";
}

function ActivityCard({ days, metric }: { days: ReturnType<typeof recentActivity>; metric: "ms" | "sessions" }) {
  const id = useId();
  const [point, setPoint] = useState<number>();
  const time = metric === "ms";
  const shown = point === undefined ? undefined : days[point];
  const value = shown ? shown[metric] : days.reduce((sum, day) => sum + day[metric], 0);
  const format = (n: number) => time ? duration(n) : String(n);
  const max = Math.max(1, ...days.map(day => day[metric]));
  const step = 290 / Math.max(1, days.length - 1);
  const x = (i: number) => 5 + i * step;
  const y = (i: number) => 62 - 54 * days[i][metric] / max;
  const line = days.map((_, i) => (i ? "L" : "M") + x(i) + " " + y(i)).join(" ");
  const title = time ? "Time in Nextbrowser" : "Visits";
  const activeDays = days.filter(day => day.ms > 0 || day.sessions > 0).length;
  const detail = time ? "Time with this window in focus" : `Active on ${activeDays} of ${days.length} tracked days · 30 min away starts a new visit`;
  const date = shown?.label ?? (days.length === 1 ? days[0].label : undefined);
  return <section className="account-activity-card" aria-label={title}>
    <div className="account-metric">
      <Tooltip content={detail}><header tabIndex={0}>{time ? <Clock3 size={14} /> : <Activity size={14} />}<h3>{title}</h3></header></Tooltip>
      <div className="account-metric-value"><b>{format(value)}</b><small>{date ? formatHistoryDateLabel(date) : "Last 14 days"}</small></div>
    </div>
    {days.length > 1 && <div className="account-trend">
      <svg viewBox="0 0 300 68" preserveAspectRatio="none" aria-label={title + " by day"} role="group"
        onPointerLeave={() => setPoint(undefined)} onBlur={() => setPoint(undefined)}>
        <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="var(--accent)" stopOpacity=".32"/><stop offset="1" stopColor="var(--accent)" stopOpacity=".02"/></linearGradient></defs>
        <path d="M4 33H296 M4 62H296" className="proxy-traffic-chart-grid" />
        <path d={line + " L" + x(days.length - 1) + " 64 L" + x(0) + " 64 Z"} fill={`url(#${id})`} />
        <path d={line} className="proxy-traffic-chart-line" />
        {days.map((day, i) => (
          <g key={day.label} tabIndex={0} role="img" aria-label={day.label + ", " + format(day[metric])} onFocus={() => setPoint(i)} onPointerEnter={() => setPoint(i)}>
            <circle cx={x(i)} cy={y(i)} r={point === i ? 4 : 2.5} fill="var(--accent)"/>
            <rect x={x(i) - step / 2} width={step} height="68" fill="transparent"/>
          </g>
        ))}
      </svg>
      <div className="account-chart-dates"><span>{formatHistoryDateLabel(days[0].label)}</span><span>{formatHistoryDateLabel(days[days.length - 1].label)}</span></div>
    </div>}
  </section>;
}

export function AccountActivity({ owner }: { owner: string }) {
  const [days, setDays] = useState(() => recentActivity(owner));
  useEffect(() => {
    const update = () => setDays(recentActivity(owner));
    update();
    window.addEventListener(activityChanged, update);
    return () => window.removeEventListener(activityChanged, update);
  }, [owner]);
  return <div className="account-activity-grid claw-card"><ActivityCard days={days} metric="ms" /><ActivityCard days={days} metric="sessions" /></div>;
}
