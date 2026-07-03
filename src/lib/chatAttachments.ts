import type { ChatAttachment } from "../types";

export function promptWithAttachments(text: string, attachments: ChatAttachment[]): string {
  if (!attachments.length) return text;
  return `${text}\n\n[Attached local files — open/read these exact paths:]\n${attachments
    .map((file) => `- ${file.path}`)
    .join("\n")}`;
}
