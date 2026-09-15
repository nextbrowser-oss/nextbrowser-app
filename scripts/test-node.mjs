import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Discover Node tests automatically; Vitest must not execute these files.
const files = ["electron", "scripts"].flatMap((dir) => readdirSync(dir)
  .filter((name) => name.endsWith(".test.cjs") || name.endsWith(".node.mjs"))
  .map((name) => `${dir}/${name}`)).sort();
if (!files.length) throw new Error("No Node tests found");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
