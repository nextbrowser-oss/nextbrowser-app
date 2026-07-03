import { invoke } from "../electronBridge";
import { Icon } from "./Icon";
import type { ReactNode } from "react";

export interface LocalFileLink {
  label: string;
  path: string;
  start: number;
  end: number;
}

export function localFileLinks(text: string): LocalFileLink[] {
  const links: LocalFileLink[] = [];
  const pattern = /\[([^\]]+)]\(\s*(?:<([^>]+)>|([^)]+))\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = (match[2] ?? match[3] ?? "").trim();
    const local = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\");
    if (local && match.index != null) {
      links.push({ label: match[1], path: raw, start: match.index, end: match.index + match[0].length });
    }
  }
  return links;
}

export function containingFolderPath(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (slash < 0) return normalized;
  if (slash === 0) return "/";
  return normalized.slice(0, slash);
}

export function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const slash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return normalized.slice(slash + 1) || normalized;
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return <>{parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return <span key={i}>{part}</span>;
  })}</>;
}

/** Minimal inline markdown plus OS-integrated local file links. */
export function MarkdownText({ text }: { text: string }) {
  const links = localFileLinks(text);
  if (!links.length) return <span className="markdown"><InlineMarkdown text={text} /></span>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const link of links) {
    if (link.start > cursor) parts.push(<InlineMarkdown key={`text-${cursor}`} text={text.slice(cursor, link.start)} />);
    parts.push(
      <span className="local-file-card" key={`${link.path}-${link.start}`} title={link.path}>
        <Icon name="doc" size={15} />
        <span className="local-file-name">{fileNameFromPath(link.path)}</span>
        <button className="local-file-open" onClick={() => void invoke("open_path", { path: link.path })}>
          Open
        </button>
        <button
          className="local-file-reveal plain-icon-btn plain-icon-btn-compact"
          title="Show in Finder / Explorer"
          aria-label={`Show ${link.label} in folder`}
          onClick={() => void invoke("open_path", { path: containingFolderPath(link.path) })}
        >
          <Icon name="folder" size={13} />
        </button>
      </span>,
    );
    cursor = link.end;
  }
  if (cursor < text.length) parts.push(<InlineMarkdown key={`text-${cursor}`} text={text.slice(cursor)} />);
  return (
    <span className="markdown">{parts}</span>
  );
}
