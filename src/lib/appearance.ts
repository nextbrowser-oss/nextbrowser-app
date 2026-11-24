export const colorFields = {
  accent: { label: "App accent", token: "--accent" },
  background: { label: "Chat background", token: "--bg" },
  outgoing: { label: "Your messages", token: "--primary-action" },
  incoming: { label: "Agent messages", token: "--bg-elevated" },
} as const;

export type ColorField = keyof typeof colorFields;
export type Wallpaper = "glow" | "solid" | "gradient" | "dots" | "photo";
export interface Appearance extends Partial<Record<ColorField, string>> {
  wallpaper?: Wallpaper;
  gradientEnd?: string;
  photo?: string;
  radius?: number;
}
export type UpdateAppearance = (patch: Partial<Appearance> | null) => void;

const maxPhotoLength = 640_000;

export function parseAppearance(raw: string | null): Appearance {
  if (!raw) return {};
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return {};
    const clean: Appearance = {};
    const colors: (ColorField | "gradientEnd")[] = [...Object.keys(colorFields) as ColorField[], "gradientEnd"];
    for (const key of colors) {
      if (typeof saved[key] === "string" && /^#[a-f\d]{6}$/i.test(saved[key])) clean[key] = saved[key];
    }
    if (Number.isInteger(saved.radius) && saved.radius >= 4 && saved.radius <= 28) clean.radius = saved.radius;
    if (typeof saved.photo === "string" && saved.photo.length <= maxPhotoLength && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(saved.photo)) clean.photo = saved.photo;
    if (["glow", "solid", "gradient", "dots"].includes(saved.wallpaper) || (saved.wallpaper === "photo" && clean.photo)) clean.wallpaper = saved.wallpaper;
    return clean;
  } catch {
    return {};
  }
}

// Choose the higher WCAG contrast ratio of black or white against this color.
function contrastingInk(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(offset => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.1791 ? "var(--black)" : "var(--white)";
}

export function appearanceTokens(style: Appearance): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (style.accent) {
    tokens["--accent"] = tokens["--primary-action"] = style.accent;
    tokens["--on-accent"] = tokens["--on-primary-action"] = contrastingInk(style.accent);
    tokens["--accent-text"] = "color-mix(in srgb, var(--accent) 45%, var(--text))";
    tokens["--nav-active-bg"] = tokens["--accent-soft"] = "color-mix(in srgb, var(--accent) 16%, transparent)";
    tokens["--nav-active-indicator"] = tokens["--nav-active-border"] = "var(--accent-text)";
    tokens["--primary-action-hover"] = "color-mix(in srgb, var(--accent) 90%, var(--bg))";
  }
  if (style.background) {
    tokens["--chat-bg"] = style.background;
    tokens["--chat-toolbar-text"] = tokens["--chat-toolbar-muted"] = contrastingInk(style.background);
  }
  if (style.background || style.wallpaper === "gradient" || style.wallpaper === "photo") {
    tokens["--chat-caption-bg"] = "var(--panel)";
    tokens["--chat-empty-surface"] = "var(--panel)";
  }
  if (style.incoming) {
    tokens["--chat-incoming"] = style.incoming;
    tokens["--chat-incoming-ink"] = contrastingInk(style.incoming);
  }
  if (style.outgoing) {
    tokens["--chat-outgoing"] = style.outgoing;
    tokens["--chat-outgoing-ink"] = contrastingInk(style.outgoing);
  }
  if (style.radius !== undefined) tokens["--chat-radius"] = style.radius + "px";
  if (style.wallpaper === "solid") tokens["--chat-wallpaper"] = "none";
  if (style.wallpaper === "gradient") {
    tokens["--chat-wallpaper"] = `linear-gradient(135deg, var(--chat-bg), ${style.gradientEnd ?? "var(--primary-action)"})`;
  }
  if (style.wallpaper === "dots") {
    tokens["--chat-wallpaper"] = "radial-gradient(circle, var(--line-strong) 1px, transparent 1.4px)";
    tokens["--chat-wallpaper-size"] = "14px 14px";
  }
  if (style.wallpaper === "photo" && style.photo) {
    tokens["--chat-wallpaper"] = `linear-gradient(var(--chat-photo-tint), var(--chat-photo-tint)), url("${style.photo}")`;
  }
  return tokens;
}

export async function readWallpaper(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 16 * 1024 * 1024) {
    throw new Error("Choose a PNG, JPEG, or WebP image under 16 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not open the image.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45, 0.30]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.startsWith("data:image/jpeg;base64,") && data.length <= maxPhotoLength) return data;
    }
    throw new Error("Choose a smaller image.");
  } finally {
    bitmap.close();
  }
}
