// Launches Minecraft. Two engines depending on loader:
//   - MCLC (minecraft-launcher-core): vanilla / fabric / quilt
//   - @xmcl/core:                     forge / neoforge (needs module-path args)
//
// Shared game files (versions/libraries/assets) live under <shared>; each pack
// keeps its own game directory (mods/config/saves).
const { Client } = require('minecraft-launcher-core');
const { launch: xmclLaunch } = require('@xmcl/core');
const paths = require('./paths');
const store = require('./store');
const auth = require('./auth');
const { ensureJava } = require('./java');

async function launch(pack, events = {}) {
  const { onStatus = () => {}, onProgress = () => {}, onLog = () => {}, onClose = () => {} } = events;

  onStatus('Перевірка Java...');
  const { javaPath } = await ensureJava(pack.gameVersion, onStatus);

  if (pack.engine === 'xmcl') return launchXmcl(pack, javaPath, { onStatus, onLog, onClose });
  return launchMclc(pack, javaPath, { onStatus, onProgress, onLog, onClose });
}

function jvmExtra() {
  const extra = (store.get('javaArgs') || '').trim();
  return extra ? extra.split(/\s+/) : [];
}

// ---- Fabric / Quilt / Vanilla via MCLC ----
async function launchMclc(pack, javaPath, { onStatus, onProgress, onLog, onClose }) {
  const mem = store.get('memory');
  const opts = {
    authorization: auth.mclcAuth(),
    root: paths.sharedDir(),
    javaPath,
    version: { number: pack.gameVersion, type: 'release', custom: pack.customVersionId || undefined },
    memory: { max: `${mem.max}M`, min: `${mem.min}M` },
    // MCLC defaults to maxSockets:2 — with thousands of asset files that crawls
    // and looks frozen. timeout turns a stalled request into a retry.
    timeout: 30000,
    overrides: { gameDirectory: pack.dir, detached: true, maxSockets: 16 }
  };
  const extra = jvmExtra();
  if (extra.length) opts.customArgs = extra;

  const client = new Client();
  client.on('progress', (e) => onProgress({ current: e.task, total: e.total, label: e.type }));
  client.on('download-status', (e) => { if (e?.name) onStatus(`Завантаження ${e.type || ''} ${e.name}`); });
  client.on('data', (line) => onLog(String(line).trimEnd()));
  client.on('debug', (line) => onLog(String(line).trimEnd()));
  client.on('close', (code) => onClose(code));

  onStatus('Підготовка Minecraft...');
  await client.launch(opts);
  onStatus('Запуск...');
  return client;
}

// ---- Forge / NeoForge via @xmcl/core ----
async function launchXmcl(pack, javaPath, { onStatus, onLog, onClose }) {
  const mem = store.get('memory');
  const a = auth.xmclAuth();

  onStatus('Підготовка Minecraft...');
  const proc = await xmclLaunch({
    gameProfile: { id: a.uuid, name: a.name },
    accessToken: a.accessToken,
    userType: a.userType,
    properties: {},
    gamePath: pack.dir,
    resourcePath: paths.sharedDir(),
    javaPath,
    minMemory: mem.min,
    maxMemory: mem.max,
    version: pack.customVersionId,
    extraJVMArgs: jvmExtra()
  });

  proc.stdout?.on('data', (d) => onLog(d.toString('utf-8').trimEnd()));
  proc.stderr?.on('data', (d) => onLog(d.toString('utf-8').trimEnd()));
  proc.on('close', (code) => onClose(code));
  onStatus('Запуск...');
  return proc;
}

module.exports = { launch };
