// Modrinth-backed mod manager for an instance's mods/ folder.
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');

const MR = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'VoxelLauncher/1.0 (minecraft launcher)' };

async function mfetch(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Modrinth ${r.status}`);
  return r.json();
}

// Search mods compatible with a MC version + loader.
async function search(query, mc, loader) {
  const facets = [['project_type:mod']];
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  if (mc) facets.push([`versions:${mc}`]);
  const url = `${MR}/search?limit=30&index=relevance`
    + `&query=${encodeURIComponent(query || '')}`
    + `&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const d = await mfetch(url);
  return d.hits.map((h) => ({
    id: h.project_id, slug: h.slug, title: h.title, description: h.description,
    icon: h.icon_url || null, downloads: h.downloads
  }));
}

// Newest version of a project matching mc + loader.
async function bestVersion(projId, mc, loader) {
  let url = `${MR}/project/${projId}/version?game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  if (loader && loader !== 'vanilla') url += `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`;
  const vers = await mfetch(url);
  if (!vers.length) return null;
  vers.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
  return vers[0];
}

function modsDir(instanceDir) { return path.join(instanceDir, 'mods'); }

function listInstalled(instanceDir) {
  const dir = modsDir(instanceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.jar(\.disabled)?$/i.test(f))
    .map((f) => {
      const enabled = !f.endsWith('.disabled');
      let size = 0; try { size = fs.statSync(path.join(dir, f)).size; } catch { /* */ }
      return { filename: f, name: f.replace(/\.jar(\.disabled)?$/i, ''), enabled, size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Install a mod + its required dependencies (one visited set, shallow-recursive).
async function install(instanceDir, projId, mc, loader, onStatus = () => {}, seen = new Set()) {
  if (seen.has(projId)) return null;
  seen.add(projId);
  const ver = await bestVersion(projId, mc, loader);
  if (!ver) throw new Error(`Немає версії для ${mc} / ${loader || 'vanilla'}`);
  const file = ver.files.find((f) => f.primary) || ver.files[0];
  onStatus(`Завантаження ${file.filename}...`);
  await downloadFile(file.url, path.join(modsDir(instanceDir), file.filename), { hash: file.hashes?.sha1, algo: 'sha1' });
  for (const dep of ver.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try { await install(instanceDir, dep.project_id, mc, loader, onStatus, seen); } catch { /* skip broken dep */ }
    }
  }
  return file.filename;
}

function remove(instanceDir, filename) {
  const p = path.join(modsDir(instanceDir), path.basename(filename));
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

function toggle(instanceDir, filename) {
  const dir = modsDir(instanceDir);
  const cur = path.join(dir, path.basename(filename));
  if (!fs.existsSync(cur)) return;
  const next = filename.endsWith('.disabled') ? cur.replace(/\.disabled$/, '') : cur + '.disabled';
  fs.renameSync(cur, next);
}

module.exports = { search, install, remove, toggle, listInstalled };
