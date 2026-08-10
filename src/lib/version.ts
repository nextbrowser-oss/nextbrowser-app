export function normalizeNextctlVersion(version: string): string {
  return version.trim().replace(/^(?:nextctl|nbc)\s+/i, "");
}
