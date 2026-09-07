/** Dev-only UI preview for screenshot parity (`?preview=login|main&tab=guide`). */
export type PreviewMode = "login" | "main" | "onboarding" | null;

export function getPreviewMode(): PreviewMode {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search).get("preview");
  if (p === "login" || p === "main" || p === "onboarding") return p;
  return null;
}

export function getPreviewTab(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("tab");
}

export function getPreviewNodeMavenState(): "active" | "exhausted" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("nodemaven");
  return value === "active" || value === "exhausted" ? value : null;
}
