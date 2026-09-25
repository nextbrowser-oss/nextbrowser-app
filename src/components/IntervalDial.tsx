import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  MONITOR_INTERVAL_STEPS,
  MONITOR_MAX_INTERVAL_MINUTES,
  MONITOR_MIN_INTERVAL_MINUTES,
  clampMonitorInterval,
  formatInterval,
} from "../types";

/** Where the dial's scale starts and ends, in degrees clockwise from the top.
 *  The gap at the bottom keeps "five minutes" and "a week" apart. */
const START = -140;
const END = 140;
const SIZE = 168;
const CENTER = SIZE / 2;
const RADIUS = 66;
const STEPS: readonly number[] = MONITOR_INTERVAL_STEPS;
/** Stops that carry a label on the ring. */
const LABELLED = new Map<number, string>([[5, "5m"], [60, "1h"], [360, "6h"], [1440, "24h"], [2880, "48h"], [10080, "7d"]]);

const PRESETS = [5, 15, 30, 60, 360, 720, 1440, 2880];

type Unit = "min" | "h" | "d";
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

function angleOf(index: number): number {
  return START + ((END - START) * index) / (STEPS.length - 1);
}

function point(angle: number, radius = RADIUS): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [CENTER + radius * Math.sin(radians), CENTER - radius * Math.cos(radians)];
}

function arc(from: number, to: number): string {
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** nearestStep is where a value that sits between stops is drawn. */
function nearestStep(minutes: number): number {
  let best = 0;
  for (let index = 0; index < STEPS.length; index += 1) {
    if (Math.abs(Math.log(STEPS[index]) - Math.log(minutes)) < Math.abs(Math.log(STEPS[best]) - Math.log(minutes))) best = index;
  }
  return best;
}

/** unitFor picks the unit a value reads best in, for the exact-value field. */
function unitFor(minutes: number): Unit {
  if (minutes % 1440 === 0 && minutes >= 1440) return "d";
  if (minutes % 60 === 0 && minutes >= 60) return "h";
  return "min";
}

/// IntervalDial sets how often a schedule runs: drag the knob round the ring,
/// use the arrow keys, pick a preset, or type an exact value. The ring is
/// stepped — minutes at the start, hours in the middle, days at the end — so a
/// drag lands on a sensible value instead of "2 h 13 min".
export function IntervalDial({ value, onChange, disabled }: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const [draftUnit, setDraftUnit] = useState<Unit>(() => unitFor(value));
  const [draft, setDraft] = useState<string>(() => String(value / UNIT_MINUTES[unitFor(value)]));
  // A value set from elsewhere — the schedule loading, a preset — shows in the
  // exact field too.
  useEffect(() => {
    const unit = unitFor(value);
    setDraftUnit(unit);
    setDraft(String(value / UNIT_MINUTES[unit]));
  }, [value]);
  const index = nearestStep(value);
  const angle = angleOf(index);
  const [knobX, knobY] = point(angle);

  const commit = (minutes: number) => {
    const next = clampMonitorInterval(minutes);
    const unit = unitFor(next);
    setDraftUnit(unit);
    setDraft(String(next / UNIT_MINUTES[unit]));
    if (next !== value) onChange(next);
  };

  const fromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    const degrees = Math.max(START, Math.min(END, (Math.atan2(dx, -dy) * 180) / Math.PI));
    const step = Math.round(((degrees - START) / (END - START)) * (STEPS.length - 1));
    commit(STEPS[step]);
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 3, PageDown: -3 };
    if (event.key === "Home") commit(STEPS[0]);
    else if (event.key === "End") commit(STEPS[STEPS.length - 1]);
    else if (event.key in moves) commit(STEPS[Math.max(0, Math.min(STEPS.length - 1, index + moves[event.key]))]);
    else return;
    event.preventDefault();
  };

  const applyDraft = (text: string, unit: Unit) => {
    const number = Number(text.replace(",", "."));
    if (Number.isFinite(number) && number > 0) commit(number * UNIT_MINUTES[unit]);
  };

  return (
    <div className={"interval-dial" + (disabled ? " is-disabled" : "")}>
      <svg
        ref={svgRef}
        className={"interval-dial-ring" + (dragging ? " is-dragging" : "")}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="How often monitoring runs"
        aria-valuemin={MONITOR_MIN_INTERVAL_MINUTES}
        aria-valuemax={MONITOR_MAX_INTERVAL_MINUTES}
        aria-valuenow={value}
        aria-valuetext={`Every ${formatInterval(value)}`}
        aria-disabled={disabled}
        onKeyDown={disabled ? undefined : onKey}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          fromPointer(event);
        }}
        onPointerMove={(event) => { if (dragging) fromPointer(event); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <path d={arc(START, END)} className="interval-dial-track" />
        {index > 0 && <path d={arc(START, angle)} className="interval-dial-fill" />}
        {STEPS.map((step, stepIndex) => {
          const at = angleOf(stepIndex);
          const label = LABELLED.get(step);
          const [x0, y0] = point(at, RADIUS + 9);
          const [x1, y1] = point(at, RADIUS + (label ? 14 : 12));
          const [lx, ly] = point(at, RADIUS - 17);
          return (
            <g key={step}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} className={"interval-dial-tick" + (label ? " is-major" : "")} />
              {label && <text x={lx} y={ly + 3} className="interval-dial-label">{label}</text>}
            </g>
          );
        })}
        <circle cx={knobX} cy={knobY} r={9} className="interval-dial-knob" />
        <text x={CENTER} y={CENTER - 6} className="interval-dial-caption">every</text>
        <text x={CENTER} y={CENTER + 16} className="interval-dial-value">{formatInterval(value)}</text>
      </svg>

      <div className="interval-dial-side">
        <div className="interval-dial-presets" role="group" aria-label="Common intervals">
          {PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={disabled}
              className={"interval-preset" + (minutes === value ? " selected" : "")}
              aria-pressed={minutes === value}
              onClick={() => commit(minutes)}
            >
              {formatInterval(minutes).replace(" min", "m").replace(" h", "h").replace(" d", "d")}
            </button>
          ))}
        </div>
        <label className="interval-dial-exact small muted">
          Exactly
          <input
            type="number"
            min={1}
            step={1}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => applyDraft(draft, draftUnit)}
            onKeyDown={(event) => { if (event.key === "Enter") applyDraft(draft, draftUnit); }}
          />
          <select
            value={draftUnit}
            disabled={disabled}
            onChange={(event) => {
              const unit = event.target.value as Unit;
              setDraftUnit(unit);
              applyDraft(draft, unit);
            }}
          >
            <option value="min">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
          </select>
        </label>
        <span className="muted small">From 5 minutes to 7 days.</span>
      </div>
    </div>
  );
}
