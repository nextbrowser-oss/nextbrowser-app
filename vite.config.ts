import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";
import { execFileSync } from "node:child_process";

const releaseTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME?.replace(/^v/, "") : undefined;
let displayVersion = releaseTag || pkg.version;
if (!releaseTag) {
  try {
    const branch = process.env.GITHUB_REF_NAME || execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
    const nextVersion = /^releases\/next-(\d+\.\d+\.\d+)-dev$/.exec(branch)?.[1];
    if (nextVersion) {
      displayVersion = `${nextVersion} (dev)`;
      const revision = execFileSync("git", ["describe", "--always", "--dirty", "--exclude", "*"], { encoding: "utf8" }).trim();
      displayVersion = `${nextVersion} (dev · ${revision})`;
    } else if (branch !== `release/v${pkg.version}`) {
      displayVersion = `${execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { encoding: "utf8" }).trim().replace(/^v/, "")} (dev)`;
    }
  } catch { if (displayVersion === pkg.version) displayVersion = `${pkg.version} (dev)`; }
}

// Electron loads this Vite server in development and `dist/index.html` in production.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(displayVersion),
  },
  server: {
    port: 1421,
    strictPort: true,
  },
  build: {
    rollupOptions: { input: { app: 'index.html', start: 'start.html' } },
    target: "es2020",
    // Match Electron 43's Chromium engine rather than legacy web browsers.
    // Modern Chromium no longer accepts -webkit-backdrop-filter.
    cssTarget: "chrome150",
    outDir: "dist",
  },
});
