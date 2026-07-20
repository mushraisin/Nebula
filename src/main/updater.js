// Self-update WITHOUT an installer.
//
// The newest GitHub release ships a portable zip plus a small portable.json
// manifest ({ version, zip, sha512, size }). We download that zip, verify it,
// unpack it to a staging folder, and — because Windows keeps the running
// executable locked — hand the swap to a tiny detached .cmd helper that waits
// for this process to exit, mirrors the staged files over the app folder and
// relaunches. After the restart the app IS the new version.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { open, readAllEntries, openEntryReadStream } = require('@xmcl/unzip');
const { downloadSegmented, verify } = require('./download');
const ipc = require('./ipc');

const REPO = 'mushraisin/Nebula';
const RELEASE_BASE = `https://github.com/${REPO}/releases/latest/download`;

let started = false;
let staged = null;      // folder holding the unpacked new version
let busy = false;

// numeric "1.2.3" compare -> >0 when a is newer
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function unzip(file, dest) {
  const zip = await open(file, { lazyEntries: true, autoClose: false });
  try {
    const entries = await readAllEntries(zip);
    for (const e of entries) {
      if (e.fileName.endsWith('/')) continue;
      const out = path.join(dest, e.fileName);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const stream = await openEntryReadStream(zip, e);
      await pipeline(stream, fs.createWriteStream(out));
    }
  } finally { try { zip.close(); } catch { /* ignore */ } }
}

function updateDir() { return path.join(app.getPath('temp'), 'nebula-update'); }

// Tolerant JSON fetch: a UTF-8 BOM would otherwise blow up JSON.parse.
async function fetchManifest(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'NebulaLauncher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse((await res.text()).replace(/^\uFEFF/, ''));
}

async function check() {
  if (busy || staged) return;
  let manifest;
  try { manifest = await fetchManifest(`${RELEASE_BASE}/portable.json?t=${Date.now()}`); }
  catch { return; }                                   // offline / no manifest yet
  if (!manifest || !manifest.version || !manifest.zip) return;
  if (cmpVersion(manifest.version, app.getVersion()) <= 0) return;

  busy = true;
  ipc.emit('update-available', { version: manifest.version });
  try {
    const dir = updateDir();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const zipFile = path.join(dir, manifest.zip);
    await downloadSegmented(`${RELEASE_BASE}/${manifest.zip}`, zipFile, {
      segments: 6,
      onProgress: (r, t) => ipc.emit('update-progress', { percent: t ? Math.round((r / t) * 100) : 0 })
    });
    if (manifest.sha512 && !(await verify(zipFile, manifest.sha512, 'sha512'))) {
      throw new Error('хеш оновлення не збігається');
    }

    const staging = path.join(dir, 'staging');
    await unzip(zipFile, staging);
    const exeName = path.basename(app.getPath('exe'));
    if (!fs.existsSync(path.join(staging, exeName))) throw new Error(`в архіві немає ${exeName}`);
    fs.rmSync(zipFile, { force: true });

    staged = staging;
    ipc.emit('update-downloaded', { version: manifest.version });
  } catch (e) {
    ipc.emit('update-error', { message: String((e && e.message) || e) });
  } finally { busy = false; }
}

// Swap the files and relaunch. Runs a detached helper because the running
// executable cannot overwrite itself.
function applyAndRestart() {
  if (!staged || !fs.existsSync(staged)) { app.relaunch(); app.quit(); return true; }
  const exe = app.getPath('exe');
  const appDir = path.dirname(exe);
  const helper = path.join(app.getPath('temp'), 'nebula-apply-update.cmd');
  const script = [
    '@echo off',
    'setlocal',
    ':wait',
    `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
    'if not errorlevel 1 (',
    '  ping -n 2 127.0.0.1 >nul',
    '  goto wait',
    ')',
    // /E keeps files we do not ship (e.g. the NSIS uninstaller) instead of wiping them
    `robocopy "${staged}" "${appDir}" /E /R:2 /W:1 /NFL /NDL /NJH /NJS >nul`,
    `start "" "${exe}"`,
    `rmdir /s /q "${updateDir()}"`,
    'del "%~f0"'
  ].join('\r\n');
  fs.writeFileSync(helper, script, 'utf8');
  spawn('cmd.exe', ['/c', helper], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.quit();
  return true;
}

function init() {
  // Needs a packaged Windows build: in dev there is nothing to replace.
  if (started || !app.isPackaged || process.platform !== 'win32') return;
  started = true;
  check();
  setInterval(check, 30 * 60 * 1000);
}

module.exports = { init, check, applyAndRestart, cmpVersion };
