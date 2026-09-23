import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";
import { execFileSync } from "node:child_process";

const releaseTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME?.replace(/^v/, "") : undefined;
let displayVersion = releaseTag || pkg.version;
if (!releaseTag) {
  try {
    displayVersion = `${execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { encoding: "utf8" }).trim().replace(/^v/, "")} (dev)`;
  } catch { displayVersion = `${pkg.version} (dev)`; }
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
    target: "es2020",
    outDir: "dist",
  },
});
