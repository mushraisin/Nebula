// Wires renderer <-> main IPC. Long-running operations report progress by
// emitting 'nebula:event' messages to the window; the invoke() call resolves
// with the final result (or throws on error).
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const store = require('./store');
const auth = require('./auth');
const packs = require('./packs');
const repo = require('./repo');
const admin = require('./admin');
const versions = require('./versions');
const mods = require('./mods');
const minecraft = require('./minecraft');
const discord = require('./discord');

function emit(type, data = {}) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send('nebula:event', { type, ...data });
}

function register() {
  // ---- Window controls (frameless) ----
  ipcMain.handle('win:minimize', () => { BrowserWindow.getFocusedWindow()?.minimize(); });
  ipcMain.handle('win:maximize', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('win:close', () => { BrowserWindow.getFocusedWindow()?.close(); });

  // ---- Auth ----
  ipcMain.handle('auth:login', async () => auth.login());
  ipcMain.handle('auth:loginOffline', async (_e, name) => auth.loginOffline(name));
  ipcMain.handle('auth:logout', async () => { auth.logout(); return null; });
  ipcMain.handle('auth:profile', async () => ({ profile: auth.profile(), active: auth.isLoggedIn() }));
  ipcMain.handle('auth:accounts', async () => auth.listAccounts());
  ipcMain.handle('auth:switch', async (_e, id) => auth.switchAccount(id));
  ipcMain.handle('auth:remove', async (_e, id) => auth.removeAccount(id));

  // ---- Settings ----
  ipcMain.handle('settings:get', async () => ({
    memory: store.get('memory'),
    javaArgs: store.get('javaArgs'),
    baseDir: store.get('baseDir'),
    closeOnLaunch: store.get('closeOnLaunch'),
    discordClientId: store.get('discordClientId') || '',
    liquidGlass: store.get('liquidGlass') === true,
    theme: store.get('theme') || { bg: '#0f1512', accent: '#4fd488' }
  }));
  ipcMain.handle('settings:set', async (_e, patch) => {
    store.update((c) => Object.assign(c, patch));
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'discordClientId')) {
      try { discord.reload(); } catch { /* */ }
    }
    return true;
  });

  // ---- Repos ----
  ipcMain.handle('repo:list', async () => store.get('repos') || []);
  ipcMain.handle('repo:add', async (_e, { url, name }) => { repo.addRepo(url, name); return true; });
  ipcMain.handle('repo:remove', async (_e, url) => { repo.removeRepo(url); return true; });
  ipcMain.handle('repo:fetch', async () => repo.fetchAll());

  // ---- Admin (site launcher CRUD) ----
  ipcMain.handle('admin:config', async () => ({
    base: store.get('adminApiBase'),
    hasToken: !!store.get('adminToken')
  }));
  ipcMain.handle('admin:setConfig', async (_e, { base, token }) => {
    store.update((c) => {
      if (base != null) c.adminApiBase = base;
      if (token != null) c.adminToken = token;
    });
    return true;
  });
  ipcMain.handle('admin:verify', async () => admin.verify());
  ipcMain.handle('admin:list', async () => admin.list());
  ipcMain.handle('admin:save', async (_e, pack) => admin.save(pack));
  ipcMain.handle('admin:remove', async (_e, id) => admin.remove(id));

  // ---- Packs ----
  ipcMain.handle('packs:list', async () => packs.list());
  ipcMain.handle('packs:checkUpdates', async () => packs.checkUpdates());

  ipcMain.handle('packs:installRepo', async (_e, repoPack) => {
    emit('task-start', { id: repoPack.id, title: `Встановлення ${repoPack.name}` });
    try {
      const p = await packs.installRepoPack(repoPack, (pr) => emit('task-progress', { id: repoPack.id, ...pr }));
      emit('task-done', { id: repoPack.id });
      return p;
    } catch (err) {
      emit('task-error', { id: repoPack.id, message: String(err.message || err) });
      throw err;
    }
  });

  ipcMain.handle('packs:installUrl', async (_e, { url, name }) => {
    const key = 'url:' + url;
    emit('task-start', { id: key, title: 'Встановлення збірки' });
    try {
      const p = await packs.installFromUrl(url, { name }, (pr) => emit('task-progress', { id: key, ...pr }));
      emit('task-done', { id: key });
      return p;
    } catch (err) {
      emit('task-error', { id: key, message: String(err.message || err) });
      throw err;
    }
  });

  ipcMain.handle('packs:installFile', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Оберіть .mrpack',
      filters: [{ name: 'Modrinth збірка', extensions: ['mrpack'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    const key = 'file:' + file;
    emit('task-start', { id: key, title: 'Встановлення збірки' });
    try {
      const p = await packs.installFromFile(file, {}, (pr) => emit('task-progress', { id: key, ...pr }));
      emit('task-done', { id: key });
      return p;
    } catch (err) {
      emit('task-error', { id: key, message: String(err.message || err) });
      throw err;
    }
  });

  // ---- Custom profiles ----
  ipcMain.handle('profiles:mcVersions', async () => versions.listMinecraft());
  ipcMain.handle('profiles:create', async (_e, opts) => {
    emit('task-start', { id: 'new-profile', title: 'Створення профілю' });
    try {
      const p = await packs.createProfile(opts, (pr) => emit('task-progress', { id: 'new-profile', ...pr }));
      emit('task-done', { id: 'new-profile' });
      return p;
    } catch (err) { emit('task-error', { id: 'new-profile', message: String(err.message || err) }); throw err; }
  });

  // ---- Mods (Modrinth) ----
  const packDir = (id) => { const p = packs.getInstalled(id); if (!p) throw new Error('Збірку не знайдено'); return p; };
  ipcMain.handle('mods:list', async (_e, id) => mods.listInstalled(packDir(id).dir));
  ipcMain.handle('mods:search', async (_e, { id, query }) => {
    const p = packDir(id); return mods.search(query, p.gameVersion, p.loaderType);
  });
  ipcMain.handle('mods:install', async (_e, { id, projectId }) => {
    const p = packDir(id);
    const fn = await mods.install(p.dir, projectId, p.gameVersion, p.loaderType, (text) => emit('mods-status', { id, text }));
    emit('mods-status', { id, text: '' });
    return fn;
  });
  ipcMain.handle('mods:remove', async (_e, { id, filename }) => { mods.remove(packDir(id).dir, filename); return true; });
  ipcMain.handle('mods:toggle', async (_e, { id, filename }) => { mods.toggle(packDir(id).dir, filename); return true; });

  ipcMain.handle('packs:remove', async (_e, id) => { packs.remove(id); return true; });
  ipcMain.handle('packs:openDir', async (_e, id) => {
    const p = packs.getInstalled(id);
    if (p?.dir) shell.openPath(p.dir);
    return true;
  });
  ipcMain.handle('app:openExternal', async (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('updater:restart', () => {
    try { require('electron-updater').autoUpdater.quitAndInstall(); } catch { /* not packaged */ }
    return true;
  });

  // ---- Launch ----
  ipcMain.handle('launch:play', async (_e, id) => {
    const pack = packs.getInstalled(id);
    if (!pack) throw new Error('Збірку не знайдено');
    if (!auth.isLoggedIn()) throw new Error('Спочатку увійдіть в акаунт');

    emit('launch-start', { id });
    try {
      await minecraft.launch(pack, {
        onStatus: (text) => emit('launch-status', { id, text }),
        onProgress: (pr) => emit('launch-progress', { id, ...pr }),
        onLog: (line) => emit('launch-log', { id, line }),
        onClose: (code) => { emit('launch-closed', { id, code }); try { discord.setIdle(); } catch { /* */ } }
      });
      emit('launch-running', { id });
      try { discord.setPlaying(pack.name, pack.gameVersion, pack.loaderType); } catch { /* */ }
      if (store.get('closeOnLaunch')) {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.minimize();
      }
      return true;
    } catch (err) {
      emit('launch-error', { id, message: String(err.message || err) });
      throw err;
    }
  });
}

module.exports = { register, emit };
