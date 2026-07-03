export function normalizeClawctlVersion(version: string): string {
  return version.trim().replace(/^clawctl\s+/i, "");
}
