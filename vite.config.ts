import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// Electron loads this Vite server in development and `dist/index.html` in production.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
