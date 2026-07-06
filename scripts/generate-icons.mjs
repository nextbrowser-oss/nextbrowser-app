import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
const LOGO_VIEWBOX_SIZE = 32;
const LOGO_CORNER_RADIUS = 5;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC_TABLE.length; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

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

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readChunks(buffer) {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error("Invalid PNG signature.");
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodeRgbaPng(file) {
  const chunks = readChunks(fs.readFileSync(file));
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!ihdr) throw new Error("PNG is missing IHDR.");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Expected 8-bit RGBA PNG, got bitDepth=${bitDepth}, colorType=${colorType}.`);
  }
  const compressed = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  const raw = zlib.inflateSync(compressed);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const row = raw.subarray(src, src + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? out[x - bytesPerPixel] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
      out[x] = value & 0xff;
    }
    src += stride;
  }
  return { width, height, pixels };
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function writeRgbaPng(file, image) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    image.pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  fs.writeFileSync(file, Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND"),
  ]));
}

function roundedRectAlpha(x, y, width, height, radius) {
  const cx = Math.min(Math.max(x, radius), width - radius);
  const cy = Math.min(Math.max(y, radius), height - radius);
  const distance = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius + 0.5 - distance));
}

function applyRoundedIconMask(file) {
  const image = decodeRgbaPng(file);
  const radius = (Math.min(image.width, image.height) * LOGO_CORNER_RADIUS) / LOGO_VIEWBOX_SIZE;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = roundedRectAlpha(x + 0.5, y + 0.5, image.width, image.height, radius);
      const offset = (y * image.width + x) * 4 + 3;
      image.pixels[offset] = Math.round(image.pixels[offset] * alpha);
    }
  }
  writeRgbaPng(file, image);
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
    const images = ICO_SIZES.map((size) => {
      const file = path.join(tmpDir, `icon-${size}.png`);
      resizePng(source1024, size, file);
      return { size, data: fs.readFileSync(file) };
    });
    const headerSize = 6;
    const entrySize = 16;
    const imageOffset = headerSize + entrySize * images.length;
    const totalSize = imageOffset + images.reduce((sum, image) => sum + image.data.length, 0);
    const ico = Buffer.alloc(totalSize);
    ico.writeUInt16LE(0, 0);
    ico.writeUInt16LE(1, 2);
    ico.writeUInt16LE(images.length, 4);
    let offset = imageOffset;
    images.forEach((image, index) => {
      const entry = headerSize + index * entrySize;
      ico.writeUInt8(image.size === 256 ? 0 : image.size, entry);
      ico.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
      ico.writeUInt8(0, entry + 2);
      ico.writeUInt8(0, entry + 3);
      ico.writeUInt16LE(1, entry + 4);
      ico.writeUInt16LE(32, entry + 6);
      ico.writeUInt32LE(image.data.length, entry + 8);
      ico.writeUInt32LE(offset, entry + 12);
      image.data.copy(ico, offset);
      offset += image.data.length;
    });
    fs.writeFileSync(iconIco, ico);
    console.log(`Wrote ${path.relative(root, iconIco)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

syncLogo();
renderLogoPng(iconPng, 1024);
applyRoundedIconMask(iconPng);
console.log(`Wrote ${path.relative(root, iconPng)}`);
buildIcns(iconPng);
buildIco(iconPng);
console.log("Done.");
