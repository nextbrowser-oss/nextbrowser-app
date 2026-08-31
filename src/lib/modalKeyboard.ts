export function shouldDismissModalWithEscape(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "Escape";
}
