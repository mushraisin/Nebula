// Persistent JSON config stored in the app userData folder.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const userData = app.getPath('userData');
const configPath = path.join(userData, 'config.json');
// Legacy configs from previous product names (Nebula -> Voxel -> Nebula again).
// Tried in order on first run so existing packs/account/settings carry over.
const legacyConfigPaths = [
  path.join(app.getPath('appData'), 'Voxel', 'config.json'),
  path.join(app.getPath('appData'), 'nebula-launcher', 'config.json')
];

function defaults() {
  const baseDir = path.join(userData, 'data');
  return {
    baseDir,                 // where instances / shared game files / java live
    memory: { min: 2048, max: 4096 },
    javaArgs: '',            // extra JVM args, space separated
    repos: [],               // [{ url, name }] remote manifest urls
    installed: {},           // id -> InstalledPack
    account: null,           // legacy single account (migrated to accounts[])
    accounts: [],            // [{ id, kind, name, uuid, token? }]
    activeAccountId: null,   // id of the account used for launching
    closeOnLaunch: false,
    adminApiBase: 'https://moments.zadrypanka.xyz/launcher', // admin CRUD endpoint
    adminToken: '',          // LAUNCHER_ADMIN_TOKEN (admin only)
    discordClientId: '',     // Discord application id for Rich Presence (optional)
    liquidGlass: false,      // frosted-glass panels (default off = solid/opaque surfaces)
    theme: { bg: '#0f1512', accent: '#4fd488' } // user-customizable colors
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = null;
  try { raw = fs.readFileSync(configPath, 'utf-8'); }
  catch {
    for (const p of legacyConfigPaths) {
      try { raw = fs.readFileSync(p, 'utf-8'); break; } catch { /* try next */ }
    }
  }
  try {
    cache = raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
  } catch {
    cache = defaults();
  }
  return cache;
}

function save() {
  if (!cache) return;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cache, null, 2), 'utf-8');
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  load();
  cache[key] = value;
  save();
}

function update(fn) {
  load();
  fn(cache);
  save();
  return cache;
}

module.exports = { load, save, get, set, update, configPath };
