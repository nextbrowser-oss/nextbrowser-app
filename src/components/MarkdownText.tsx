import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "../electronBridge";
import { Icon } from "./Icon";

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
    if (isLocalPath(raw) && match.index != null) {
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

function isLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function childText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childText).join("");
  return "";
}

function LocalFileCard({ path, label }: { path: string; label: string }) {
  return (
    <span className="local-file-card" title={path}>
      <Icon name="doc" size={15} />
      <span className="local-file-name">{label || fileNameFromPath(path)}</span>
      <button className="local-file-open" onClick={() => void invoke("open_path", { path })}>Open</button>
      <button
        className="local-file-reveal plain-icon-btn plain-icon-btn-compact"
        title="Show in Finder / Explorer"
        aria-label={`Show ${label || fileNameFromPath(path)} in folder`}
        onClick={() => void invoke("open_path", { path: containingFolderPath(path) })}
      >
        <Icon name="folder" size={13} />
      </button>
    </span>
  );
}

const markdownComponents: Components = {
  a({ href = "", children }) {
    const decodedHref = (() => {
      try { return decodeURI(href); } catch { return href; }
    })();
    if (isLocalPath(decodedHref)) {
      return <LocalFileCard path={decodedHref} label={childText(children)} />;
    }
    const external = /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
    const open = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!external) return;
      event.preventDefault();
      void invoke("open_external", { url: href });
    };
    return <a href={href} onClick={open} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{children}</a>;
  },
};

/** Safe GitHub-flavored Markdown for agent replies; raw HTML is not enabled. */
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
