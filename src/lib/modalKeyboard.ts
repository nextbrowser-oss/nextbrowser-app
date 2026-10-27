export function shouldDismissModalWithEscape(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "Escape";
}

/**
 * Where Tab moves focus to keep it inside a dialog: from the last control
 * back to the first, with Shift from the first back to the last, and from
 * outside the dialog (focus lost to the page) onto its first or last control.
 * Undefined lets the browser move focus as usual.
 */
export function wrappedFocusTarget<T>(focusable: readonly T[], active: T | null, inside: boolean, backwards: boolean): T | undefined {
  if (!focusable.length) return undefined;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (backwards) return !inside || active === first ? last : undefined;
  return !inside || active === last ? first : undefined;
}
