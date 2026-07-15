const { app, BrowserWindow } = require('electron');
const path = require('path');
const ipc = require('./ipc');
const auth = require('./auth');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    center: true,
    resizable: false,       // fixed window - no resizing
    maximizable: false,     // no maximize
    fullscreenable: false,  // no fullscreen (blocks F11)
    backgroundColor: '#0f1512',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Belt-and-braces: block any programmatic/OS attempt to maximize or go fullscreen.
  win.on('maximize', () => win.unmaximize());
  win.on('enter-full-screen', () => win.setFullScreen(false));

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(async () => {
  ipc.register();
  createWindow();

  // Discord Rich Presence (no-op if no client id / Discord not running).
  try { require('./discord').init(); } catch { /* optional */ }

  // Self-update check (packaged builds only).
  require('./updater').init();

  // Try to restore the saved Microsoft session in the background.
  auth.restore().then((profile) => {
    if (profile) ipc.emit('auth-restored', { profile });
  }).catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { try { require('./discord').shutdown(); } catch { /* */ } });
