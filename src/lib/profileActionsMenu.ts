export function shouldDismissProfileActionsMenu(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "Escape";
}
