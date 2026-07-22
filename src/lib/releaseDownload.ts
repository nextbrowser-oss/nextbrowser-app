import { latestReleaseUrl, repoUrl } from "../constants";

export function releaseDownloadUrl(
  version: string | undefined,
  platform: string,
  arch: string,
): string {
  const cleanVersion = version?.trim().replace(/^v/i, "");
  if (!cleanVersion || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(cleanVersion)) {
    return latestReleaseUrl;
  }

  let asset: string | undefined;
  if (platform === "darwin" && arch === "arm64") {
    asset = `NextBrowser-${cleanVersion}-arm64.dmg`;
  } else if (platform === "win32" && arch === "x64") {
    asset = `NextBrowser-${cleanVersion}-x64.exe`;
  }

  return asset
    ? `${repoUrl}/releases/download/v${cleanVersion}/${asset}`
    : latestReleaseUrl;
}
