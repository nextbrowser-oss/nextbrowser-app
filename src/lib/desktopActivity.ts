/**
 * Count a UTC minute only when a user interacts with the visible foreground
 * app. Activity is never inferred from a window remaining open or from a
 * background timer. The reported signal includes no event contents.
 */
export function observeDesktopActivity(report: () => Promise<unknown>): () => void {
  let lastReportedMinute: number | undefined;
  const observe = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== "visible" || !document.hasFocus()) return;
    if (event instanceof KeyboardEvent && event.repeat) return;
    const minute = Math.floor(Date.now() / 60_000);
    if (lastReportedMinute === minute) return;
    lastReportedMinute = minute;
    void report().catch(() => undefined);
  };
  const events = ["pointerdown", "keydown", "wheel"] as const;
  for (const event of events) window.addEventListener(event, observe, { capture: true, passive: true });
  return () => {
    for (const event of events) window.removeEventListener(event, observe, true);
  };
}
