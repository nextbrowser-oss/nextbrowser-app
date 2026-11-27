const drafts = new Map<string, string>();
export function stageStartPageDraft(conversationId: string, text: string) {
  drafts.set(conversationId, text);
  window.dispatchEvent(new Event('nextbrowser:start-page-draft'));
}
export function takeStartPageDraft(conversationId?: string) {
  if (!conversationId) return;
  const text = drafts.get(conversationId); drafts.delete(conversationId); return text;
}
