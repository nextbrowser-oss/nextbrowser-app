import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TooltipContent, type TooltipAnchor } from "../shared/ui";
import {
  formatHistoryDateLabel,
  sortTrafficHistoryPoints,
  trafficChartMaximumBytes,
  trafficChartTickIndices,
} from "../lib/trafficChart";
import { humanBytes, type ProxyTrafficHistoryPoint } from "../types";

const plotLeft = 60;
const plotTop = 8;
const gridFractions = [0, 0.25, 0.5, 0.75, 1];
const numberFormatter = new Intl.NumberFormat();

type PositionedTrafficPoint = ProxyTrafficHistoryPoint & {
  x: number;
  y: number;
};

function chartPath(points: PositionedTrafficPoint[]): string {
  return points
    .map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function areaPath(points: PositionedTrafficPoint[], plotBottom: number): string {
  if (!points.length) return "";
  return `M ${points[0].x.toFixed(2)} ${plotBottom} ${chartPath(points).replace(/^M/, "L")} L ${points.at(-1)?.x.toFixed(2)} ${plotBottom} Z`;
}

export function TrafficChart({ points }: { points: ProxyTrafficHistoryPoint[] }) {
  const gradientId = useId().replace(/:/g, "");
  const tooltipId = useId();
  const activeDot = useRef<SVGCircleElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [{width: chartWidth, height: chartHeight}, setSize] = useState({width: 640, height: 170});
  useEffect(() => {
    if (!container.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      if (width > 0 && height > 0) setSize({width, height});
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const plotRight = Math.max(plotLeft + 1, chartWidth - 10);
  const plotBottom = Math.max(plotTop + 1, chartHeight - 24);
  const tooltipAnchor = useMemo<TooltipAnchor>(() => ({
    getBoundingClientRect: () => activeDot.current?.getBoundingClientRect() ?? new DOMRect(),
  }), []);
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const chartPoints = useMemo(() => sortTrafficHistoryPoints(points), [points]);
  const maximumBytes = useMemo(
    () => trafficChartMaximumBytes(Math.max(...chartPoints.map((point) => point.used_bytes), 0)),
    [chartPoints],
  );
  const positionedPoints = useMemo<PositionedTrafficPoint[]>(() => {
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    return chartPoints.map((point, index) => ({
      ...point,
      x: chartPoints.length === 1
        ? plotLeft + plotWidth / 2
        : plotLeft + index / (chartPoints.length - 1) * plotWidth,
      y: plotBottom - point.used_bytes / maximumBytes * plotHeight,
    }));
  }, [chartPoints, maximumBytes, plotRight, plotBottom]);
  const tickCount = Math.min(7, Math.max(2, Math.floor((plotRight - plotLeft) / 64)));
  const axisIndices = trafficChartTickIndices(chartPoints.length, tickCount);
  const activePoint = hoveredIndex == null ? undefined : positionedPoints[hoveredIndex];
  const line = chartPath(positionedPoints);
  const area = areaPath(positionedPoints, plotBottom);

  const updateHoveredPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!positionedPoints.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) / bounds.width * chartWidth;
    const ratio = Math.min(1, Math.max(0, (pointerX - plotLeft) / (plotRight - plotLeft)));
    setHoveredIndex(Math.round(ratio * (positionedPoints.length - 1)));
  };

  return (
    <div
      ref={container}
      className="proxy-traffic-chart"
      role="img"
      aria-label="Proxy traffic trend by date"
      aria-describedby={activePoint ? tooltipId : undefined}
      onPointerMove={updateHoveredPoint}
      onPointerLeave={() => setHoveredIndex(undefined)}
    >
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridFractions.map((fraction) => {
          const y = plotTop + fraction * (plotBottom - plotTop);
          const value = maximumBytes * (1 - fraction);
          return (
            <g key={fraction}>
              <line className="proxy-traffic-chart-grid" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
              <text className="proxy-traffic-chart-axis" x={plotLeft - 14} y={y + 4} textAnchor="end">
                {humanBytes(value)}
              </text>
            </g>
          );
        })}

        {axisIndices.map((index) => {
          const point = positionedPoints[index];
          return (
            <text
              className="proxy-traffic-chart-axis proxy-traffic-chart-date"
              key={`${point.label}-${index}`}
              x={point.x}
              y={plotBottom + 17}
              textAnchor={positionedPoints.length > 1 && index === positionedPoints.length - 1 ? "end" : "middle"}
            >
              {formatHistoryDateLabel(point.label)}
            </text>
          );
        })}

        <path d={area} fill={`url(#${gradientId})`} />
        <path className="proxy-traffic-chart-line" d={line} />

        {positionedPoints.length <= 31 && positionedPoints.map((point, index) => (
          <circle
            className="proxy-traffic-chart-dot"
            cx={point.x}
            cy={point.y}
            key={`${point.label}-${index}`}
            r="3"
          />
        ))}

        {activePoint && (
          <g>
            <line
              className="proxy-traffic-chart-cursor"
              x1={activePoint.x}
              x2={activePoint.x}
              y1={plotTop}
              y2={plotBottom}
            />
            <circle className="proxy-traffic-chart-active-ring" cx={activePoint.x} cy={activePoint.y} r="8" />
            <circle ref={activeDot} className="proxy-traffic-chart-active-dot" cx={activePoint.x} cy={activePoint.y} r="4" />
          </g>
        )}
      </svg>

      {activePoint && (
        <TooltipContent id={tooltipId} anchor={tooltipAnchor} side={activePoint.y < 92 ? "bottom" : "top"} interactive={false}>
          <div className="traffic-tooltip-details">
            <strong>{formatHistoryDateLabel(activePoint.label)}</strong>
            <span>
              <span>Traffic</span>
              <b>{humanBytes(activePoint.used_bytes)}</b>
            </span>
            <span>
              <span>Requests</span>
              <b>{numberFormatter.format(activePoint.requests)}</b>
            </span>
          </div>
        </TooltipContent>
      )}
    </div>
  );
}
