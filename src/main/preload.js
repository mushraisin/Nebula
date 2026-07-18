const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('nebula', {
  // Window
  win: {
    minimize: () => invoke('win:minimize'),
    maximize: () => invoke('win:maximize'),
    close: () => invoke('win:close')
  },
  // App
  appVersion: () => invoke('app:version'),
  // Auth
  login: () => invoke('auth:login'),
  loginOffline: (name) => invoke('auth:loginOffline', name),
  logout: () => invoke('auth:logout'),
  profile: () => invoke('auth:profile'),
  accounts: () => invoke('auth:accounts'),
  switchAccount: (id) => invoke('auth:switch', id),
  removeAccount: (id) => invoke('auth:remove', id),
  // Settings
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  // Repos
  listRepos: () => invoke('repo:list'),
  addRepo: (url, name) => invoke('repo:add', { url, name }),
  removeRepo: (url) => invoke('repo:remove', url),
  fetchRepos: () => invoke('repo:fetch'),
  // Packs
  listPacks: () => invoke('packs:list'),
  checkUpdates: () => invoke('packs:checkUpdates'),
  installRepo: (repoPack) => invoke('packs:installRepo', repoPack),
  installUrl: (url, name) => invoke('packs:installUrl', { url, name }),
  installFile: () => invoke('packs:installFile'),
  removePack: (id) => invoke('packs:remove', id),
  openDir: (id) => invoke('packs:openDir', id),
  openExternal: (url) => invoke('app:openExternal', url),
  // Profiles
  mcVersions: () => invoke('profiles:mcVersions'),
  createProfile: (opts) => invoke('profiles:create', opts),
  // Mods
  modsList: (id) => invoke('mods:list', id),
  modsSearch: (id, query, opts) => invoke('mods:search', { id, query, opts }),
  modsProject: (projectId) => invoke('mods:project', projectId),
  modsVersions: (id, projectId) => invoke('mods:versions', { id, projectId }),
  modsInstall: (id, projectId) => invoke('mods:install', { id, projectId }),
  modsInstallVersion: (id, versionId) => invoke('mods:installVersion', { id, versionId }),
  modsRemove: (id, filename) => invoke('mods:remove', { id, filename }),
  modsToggle: (id, filename) => invoke('mods:toggle', { id, filename }),
  // Admin
  adminConfig: () => invoke('admin:config'),
  adminSetConfig: (base, token) => invoke('admin:setConfig', { base, token }),
  adminVerify: () => invoke('admin:verify'),
  adminList: () => invoke('admin:list'),
  adminSave: (pack) => invoke('admin:save', pack),
  adminRemove: (id) => invoke('admin:remove', id),
  // Self-update
  updaterRestart: () => invoke('updater:restart'),
  // Launch
  play: (id) => invoke('launch:play', id),
  // Events
  on: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('nebula:event', listener);
    return () => ipcRenderer.removeListener('nebula:event', listener);
  }
});
