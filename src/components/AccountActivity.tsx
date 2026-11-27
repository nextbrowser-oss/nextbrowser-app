import { translate } from "../shared/lib/i18n";
import { useEffect, useId, useRef, useState } from "react";
import { Clock3, Activity } from "lucide-react";
import { activityChanged, recentActivity } from "../lib/accountActivity";
import { formatHistoryDateLabel, trafficChartTickIndices } from "../lib/trafficChart";
import { Tooltip } from "../shared/ui";

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return seconds + " s";
  const hours = Math.floor(minutes / 60);
  const minuteAndSecond = `${minutes % 60} min ${seconds % 60} s`;
  return hours ? `${hours} h ${minuteAndSecond}` : minuteAndSecond;
}

type Metric = "ms" | "sessions";

function activityAxis(metric: Metric, peak: number) {
  let unit = 1, label = "Number of visits";
  if (metric === "ms") {
    if (peak >= 3_600_000) { unit = 3_600_000; label = "Time (hours)"; }
    else if (peak > 0 && peak < 60_000) { unit = 1000; label = "Time (seconds)"; }
    else { unit = 60_000; label = "Time (minutes)"; }
  }
  const targetStep = Math.max(1, peak / unit / 3);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = ([1, 2, 5, 10].find(n => n * magnitude >= targetStep) ?? 10) * magnitude;
  const intervals = Math.max(1, Math.ceil(peak / (step * unit)));
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => i * step);
  return { label, ticks, max: intervals * step * unit };
}

function ActivityCard({ days, metric }: { days: ReturnType<typeof recentActivity>; metric: Metric }) {
  const id = useId();
  const [point, setPoint] = useState<number>();
  const plot = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 360, height: 136 });
  useEffect(() => {
    if (!plot.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);
  const time = metric === "ms";
  const shown = point === undefined ? undefined : days[point];
  const value = shown ? shown[metric] : days.reduce((sum, day) => sum + day[metric], 0);
  const format = (n: number) => time ? duration(n) : String(n);
  const axis = activityAxis(metric, Math.max(0, ...days.map(day => day[metric])));
  const left = Math.max(24, String(axis.ticks.at(-1)).length * 7 + 8);
  const top = 24, bottom = size.height - 36, right = Math.max(left + 1, size.width - 8);
  const step = (right - left) / Math.max(1, days.length - 1);
  const x = (i: number) => days.length === 1 ? (left + right) / 2 : left + i * step;
  const y = (i: number) => bottom - (bottom - top) * days[i][metric] / axis.max;
  const line = days.map((_, i) => (i ? "L" : "M") + x(i) + " " + y(i)).join(" ");
  const dateTicks = trafficChartTickIndices(days.length, Math.max(2, Math.min(5, Math.floor((right - left) / 72))));
  const title = time ? "Time in Nextbrowser" : "Visits";
  const activeDays = days.filter(day => day.ms > 0 || day.sessions > 0).length;
  const detail = time ? "Time in Nextbrowser, including the embedded Live browser" : `Active on ${activeDays} of ${days.length} tracked days · 30 min away starts a new visit`;
  const date = shown?.label ?? (days.length === 1 ? days[0].label : undefined);
  return <section className="account-activity-card" aria-label={title}>
    <div className="account-metric">
      <Tooltip content={detail}><header tabIndex={0}>{time ? <Clock3 size={14} /> : <Activity size={14} />}<h3>{title}</h3></header></Tooltip>
      <div className="account-metric-value"><b>{format(value)}</b><small>{date ? formatHistoryDateLabel(date) : translate("Last 14 days")}</small></div>
    </div>
    <div className="account-trend" ref={plot}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} aria-label={title + " by day"} role="group"
        onPointerLeave={() => setPoint(undefined)} onBlur={() => setPoint(undefined)}>
        <defs><linearGradient id={id} x1="0%" x2="0%" y1="0%" y2="100%"><stop stopColor="var(--accent)" stopOpacity=".32"/><stop offset="1" stopColor="var(--accent)" stopOpacity=".02"/></linearGradient></defs>
        <text x={left} y={12} className="account-chart-axis-title">{axis.label}</text>
        {axis.ticks.map((tick, i) => {
          const row = bottom - (bottom - top) * i / (axis.ticks.length - 1);
          return <g key={tick}>
            {i > 0 && <line x1={left} x2={right} y1={row} y2={row} className="proxy-traffic-chart-grid" />}
            <line x1={left - 3} x2={left} y1={row} y2={row} className="account-chart-axis" />
            <text x={left - 6} y={row} dy=".32em" textAnchor="end" className="account-chart-label">{tick}</text>
          </g>;
        })}
        <path d={`M${left} ${top}V${bottom}H${right}`} className="account-chart-axis" />
        {dateTicks.map(i => <g key={days[i].label}>
          <line x1={x(i)} x2={x(i)} y1={bottom} y2={bottom + 4} className="account-chart-axis" />
          <text x={x(i)} y={bottom + 16} textAnchor={days.length === 1 ? "middle" : i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="account-chart-label">{formatHistoryDateLabel(days[i].label)}</text>
        </g>)}
        <text x={(left + right) / 2} y={size.height - 3} textAnchor="middle" className="account-chart-axis-title">{translate("Date")}</text>
        {days.length > 1 && <path d={`${line} L${right} ${bottom} L${left} ${bottom} Z`} fill={`url(#${id})`} />}
        <path d={line} className="proxy-traffic-chart-line" />
        {days.map((day, i) => (
          <g key={day.label} tabIndex={0} role="img" aria-label={day.label + ", " + format(day[metric])} onFocus={() => setPoint(i)} onPointerEnter={() => setPoint(i)}>
            <circle cx={x(i)} cy={y(i)} r={point === i || days.length === 1 ? 5 : 3} fill="var(--accent)"/>
            <rect x={Math.max(left, x(i) - step / 2)} y={top}
              width={Math.min(right, x(i) + step / 2) - Math.max(left, x(i) - step / 2)} height={bottom - top} fill="transparent"/>
          </g>
        ))}
      </svg>
    </div>
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
  return <div className="account-activity-grid"><ActivityCard days={days} metric="ms" /><ActivityCard days={days} metric="sessions" /></div>;
}
