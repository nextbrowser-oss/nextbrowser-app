export function terminalWebLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export async function openTerminalWebLink(
  value: string,
  open: (url: string) => Promise<unknown>,
): Promise<boolean> {
  const url = terminalWebLink(value);
  if (!url) return false;
  await open(url);
  return true;
}
