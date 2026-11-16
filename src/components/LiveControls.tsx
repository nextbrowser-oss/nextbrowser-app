import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Glyph, IconButton, Popover } from "../shared/ui";
import { settingsStorage } from "../lib/settingsStorage";

const POSITION_KEY = "nextbrowser.liveControlsPosition";
const MARGIN = 16;
const BUTTON_SIZE = 40;
const DRAG_THRESHOLD = 5;

function loadPosition(): { x: number; y: number } {
  try {
    const position = JSON.parse(settingsStorage.getItem(POSITION_KEY) || "null");
    if (position && [position.x, position.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return position;
  } catch { /* Use the default corner. */ }
  return { x: 0, y: 1 };
}

export function LiveControls({ open, onOpenChange, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(loadPosition);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; offsetX: number; offsetY: number; moved: boolean }>();
  const suppressClick = useRef(false);

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = gesture.current;
    if (!pointer || pointer.id !== event.pointerId || !area.current) return;
    if (!pointer.moved) {
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < DRAG_THRESHOLD) return;
      pointer.moved = true;
      setDragging(true);
      if (open) onOpenChange(false);
    }
    const bounds = area.current.getBoundingClientRect();
    const fraction = (value: number, length: number) =>
      Math.max(0, Math.min(1, value / Math.max(1, length - 2 * MARGIN - BUTTON_SIZE)));
    const next = {
      x: fraction(event.clientX - bounds.left - pointer.offsetX - MARGIN, bounds.width),
      y: fraction(event.clientY - bounds.top - pointer.offsetY - MARGIN, bounds.height),
    };
    setPosition(next);
    return next;
  };

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    if (gesture.current?.id !== event.pointerId) return;
    const next = cancelled ? position : move(event);
    suppressClick.current = gesture.current.moved;
    gesture.current = undefined;
    if (next && suppressClick.current) settingsStorage.setItem(POSITION_KEY, JSON.stringify(next));
    setDragging(false);
  };

  return <div ref={area} className="live-controls-layer" style={{
    "--live-button-x": position.x, "--live-button-y": position.y,
    "--live-button-margin": `${MARGIN}px`, "--live-button-size": `${BUTTON_SIZE}px`,
  } as CSSProperties}>
    <Popover label="Live controls" open={open} onOpenChange={onOpenChange} side="right" align="end" dismissOnOutside={false}
      className="live-controls-panel shared-scrollbarless"
      trigger={props => <IconButton {...props} label={open ? "Hide Live controls" : "Show Live controls"}
        hint="" className="live-controls-trigger" aria-description="Drag to move this button"
        data-dragging={dragging || undefined}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          suppressClick.current = false;
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY,
            offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move} onPointerUp={event => finish(event)}
        onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
        onClick={event => {
          if (suppressClick.current && event.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          props.onClick?.(event);
        }}>
        <Glyph name={open ? "x" : "sliders"} size={18} />
      </IconButton>}>
      {children}
    </Popover>
  </div>;
}
