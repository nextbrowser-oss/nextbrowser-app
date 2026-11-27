import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
export const IDENTITY = 'Developer ID Application: MULTILOGIN OÜ (98Y48GDG5M)';
export const TEAM = '98Y48GDG5M';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);

async function run(command, args, timeout = 60_000, stdoutOnly = false) {
  try {
    const result = await execute(command, args, { timeout, maxBuffer: 16 * 1024 * 1024 });
    return stdoutOnly ? result.stdout : result.stdout + result.stderr;
  } catch (error) {
    // Do not stringify execFile errors: their command line may contain credentials.
    throw new Error(`${path.basename(command)} failed (${error.killed ? 'timeout' : error.code ?? 'unknown exit'}). Check the signing runner/keychain configuration.`);
  }
}

export function signatureEvidence(output, hardened = true) {
  const lines = output.split(/\r?\n/);
  assert.ok(lines.includes(`Authority=${IDENTITY}`), 'Corporate Developer ID signature is required');
  assert.ok(lines.includes(`TeamIdentifier=${TEAM}`), 'Unexpected signing team');
  assert.ok(!lines.includes('Signature=adhoc'), 'Ad-hoc signatures are not production signatures');
  if (hardened) assert.match(output, /flags=[^\r\n]*\bruntime\b/, 'Hardened runtime is required');
  const cdhash = output.match(/^CDHash=([a-f0-9]{40,64})$/mi)?.[1];
  assert.ok(cdhash, 'Missing signed code hash');
  return { identity: IDENTITY, team: TEAM, cdhash };
}

export function signingEnvironment(env, config) {
  const child = { ...env };
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) delete child[key];
  return { ...child, CSC_KEYCHAIN: config.keychain, CSC_IDENTITY_AUTO_DISCOVERY: 'true', APPLE_KEYCHAIN: config.notaryKeychain, APPLE_KEYCHAIN_PROFILE: config.profile };
}

export async function fileHash(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

export async function refreshUpdateMetadata(directory, version) {
  directory = await fs.realpath(directory);
  const metadataPath = path.join(directory, 'latest-mac.yml');
  const metadata = yaml.load(await fs.readFile(metadataPath, 'utf8'));
  assert.equal(metadata.version, version, 'Updater version differs from the signed build');
  assert.equal(metadata.files?.length, 2, 'Both DMG and updater ZIP are required');
  const resolved = [];
  for (const entry of metadata.files) {
    const name = decodeURIComponent(entry.url);
    assert.equal(path.basename(name), name, 'Updater file must be inside the output directory');
    assert.ok(!name.includes('\\') && /\.(dmg|zip)$/.test(name), 'Unexpected updater artifact');
    const file = await fs.realpath(path.join(directory, name));
    assert.equal(path.dirname(file), directory, 'Artifact symlink escaped output directory');
    resolved.push({ entry, file, name });
  }
  assert.equal(resolved.filter(item => item.name.endsWith('.dmg')).length, 1);
  assert.equal(resolved.filter(item => item.name.endsWith('.zip')).length, 1);
  const zip = resolved.find(item => item.name.endsWith('.zip'));
  assert.equal(decodeURIComponent(metadata.path), zip.name, 'Legacy updater path must identify the ZIP');
  // Stapling changes the DMG bytes after electron-builder first computes these files.
  const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
  for (const { entry, file } of resolved) {
    const info = await buildBlockMap(file, 'gzip', `${file}.blockmap`);
    entry.sha512 = info.sha512;
    entry.size = (await fs.stat(file)).size;
    delete entry.blockMapSize;
  }
  metadata.sha512 = zip.entry.sha512;
  await fs.writeFile(metadataPath, yaml.dump(metadata, { lineWidth: -1 }));
  return resolved;
}

async function configuration() {
  assert.equal(process.platform, 'darwin', 'Corporate signing must run on the corporate Mac');
  assert.equal(process.arch, 'arm64', 'The configured corporate signer is Apple Silicon');
  const { MAC_SIGNING_KEYCHAIN, MAC_NOTARY_KEYCHAIN, MAC_NOTARY_PROFILE } = process.env;
  assert.ok(MAC_SIGNING_KEYCHAIN && path.isAbsolute(MAC_SIGNING_KEYCHAIN), 'Set MAC_SIGNING_KEYCHAIN to the existing prod.keychain path');
  assert.ok(MAC_NOTARY_KEYCHAIN && path.isAbsolute(MAC_NOTARY_KEYCHAIN), 'Set the existing notarization credential keychain path');
  assert.ok(MAC_NOTARY_PROFILE?.trim(), 'Set MAC_NOTARY_PROFILE to an existing notarytool profile');
  const config = { keychain: await fs.realpath(MAC_SIGNING_KEYCHAIN), notaryKeychain: await fs.realpath(MAC_NOTARY_KEYCHAIN), profile: MAC_NOTARY_PROFILE.trim() };
  for (const file of [config.keychain, config.notaryKeychain]) {
    assert.ok((await fs.stat(file)).isFile(), 'An existing keychain file is required');
    assert.ok(!file.startsWith(`${root}${path.sep}`), 'Signing credentials must stay outside the checkout');
  }
  return config;
}

function notaryArgs(config) {
  return ['--keychain', config.notaryKeychain, '--keychain-profile', config.profile];
}

async function preflight(config) {
  const identities = await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', config.keychain]);
  assert.ok(identities.includes(`"${IDENTITY}"`), 'The corporate identity/private key is unavailable');
  await run('/usr/bin/xcrun', ['notarytool', 'history', ...notaryArgs(config), '--output-format', 'json']);
  const probeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextbrowser-sign-probe-'));
  try {
    const probe = path.join(probeDir, 'probe');
    await fs.copyFile('/usr/bin/true', probe);
    await run('/usr/bin/codesign', ['--force', '--timestamp', '--options', 'runtime', '--keychain', config.keychain, '--sign', IDENTITY, probe]);
    signatureEvidence(await run('/usr/bin/codesign', ['-dv', '--verbose=4', probe]));
  } finally { await fs.rm(probeDir, { recursive: true, force: true }); }
  console.log('Corporate keychain identity, non-interactive signing and notarization profile verified.');
}

async function verifyApp(app, version) {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const info = signatureEvidence(await run('/usr/bin/codesign', ['-dv', '--verbose=4', app]));
  await run('/usr/bin/xcrun', ['stapler', 'validate', app]);
  await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  const actual = (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app, 'Contents/Info.plist')])).trim();
  assert.equal(actual, version, 'Signed app version mismatch');
  return info;
}

async function finalize(config) {
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const directory = path.join(root, 'release');
  const files = await fs.readdir(directory);
  const dmgs = files.filter(name => name.endsWith('.dmg'));
  const zips = files.filter(name => name.endsWith('.zip'));
  assert.equal(dmgs.length, 1, 'Expected one arm64 DMG');
  assert.equal(zips.length, 1, 'Expected one arm64 updater ZIP');
  const dmg = path.join(directory, dmgs[0]);
  const zip = path.join(directory, zips[0]);
  const main = await verifyApp(path.join(directory, 'mac-arm64/NextBrowser.app'), version);
  signatureEvidence(await run('/usr/bin/codesign', ['-dv', '--verbose=4', dmg]), false);
  const submitted = JSON.parse(await run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, ...notaryArgs(config), '--wait', '--output-format', 'json'], 45 * 60_000, true));
  assert.equal(submitted.status, 'Accepted', 'Apple rejected the distribution DMG');
  await run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
  await run('/usr/bin/xcrun', ['stapler', 'validate', dmg]);
  await run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', dmg]);
  await run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
  const extracted = await fs.mkdtemp(path.join(os.tmpdir(), 'nextbrowser-signed-zip-'));
  try {
    await run('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
    assert.equal((await verifyApp(path.join(extracted, 'NextBrowser.app'), version)).cdhash, main.cdhash, 'Updater ZIP contains a different signed app');
  } finally { await fs.rm(extracted, { recursive: true, force: true }); }
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), 'nextbrowser-signed-dmg-'));
  let detached = false;
  try {
    await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]);
    try { assert.equal((await verifyApp(path.join(mount, 'NextBrowser.app'), version)).cdhash, main.cdhash, 'DMG contains a different signed app'); }
    finally { await run('/usr/bin/hdiutil', ['detach', mount]); detached = true; }
  } finally {
    // Never recurse into a mount when detach failed.
    if (detached) await fs.rmdir(mount);
  }
  await refreshUpdateMetadata(directory, version);
  const evidence = { status: 'passed', version, commit: process.env.GITHUB_SHA, ...main, notarization_id: submitted.id, dmg_and_zip_verified: true, private_key_exported: false };
  await fs.writeFile(path.join(directory, 'macos-signing-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  const output = (await fs.readdir(directory)).filter(name => /\.(dmg|zip|blockmap)$/.test(name) || ['latest-mac.yml', 'macos-signing-evidence.json'].includes(name)).sort();
  await fs.writeFile(path.join(directory, 'macos-SHA256SUMS'), (await Promise.all(output.map(async name => `${await fileHash(path.join(directory, name), 'sha256')}  ${name}`))).join('\n') + '\n');
  console.log('Corporate DMG, updater ZIP, notarization, Gatekeeper and final updater hashes verified.');
}

async function main() {
  const config = await configuration();
  await preflight(config);
  const env = signingEnvironment(process.env, config);
  const qualifier = IDENTITY.replace('Developer ID Application: ', '');
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'dist:mac', '--', `-c.mac.identity=${qualifier}`, '-c.forceCodeSigning=true', '-c.mac.hardenedRuntime=true', '-c.mac.notarize=true', '-c.dmg.sign=true'], { cwd: root, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Corporate macOS build failed (${code})`)));
  });
  await finalize(config);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
