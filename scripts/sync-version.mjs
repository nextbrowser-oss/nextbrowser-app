import fs from "node:fs";

const raw = process.argv[2] ?? "";
const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Expected a semantic version or v-prefixed tag, got: ${raw}`);
}

for (const file of ["package.json", "package-lock.json"]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.version = version;
  if (file === "package-lock.json" && data.packages?.[""]) data.packages[""].version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
