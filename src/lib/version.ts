export function normalizeNextctlVersion(version: string): string {
  return version.trim().replace(/^nextctl\s+/i, "");
}
