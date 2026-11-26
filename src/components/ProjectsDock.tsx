import { translate } from "../shared/lib/i18n";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { settingsStorage } from "../lib/settingsStorage";
import { glassSurfaceClassName } from "../shared/ui";

const widthKey = "nextbrowser.projectsDockWidth";
const minWidth = 176;

export function ProjectsDock({ children }: { children: ReactNode }) {
  const [preferred, setPreferred] = useState(() => {
    const saved = Number(settingsStorage.getItem(widthKey));
    return Number.isFinite(saved) && saved >= minWidth ? saved : undefined;
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragWidth, setDragWidth] = useState<number>();
  const drag = useRef<{ id: number; x: number; width: number }>();
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const maxWidth = Math.max(minWidth, Math.min(640, Math.floor(viewport / 2)));
  const clamp = (value: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(value)));
  const width = clamp(dragWidth ?? preferred ?? Math.min(280, viewport * 0.22));

  function save(value: number) {
    setPreferred(value);
    settingsStorage.setItem(widthKey, String(value));
  }
  function updateDrag(event: PointerEvent<HTMLDivElement>, finish = false) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const next = clamp(start.width + event.clientX - start.x);
    if (!finish) { setDragWidth(next); return; }
    if (next !== start.width) save(next);
    drag.current = undefined;
    setDragWidth(undefined);
  }
  function cancelDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = undefined;
    setDragWidth(undefined);
  }
  return <>
    <aside id="pinned-projects" aria-label={translate("Projects")} className={glassSurfaceClassName + " projects-dock"} style={{ width }}>
      {children}
    </aside>
    <div role="separator" tabIndex={0} aria-label={translate("Resize Projects")} aria-orientation="vertical" aria-controls="pinned-projects"
      aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={width + " px"}
      className="resize-handle projects-dock-resizer" data-resizing={dragWidth !== undefined || undefined}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width };
        setDragWidth(width);
      }}
      onPointerMove={event => updateDrag(event)} onPointerUp={event => updateDrag(event, true)}
      onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
      onKeyDown={event => {
        let next: number;
        switch (event.key) {
          case "ArrowLeft": next = width - 16; break;
          case "ArrowRight": next = width + 16; break;
          case "Home": next = minWidth; break;
          case "End": next = maxWidth; break;
          default: return;
        }
        event.preventDefault();
        save(clamp(next));
      }} />
  </>;
}
