// Orchestrates installing / updating / removing packs.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const store = require('./store');
const repo = require('./repo');
const { downloadSegmented } = require('./download');
const { readIndex, installMrpack } = require('./mrpack');
const { detectLoader, installLoader } = require('./loaders');
const versions = require('./versions');

function slug(s) {
  return String(s || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pack';
}

function list() {
  const installed = store.get('installed') || {};
  return Object.values(installed).sort((a, b) => a.name.localeCompare(b.name));
}

function getInstalled(id) {
  return (store.get('installed') || {})[id] || null;
}

// Core install: given a local .mrpack file, install everything into an
// instance and register it. `id` is stable so updates reinstall in place.
async function installFromFile(mrpackFile, meta = {}, onProgress = () => {}) {
  const index = await readIndex(mrpackFile);
  const id = meta.id || slug(index.name);
  const dir = paths.instanceDir(id);

  onProgress({ phase: 'files', current: 0, total: 1, label: 'Підготовка...' });

  // Install the mod loader (Fabric/Quilt via MCLC, Forge/NeoForge via XMCL).
  const loader = detectLoader(index.dependencies || {});
  const { versionNumber, customVersionId, engine } = await installLoader(loader, (t) =>
    onProgress({ phase: 'loader', label: t })
  );

  // Incremental (re)install: reuse the previous manifest to only fetch/replace
  // changed files and delete pack-dropped ones. Packs installed before this
  // feature have no manifest -> wipe mods once so removed mods don't linger,
  // then let the incremental pass re-download (future updates are incremental).
  const existing = getInstalled(id);
  let prevManifest = existing?.manifest || null;
  if (existing && !prevManifest) {
    fs.rmSync(path.join(dir, 'mods'), { recursive: true, force: true });
  }

  // mrpack files + overrides into the instance dir (incremental).
  const info = await installMrpack(mrpackFile, dir, onProgress, prevManifest);

  const pack = {
    id,
    name: meta.name || info.name || index.name,
    // For repo/admin packs the manifest version is the source of truth for
    // update detection; fall back to the .mrpack's internal versionId.
    version: meta.version || info.versionId || '',
    summary: meta.summary || info.summary || '',
    icon: meta.icon || null,
    gameVersion: versionNumber,
    loaderType: loader.type,
    loaderVersion: loader.version,
    customVersionId,
    engine,
    dir,
    source: meta.source || { type: 'file' },
    manifest: info.manifest, // managed file paths, for incremental updates
    installedAt: Date.now()
  };

  store.update((c) => { c.installed[id] = pack; });
  return pack;
}

// Download a .mrpack from a URL, then install it.
async function installFromUrl(url, meta = {}, onProgress = () => {}) {
  // Remember where a URL-installed pack came from so it can be re-synced/repaired
  // before launch (repo packs already carry their own source with the mrpack url).
  if (!meta.source) meta = { ...meta, source: { type: 'url', mrpack: url } };
  const tmp = path.join(paths.tmpDir(), `pack-${Date.now()}.mrpack`);
  onProgress({ phase: 'download', label: 'Завантаження .mrpack...' });
  const mb = (b) => (b / 1048576).toFixed(0) + ' МБ';
  await downloadSegmented(url, tmp, {
    segments: 8, // parallel connections to saturate fast links
    onProgress: (r, t) => onProgress({
      phase: 'download', current: r, total: t,
      label: `Завантаження збірки: ${mb(r)}${t ? ' / ' + mb(t) : ''}`
    })
  });
  try {
    return await installFromFile(tmp, meta, onProgress);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Install / update a pack coming from a repository manifest entry.
async function installRepoPack(repoPack, onProgress = () => {}) {
  return installFromUrl(repoPack.mrpack, {
    id: repoPack.id,
    name: repoPack.name,
    version: repoPack.version,
    summary: repoPack.summary,
    icon: repoPack.icon,
    source: { type: 'repo', repoUrl: repoPack.repoUrl, packId: repoPack.id, mrpack: repoPack.mrpack }
  }, onProgress);
}

function uniqueId(base) {
  const inst = store.get('installed') || {};
  if (!inst[base]) return base;
  let i = 2; while (inst[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

// Create a user-authored profile: install the chosen loader + empty mods dir.
async function createProfile({ name, mc, loader }, onProgress = () => {}) {
  const nm = String(name || '').trim() || 'Профіль';
  const type = loader || 'vanilla';
  const loaderVersion = type !== 'vanilla' ? await versions.resolveLoaderVersion(type, mc) : null;
  if (type !== 'vanilla' && !loaderVersion) throw new Error(`Немає ${type} для ${mc}`);
  onProgress({ label: `Встановлення ${type === 'vanilla' ? 'Minecraft' : type} ${mc}...` });
  const { versionNumber, customVersionId, engine } = await installLoader({ type, mc, version: loaderVersion }, (t) => onProgress({ label: t }));
  const id = uniqueId(slug(nm));
  const dir = paths.instanceDir(id);
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  const pack = {
    id, name: nm, version: '1.0', summary: '', icon: null,
    gameVersion: versionNumber, loaderType: type, loaderVersion, customVersionId, engine,
    dir, source: { type: 'custom' }, installedAt: Date.now()
  };
  store.update((c) => { c.installed[id] = pack; });
  return pack;
}

// Re-sync an installed pack's files against its source .mrpack, WITHOUT touching
// the mod loader or shared game files. Used as an integrity/repair pass right
// before launch: it re-downloads the (small) source .mrpack index, then reuses the
// incremental installer to repair locally deleted/corrupted files, pull files the
// source added, and drop files it removed since last time - all judged by sha1/crc32.
// Returns { verified, stats } or { skipped, reason } for packs with no remote source
// (custom profiles and local-file installs, which have nothing to sync against).
async function verifyPack(id, onProgress = () => {}) {
  const pack = getInstalled(id);
  if (!pack) throw new Error('Збірку не знайдено');
  const url = pack.source && pack.source.mrpack;
  if (!url) return { skipped: true, reason: 'no-source' };

  const tmp = path.join(paths.tmpDir(), `verify-${slug(id)}-${Date.now()}.mrpack`);
  onProgress({ phase: 'verify', label: 'Перевірка файлів збірки...' });
  await downloadSegmented(url, tmp, {}); // .mrpack is small (index + overrides), no bar
  try {
    const info = await installMrpack(tmp, pack.dir, onProgress, pack.manifest || null);
    store.update((c) => {
      const p = c.installed[id];
      if (p) { p.manifest = info.manifest; p.verifiedAt = Date.now(); }
    });
    return { verified: true, stats: info.stats };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function remove(id) {
  const pack = getInstalled(id);
  if (pack?.dir && fs.existsSync(pack.dir)) {
    fs.rmSync(pack.dir, { recursive: true, force: true });
  }
  store.update((c) => { delete c.installed[id]; });
}

// Compare installed packs against all repos. Returns
// [{ id, name, installedVersion, availableVersion, repoPack }].
async function checkUpdates() {
  const repos = await repo.fetchAll();
  const byId = new Map();
  for (const r of repos) for (const p of r.packs) byId.set(p.id, p);

  const updates = [];
  for (const pack of list()) {
    const available = byId.get(pack.id);
    if (available && available.version && available.version !== pack.version) {
      updates.push({
        id: pack.id,
        name: pack.name,
        installedVersion: pack.version,
        availableVersion: available.version,
        repoPack: available
      });
    }
  }
  return updates;
}

module.exports = {
  list, getInstalled, installFromFile, installFromUrl, installRepoPack,
  createProfile, verifyPack, remove, checkUpdates
};
