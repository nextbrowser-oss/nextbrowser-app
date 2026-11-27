const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function findBrowser() {
  let choices;
  if (process.platform === 'win32') {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    choices = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe']
      .flatMap(binary => bases.map(base => path.join(base, binary)));
  } else if (process.platform === 'darwin') {
    choices = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].flatMap(name =>
      ['/Applications', path.join(os.homedir(), 'Applications')].map(base => path.join(base, name + '.app', 'Contents', 'MacOS', name)));
  } else {
    choices = ['/usr/bin/google-chrome-stable','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge','/usr/bin/brave-browser','/snap/bin/chromium'];
  }
  for (const file of choices) {
    try { await fs.access(file, fs.constants.X_OK); if ((await fs.stat(file)).isFile()) return file; } catch { /* Check the next installation. */ }
  }
  throw Error('Install Chrome, Edge, Chromium or Brave to open an isolated browser profile.');
}

function importPage(executable) {
  if (/msedge|microsoft[ -]edge/i.test(executable)) return 'edge://settings/profiles/importBrowsingData';
  if (/brave/i.test(executable)) return 'brave://settings/importData';
  return 'chrome://settings/importData';
}

async function openBrowser(directory, url, binary, restore = false) {
  const executable = binary || await findBrowser();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const args = ['--user-data-dir=' + directory, '--no-first-run', '--no-default-browser-check'];
  if (restore) args.push('--restore-last-session');
  if (url) args.push('--new-window', url);
  const child = spawn(executable, args, { detached: true, stdio: 'ignore', shell: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  return child;
}
module.exports = { openBrowser, findBrowser, importPage };
