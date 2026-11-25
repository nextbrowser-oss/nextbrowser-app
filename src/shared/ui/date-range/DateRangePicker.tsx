import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateField,
  DateInput,
  DateSegment,
  Dialog,
  DialogTrigger,
  Heading,
  Label,
  Popover,
  RangeCalendar,
  type DateValue,
} from "react-aria-components";
import { useState } from "react";
import "./date-range.css";
import { parseDate } from "@internationalized/date";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { glassSurfaceClassName } from "../glass-surface";

type TaskDateValue = { start: string | null; due: string | null };

function toCal(iso: string | null): DateValue | null {
  if (!iso) return null;
  try {
    return parseDate(iso) as unknown as DateValue;
  } catch {
    return null;
  }
}
function fmt(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function DateRangePicker({
  from,
  to,
  latest,
  selected,
  validRange,
  onApply,
}: {
  from: string;
  to: string;
  latest: string;
  selected: boolean;
  validRange: (from: string, to: string) => boolean;
  onApply: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [{ start, due }, onChange] = useState<TaskDateValue>({ start: from, due: to });
  const valid = !!start && !!due && due <= latest && validRange(start, due);
  const startCal = toCal(start);
  const dueCal = toCal(due);

  const rangeValue =
    startCal && dueCal && startCal.compare(dueCal) <= 0 ? { start: startCal, end: dueCal } : null;
  const triggerLabel = `${fmt(from)} – ${fmt(to)}`;

  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        if (next) onChange({ start: from, due: to });
        setOpen(next);
      }}
    >
      <Button className={"task-daterange__trigger" + (selected ? " active" : "")} aria-pressed={selected} aria-label={"Start–end dates, " + triggerLabel}>
        <CalendarDays size={14} />
        <span>{selected ? triggerLabel : "Start–end dates"}</span>
      </Button>
      <Popover className={`${glassSurfaceClassName} task-daterange__popover`} style={{ zIndex: 100020 }} placement="bottom start">
        <Dialog aria-label="Traffic date range" className="task-daterange__dialog">
          <div className="task-daterange__inputs">
            <DateField value={startCal} onChange={(d) => onChange({ start: d ? d.toString() : null, due })}>
              <Label className="task-daterange__label">From</Label>
              <DateInput className="task-daterange__input">
                {(seg) => <DateSegment segment={seg} className="task-daterange__segment" />}
              </DateInput>
            </DateField>
            <DateField value={dueCal} onChange={(d) => onChange({ start, due: d ? d.toString() : null })}>
              <Label className="task-daterange__label">To</Label>
              <DateInput className="task-daterange__input">
                {(seg) => <DateSegment segment={seg} className="task-daterange__segment" />}
              </DateInput>
            </DateField>
          </div>

          <RangeCalendar
            aria-label="Date range"
            maxValue={toCal(latest) ?? undefined}
            className="task-daterange__calendar"
            value={rangeValue}
            onChange={(r) => onChange({ start: r.start.toString(), due: r.end.toString() })}
          >
            <header className="task-daterange__cal-header">
              <Button slot="previous" className="task-daterange__nav" aria-label="Previous month">
                <ChevronLeft size={16} />
              </Button>
              <Heading className="task-daterange__heading" />
              <Button slot="next" className="task-daterange__nav" aria-label="Next month">
                <ChevronRight size={16} />
              </Button>
            </header>
            <CalendarGrid className="task-daterange__grid">
              <CalendarGridHeader>
                {(day) => (
                  <CalendarHeaderCell className="task-daterange__weekday">{day}</CalendarHeaderCell>
                )}
              </CalendarGridHeader>
              <CalendarGridBody>
                {(date) => <CalendarCell date={date} className="task-daterange__cell" />}
              </CalendarGridBody>
            </CalendarGrid>
          </RangeCalendar>

          <div className="task-daterange__actions">
            {!valid && (
              <small role="status">Choose a valid range of up to one year ending today or earlier.</small>
            )}
            <Button
              className="task-daterange__clear"
              isDisabled={!valid}
              onPress={() => {
                if (valid) {
                  onApply(start, due);
                  setOpen(false);
                }
              }}
            >
              Apply
            </Button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
