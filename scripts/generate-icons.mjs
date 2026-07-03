import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const logoSrc = path.join(root, "public", "nextbrowser-logo.svg");
const logoDest = path.join(buildDir, "nextbrowser-logo.svg");
const iconPng = path.join(buildDir, "icon.png");
const iconIcns = path.join(buildDir, "icon.icns");
const iconIco = path.join(buildDir, "icon.ico");

const MAC_ICONSET = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function run(file, args) {
  execFileSync(file, args, { stdio: "inherit" });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function syncLogo() {
  ensureDir(buildDir);
  const src = fs.readFileSync(logoSrc, "utf8");
  // qlmanage renders at the SVG's pixel size — upscale to 1024 so the icon fills the canvas.
  const iconSvg = src
    .replace(/\bwidth="32"/, 'width="1024"')
    .replace(/\bheight="32"/, 'height="1024"');
  fs.writeFileSync(logoDest, iconSvg);
  console.log(`Prepared ${path.relative(root, logoDest)} (1024px canvas)`);
}

function renderLogoPng(target, size = 1024) {
  if (process.platform !== "darwin") {
    throw new Error("SVG rendering requires macOS (qlmanage). Run this script on macOS.");
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-icons-"));
  try {
    run("qlmanage", ["-t", "-s", String(size), "-o", tmpDir, logoDest]);
    const rendered = path.join(tmpDir, `${path.basename(logoDest)}.png`);
    if (!fs.existsSync(rendered)) throw new Error(`qlmanage did not produce ${rendered}`);
    fs.copyFileSync(rendered, target);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function resizePng(source, size, target) {
  run("sips", ["-z", String(size), String(size), source, "--out", target]);
}

function buildIcns(source1024) {
  if (process.platform !== "darwin") return;
  const iconset = path.join(os.tmpdir(), `nextbrowser-${process.pid}.iconset`);
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  try {
    for (const [size, name] of MAC_ICONSET) {
      resizePng(source1024, size, path.join(iconset, name));
    }
    run("iconutil", ["-c", "icns", iconset, "-o", iconIcns]);
    console.log(`Wrote ${path.relative(root, iconIcns)}`);
  } finally {
    fs.rmSync(iconset, { recursive: true, force: true });
  }
}

function buildIco(source1024) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nextbrowser-ico-"));
  try {
    const sizes = ICO_SIZES.map((size) => {
      const file = path.join(tmpDir, `icon-${size}.png`);
      resizePng(source1024, size, file);
      return file;
    });
    const ico = execFileSync("npx", ["--yes", "png-to-ico", ...sizes], { encoding: "buffer" });
    fs.writeFileSync(iconIco, ico);
    console.log(`Wrote ${path.relative(root, iconIco)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

syncLogo();
renderLogoPng(iconPng, 1024);
console.log(`Wrote ${path.relative(root, iconPng)}`);
buildIcns(iconPng);
buildIco(iconPng);
console.log("Done.");
