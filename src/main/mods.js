// Modrinth-backed mod manager for an instance's mods/ folder.
// Supports paginated search, full project pages, version listing/selection,
// and installing a specific version with its required dependencies.
const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');

const MR = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'VoxelLauncher/1.0 (minecraft launcher)' };
const enc = encodeURIComponent;

async function mfetch(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Modrinth ${r.status}`);
  return r.json();
}

// Paginated search of mods compatible with a MC version + loader.
// opts: { offset, limit, sort } - sort = relevance|downloads|follows|newest|updated
async function search(query, mc, loader, opts = {}) {
  const offset = Math.max(0, opts.offset || 0);
  const limit = Math.min(100, opts.limit || 20);
  const sort = opts.sort || 'relevance';
  const facets = [['project_type:mod']];
  if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  if (mc) facets.push([`versions:${mc}`]);
  const url = `${MR}/search?limit=${limit}&offset=${offset}&index=${sort}`
    + `&query=${enc(query || '')}`
    + `&facets=${enc(JSON.stringify(facets))}`;
  const d = await mfetch(url);
  return {
    total: d.total_hits || 0,
    offset: d.offset || 0,
    limit: d.limit || limit,
    hits: (d.hits || []).map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      icon: h.icon_url || null, downloads: h.downloads, follows: h.follows,
      author: h.author || '', categories: h.display_categories || h.categories || []
    }))
  };
}

// Full project page data.
async function getProject(id) {
  const p = await mfetch(`${MR}/project/${enc(id)}`);
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, body: p.body || '',
    icon: p.icon_url || null, downloads: p.downloads, followers: p.followers,
    categories: [...(p.categories || []), ...(p.additional_categories || [])],
    clientSide: p.client_side, serverSide: p.server_side,
    gallery: (p.gallery || [])
      .slice()
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (a.ordering || 0) - (b.ordering || 0))
      .map((g) => ({ url: g.url, title: g.title || '', description: g.description || '' })),
    links: { source: p.source_url || '', issues: p.issues_url || '', wiki: p.wiki_url || '', discord: p.discord_url || '' }
  };
}

// Versions of a project, newest first. Filtered to mc+loader when provided.
async function getVersions(id, mc, loader) {
  let url = `${MR}/project/${enc(id)}/version`;
  const qs = [];
  if (mc) qs.push(`game_versions=${enc(JSON.stringify([mc]))}`);
  if (loader && loader !== 'vanilla') qs.push(`loaders=${enc(JSON.stringify([loader]))}`);
  if (qs.length) url += '?' + qs.join('&');
  const vers = await mfetch(url);
  vers.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
  return vers.map((v) => {
    const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0] || {};
    return {
      id: v.id, name: v.name, versionNumber: v.version_number, type: v.version_type,
      datePublished: v.date_published, downloads: v.downloads,
      gameVersions: v.game_versions || [], loaders: v.loaders || [],
      filename: file.filename || '', size: file.size || 0
    };
  });
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

// Newest version of a project matching mc + loader (used for dependency fallback).
async function bestVersion(projId, mc, loader) {
  const vers = await getVersions(projId, mc, loader);
  return vers[0] ? await mfetch(`${MR}/version/${vers[0].id}`) : null;
}

// Install a specific version by id + its required dependencies.
async function installVersion(instanceDir, versionId, mc, loader, onStatus = () => {}, seen = new Set()) {
  const ver = await mfetch(`${MR}/version/${enc(versionId)}`);
  if (ver.project_id) seen.add(ver.project_id);
  const file = (ver.files || []).find((f) => f.primary) || (ver.files || [])[0];
  if (!file) throw new Error('У версії немає файлу');
  onStatus(`Завантаження ${file.filename}...`);
  await downloadFile(file.url, path.join(modsDir(instanceDir), file.filename), { hash: file.hashes?.sha1, algo: 'sha1' });
  for (const dep of ver.dependencies || []) {
    if (dep.dependency_type !== 'required') continue;
    try {
      if (dep.version_id) await installVersion(instanceDir, dep.version_id, mc, loader, onStatus, seen);
      else if (dep.project_id && !seen.has(dep.project_id)) await install(instanceDir, dep.project_id, mc, loader, onStatus, seen);
    } catch { /* skip broken dep */ }
  }
  return file.filename;
}

// Install a mod by project id (newest compatible version) + required deps.
async function install(instanceDir, projId, mc, loader, onStatus = () => {}, seen = new Set()) {
  if (seen.has(projId)) return null;
  seen.add(projId);
  const ver = await bestVersion(projId, mc, loader);
  if (!ver) throw new Error(`Немає версії для ${mc} / ${loader || 'vanilla'}`);
  return installVersion(instanceDir, ver.id, mc, loader, onStatus, seen);
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

module.exports = { search, getProject, getVersions, install, installVersion, remove, toggle, listInstalled };
