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
//
// All paths that may contain non-ASCII (e.g. a Cyrillic Windows username in
// %TEMP%) are passed to the helper via environment variables, NOT written into
// the .cmd text — cmd.exe reads batch files in the OEM codepage and would
// mangle UTF-8 paths, which silently broke the update for such users. The batch
// body itself is pure ASCII. It also waits for EVERY Nebula.exe (the main
// process AND Electron's helper processes) to exit, so nothing holds a file
// lock when robocopy runs.
function applyAndRestart() {
  try {
    if (!staged || !fs.existsSync(staged)) { app.relaunch(); app.quit(); return true; }
    const exe = app.getPath('exe');
    const exeName = path.basename(exe);
    const appDir = path.dirname(exe);
    const helper = path.join(app.getPath('temp'), 'nebula-apply-update.cmd');
    const log = path.join(app.getPath('temp'), 'nebula-update.log');
    const script = [
      '@echo off',
      'echo [Nebula] applying update > "%NEB_LOG%" 2>&1',
      ':wait',
      `tasklist /FI "IMAGENAME eq ${exeName}" 2>nul | find /I "${exeName}" >nul`,
      'if not errorlevel 1 (',
      '  ping -n 2 127.0.0.1 >nul',
      '  goto wait',
      ')',
      'ping -n 3 127.0.0.1 >nul',
      // /E keeps files we do not ship (e.g. the NSIS uninstaller) instead of wiping them
      'robocopy "%NEB_STAGED%" "%NEB_DIR%" /E /R:8 /W:1 /NFL /NDL /NJH /NJS >> "%NEB_LOG%" 2>&1',
      'echo robocopy exit %errorlevel% >> "%NEB_LOG%" 2>&1',
      'start "" "%NEB_EXE%"',
      'rmdir /s /q "%NEB_UPD%"',
      'del "%~f0"'
    ].join('\r\n');
    fs.writeFileSync(helper, script, 'utf8');
    spawn('cmd.exe', ['/c', helper], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, NEB_STAGED: staged, NEB_DIR: appDir, NEB_EXE: exe, NEB_UPD: updateDir(), NEB_LOG: log }
    }).unref();
    // Force-exit so the launcher (and its helper processes) actually release the
    // files; a plain quit() can be cancelled and would leave the helper waiting.
    setTimeout(() => { try { app.exit(0); } catch { app.quit(); } }, 300);
    return true;
  } catch (e) {
    ipc.emit('update-error', { message: 'Не вдалось застосувати оновлення: ' + String(e.message || e) });
    return false;
  }
}

function init() {
  // Needs a packaged Windows build: in dev there is nothing to replace.
  if (started || !app.isPackaged || process.platform !== 'win32') return;
  started = true;
  check();
  setInterval(check, 30 * 60 * 1000);
}

module.exports = { init, check, applyAndRestart, cmpVersion };
