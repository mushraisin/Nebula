// Launcher self-update via electron-updater. The feed is the public GitHub
// Releases of mushraisin/Nebula (configured in package.json build.publish and
// baked into app-update.yml at build time). Checks the release's latest.yml,
// downloads a new version in the background, notifies the renderer, and
// installs on restart.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const ipc = require('./ipc');

let started = false;

function init() {
  // Auto-update only works in a packaged build (needs app-update.yml).
  if (started || !app.isPackaged) return;
  started = true;

  autoUpdater.autoDownload = true;          // download the update in background
  autoUpdater.autoInstallOnAppQuit = true;  // apply it on next quit if not restarted sooner

  autoUpdater.on('update-available', (i) => ipc.emit('update-available', { version: i.version }));
  autoUpdater.on('download-progress', (p) => ipc.emit('update-progress', { percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => ipc.emit('update-downloaded', { version: i.version }));
  autoUpdater.on('error', (e) => ipc.emit('update-error', { message: String((e && e.message) || e) }));

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline / no feed */ });
  check();
  setInterval(check, 30 * 60 * 1000); // re-check every 30 min
}

module.exports = { init };
