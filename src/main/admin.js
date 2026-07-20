// Admin client. Packs live in a packs.json manifest inside a GitHub repository;
// this edits that file through the GitHub Contents API using a personal access
// token (Contents: read+write). No server of our own is involved.
const store = require('./store');

const API = 'https://api.github.com';
const UA = 'NebulaLauncher';

function cfg() {
  const repo = String(store.get('ghRepo') || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const branch = String(store.get('ghBranch') || '').trim() || 'main';
  const path = String(store.get('ghPath') || '').trim().replace(/^\/+/, '') || 'packs.json';
  return { repo, branch, path, token: store.get('adminToken') };
}

async function gh(method, url, body) {
  const { token } = cfg();
  if (!token) throw new Error('Не задано GitHub-токен');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': UA
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw new Error('Невірний GitHub-токен');
  if (res.status === 403) throw new Error('Немає прав: перевір доступ токена до репозиторію');
  if (res.status === 404 && method === 'GET') return null;      // file/repo not there yet
  if (res.status === 409) throw new Error('Конфлікт: маніфест змінили паралельно, спробуй ще раз');
  if (!res.ok) throw new Error(`GitHub: ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

function contentsUrl() {
  const { repo, path } = cfg();
  if (!repo.includes('/')) throw new Error('Вкажи репозиторій у форматі owner/repo');
  return `${API}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

const EMPTY = { name: 'Збірки Nebula', packs: [] };

// Read the manifest + its blob sha (needed to update it).
async function read() {
  const { branch } = cfg();
  const data = await gh('GET', `${contentsUrl()}?ref=${encodeURIComponent(branch)}`);
  if (!data || !data.content) return { manifest: { ...EMPTY }, sha: data ? data.sha : null };
  let manifest;
  try { manifest = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8')); }
  catch { manifest = { ...EMPTY }; }
  if (!manifest || typeof manifest !== 'object') manifest = { ...EMPTY };
  if (!Array.isArray(manifest.packs)) manifest.packs = [];
  if (!manifest.name) manifest.name = EMPTY.name;
  return { manifest, sha: data.sha };
}

async function write(manifest, sha, message) {
  const { branch } = cfg();
  const body = {
    message,
    branch,
    content: Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8').toString('base64')
  };
  if (sha) body.sha = sha;
  await gh('PUT', contentsUrl(), body);
  return true;
}

const slug = (s) => String(s || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pack';

module.exports = {
  async verify() {
    const { repo, branch, path } = cfg();
    if (!repo.includes('/')) throw new Error('Вкажи репозиторій у форматі owner/repo');
    const r = await gh('GET', `${API}/repos/${repo}`);
    if (!r) throw new Error('Репозиторій не знайдено');
    if (r.permissions && r.permissions.push === false) throw new Error('Токен не має права запису в цей репозиторій');
    return { ok: true, repo, branch, path };
  },
  async list() {
    const { manifest } = await read();
    return { packs: manifest.packs };
  },
  async save(pack) {
    const { manifest, sha } = await read();
    const id = (pack.id && String(pack.id).trim()) || slug(pack.name);
    const entry = { ...pack, id };
    if (entry.featured) for (const p of manifest.packs) p.featured = false; // only one "main" pack
    const i = manifest.packs.findIndex((p) => p.id === id);
    if (i >= 0) manifest.packs[i] = { ...manifest.packs[i], ...entry };
    else manifest.packs.push(entry);
    await write(manifest, sha, `packs: ${i >= 0 ? 'update' : 'add'} ${id}`);
    return { ok: true, id };
  },
  async remove(id) {
    const { manifest, sha } = await read();
    manifest.packs = manifest.packs.filter((p) => p.id !== id);
    await write(manifest, sha, `packs: remove ${id}`);
    return { ok: true };
  }
};
