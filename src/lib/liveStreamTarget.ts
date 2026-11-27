import type { MultiloginProfileSelection } from "./multiloginSelection";

export type LocalLiveTarget = { runtime: "clawbrowser" | "dasbrowser" | "camoufox"; profile?: string };

export type LiveStreamTarget =
  | LocalLiveTarget
  | { runtime: "multilogin"; selection: MultiloginProfileSelection };

export function multiloginSessionName(selection: MultiloginProfileSelection): string {
  const safeID = selection.id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `mlx-${selection.kind}-${safeID || "profile"}`.slice(0, 120);
}

export function nextctlRemoteArgs(target: LiveStreamTarget): string[] {
  if (target.runtime !== "multilogin") {
    return [
      "remote",
      ...(target.runtime !== "clawbrowser" ? ["--runtime", target.runtime] : []),
      ...(target.profile ? ["--profile", target.profile] : []),
      "--quality", "78", "--max-width", "1600", "--max-height", "900",
      "--include-viewer-url", "--format", "json",
    ];
  }

  const { selection } = target;
  const common = ["--runtime", "multilogin"];
  if (selection.folderId) common.push("--multilogin-folder-id", selection.folderId);
  if (selection.kind === "mobile") {
    return [...common, "mobile", "remote", selection.id, "--include-viewer-url", "--format", "json"];
  }
  return [
    ...common,
    "--profile", multiloginSessionName(selection),
    "--multilogin-profile-id", selection.id,
    "--multilogin-headless",
    "start", "--remote", "--format", "json",
  ];
}
