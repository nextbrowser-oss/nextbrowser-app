import { useSyncExternalStore } from "react";

export interface AccountAppearance {
  nickname?: string;
  avatar?: string;
}
const key = (owner: string) => "nextbrowser.account-appearance." + owner;
const changed = "nextbrowser:account-appearance";
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(changed, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useAccountAppearance(owner?: string): AccountAppearance {
  const raw = useSyncExternalStore(subscribe, () => (owner ? localStorage.getItem(key(owner)) : null));
  try {
    return JSON.parse(raw || "{}") || {};
  } catch {
    return {};
  }
}
export function saveAppearance(owner: string, value: AccountAppearance) {
  localStorage.setItem(key(owner), JSON.stringify(value));
  window.dispatchEvent(new Event(changed));
}
export async function avatarImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw Error("Choose a PNG, JPEG or WebP image under 8 MiB.");
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 144;
    const side = Math.min(image.width, image.height);
    const context = canvas.getContext("2d");
    if (!context || !side) throw Error("Could not read this image.");
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      144,
      144,
    );
    return canvas.toDataURL("image/png");
  } finally {
    image.close();
  }
}
