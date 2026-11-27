import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { IDENTITY, TEAM, refreshUpdateMetadata, signatureEvidence, signingEnvironment } from './macos-signing.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const hash = bytes => createHash('sha512').update(bytes).digest('base64');
const signature = `Authority=${IDENTITY}\nAuthority=Developer ID Certification Authority\nTeamIdentifier=${TEAM}\nCodeDirectory v=20500 flags=0x10000(runtime)\nCDHash=${'a'.repeat(40)}\n`;

test('production verification rejects ad-hoc, wrong-team and non-hardened signatures', () => {
  assert.equal(signatureEvidence(signature).team, TEAM);
  assert.throws(() => signatureEvidence(signature.replace(`Authority=${IDENTITY}`, 'Signature=adhoc')));
  assert.throws(() => signatureEvidence(signature.replace(`TeamIdentifier=${TEAM}`, 'TeamIdentifier=OTHERTEAM1')));
  assert.throws(() => signatureEvidence(signature.replace('0x10000(runtime)', '0x0(none)')));
  assert.equal(signatureEvidence(signature.replace('0x10000(runtime)', '0x0(none)'), false).team, TEAM);
});

test('the corporate job uses existing keychains even if the runner has legacy import/account variables', () => {
  const env = signingEnvironment({ PATH: '/bin', CSC_LINK: 'legacy-p12', CSC_KEY_PASSWORD: 'legacy-password', APPLE_ID: 'legacy-account', APPLE_API_KEY: 'legacy-api-file' }, { keychain: '/keys/prod.keychain', notaryKeychain: '/keys/notary.keychain', profile: 'ci' });
  assert.equal(env.PATH, '/bin');
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_API_KEY']) assert.equal(env[key], undefined);
  assert.equal(env.CSC_KEYCHAIN, '/keys/prod.keychain');
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, 'ci');
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'macos-metadata-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dmg = Buffer.alloc(48_000, 'd');
  const zip = Buffer.alloc(30_000, 'z');
  await fs.writeFile(path.join(dir, 'app.dmg'), dmg);
  await fs.writeFile(path.join(dir, 'app.zip'), zip);
  const metadata = { version: '0.2.73-rc.2', files: [{ url: 'app.dmg', sha512: hash(dmg), size: dmg.length }, { url: 'app.zip', sha512: hash(zip), size: zip.length }], path: 'app.zip', sha512: hash(zip), releaseDate: '2026-11-05T00:00:00Z' };
  await fs.writeFile(path.join(dir, 'latest-mac.yml'), yaml.dump(metadata));
  return { dir, dmg, zip, metadata };
}

test('stapling changes final DMG hashes and blockmaps while the ZIP retains its original bytes', async t => {
  const { dir, dmg, zip } = await fixture(t);
  const stapled = Buffer.concat([dmg, Buffer.from('notarization-ticket')]);
  await fs.writeFile(path.join(dir, 'app.dmg'), stapled);
  await refreshUpdateMetadata(dir, '0.2.73-rc.2');
  const metadata = yaml.load(await fs.readFile(path.join(dir, 'latest-mac.yml'), 'utf8'));
  assert.equal(metadata.files.find(f => f.url === 'app.dmg').sha512, hash(stapled));
  assert.equal(metadata.files.find(f => f.url === 'app.dmg').size, stapled.length);
  assert.equal(metadata.sha512, hash(zip));
  assert.deepEqual(await fs.readFile(path.join(dir, 'app.zip')), zip);
  for (const [name, size] of [['app.dmg', stapled.length], ['app.zip', zip.length]]) {
    const blockmap = JSON.parse(gunzipSync(await fs.readFile(path.join(dir, `${name}.blockmap`))));
    assert.equal(blockmap.files.flatMap(f => f.sizes).reduce((sum, n) => sum + n, 0), size);
  }
});

test('wrong release versions and escaping updater URLs fail before rewriting metadata', async t => {
  const { dir, metadata } = await fixture(t);
  const original = await fs.readFile(path.join(dir, 'latest-mac.yml'));
  await assert.rejects(refreshUpdateMetadata(dir, '0.2.74'));
  assert.deepEqual(await fs.readFile(path.join(dir, 'latest-mac.yml')), original);
  for (const url of ['../app.dmg', '..%2fapp.dmg', '..\\app.dmg']) {
    const unsafe = structuredClone(metadata);
    unsafe.files[0].url = url;
    await fs.writeFile(path.join(dir, 'latest-mac.yml'), yaml.dump(unsafe));
    await assert.rejects(refreshUpdateMetadata(dir, metadata.version));
  }
});
