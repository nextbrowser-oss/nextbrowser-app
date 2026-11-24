export function accountDisplayName(name?: string, email?: string): string {
  return name?.trim() || email?.trim().split("@")[0] || "";
}

export function accountInitials(displayName: string): string {
  const words = displayName.normalize("NFC").match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu);
  if (!words?.length) return "";
  const letters = (word: string) => word.match(/[\p{L}\p{N}]\p{M}*/gu) ?? [];
  if (words.length === 1) return letters(words[0]).slice(0, 2).join("").toUpperCase();
  return [letters(words[0])[0], letters(words[words.length - 1])[0]].join("").toUpperCase();
}

export function accountAvatarHues(ownerId: string): [number, number] {
  let hash = 2166136261;
  for (const ch of ownerId.trim().toLowerCase()) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  const start = hash % 360;
  return [start, (start + 42 + ((hash >>> 12) % 50)) % 360];
}
