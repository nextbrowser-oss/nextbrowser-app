export const GUIDE_DRAFT_KEY = "nextbrowser.guideDraft";

type GuideDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function saveGuideDraft(storage: GuideDraftStorage, prompt: string): string | undefined {
  const value = prompt.trim();
  if (!value) return undefined;
  storage.setItem(GUIDE_DRAFT_KEY, value);
  return value;
}

export function takeGuideDraft(storage: GuideDraftStorage): string | undefined {
  const value = storage.getItem(GUIDE_DRAFT_KEY)?.trim();
  storage.removeItem(GUIDE_DRAFT_KEY);
  return value || undefined;
}

export function openGuideChatDraft(
  storage: GuideDraftStorage,
  prompt: string,
  navigation: {
    setTerminalChat: (value: boolean) => void;
    setTab: (tab: "chat") => void;
    dispatch?: (prompt: string) => void;
  },
): string | undefined {
  const value = saveGuideDraft(storage, prompt);
  if (!value) return undefined;
  navigation.setTerminalChat(false);
  navigation.dispatch?.(value);
  navigation.setTab("chat");
  return value;
}
