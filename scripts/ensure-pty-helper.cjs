const fs = require("node:fs");
const path = require("node:path");

function ensurePtyHelpersExecutable(root = path.join(__dirname, ".."), platform = process.platform) {
  if (platform !== "darwin") return [];
  const prebuilds = path.join(root, "node_modules", "node-pty", "prebuilds");
  if (!fs.existsSync(prebuilds)) return [];

  const updated = [];
  for (const architecture of fs.readdirSync(prebuilds)) {
    if (!architecture.startsWith("darwin-")) continue;
    const helper = path.join(prebuilds, architecture, "spawn-helper");
    if (!fs.existsSync(helper)) continue;
    const mode = fs.statSync(helper).mode & 0o777;
    if ((mode & 0o111) === 0o111) continue;
    fs.chmodSync(helper, mode | 0o755);
    updated.push(helper);
  }
  return updated;
}

if (require.main === module) {
  const updated = ensurePtyHelpersExecutable();
  if (updated.length > 0) {
    process.stdout.write(`Made ${updated.length} node-pty helper(s) executable.\n`);
  }
}

module.exports = { ensurePtyHelpersExecutable };
