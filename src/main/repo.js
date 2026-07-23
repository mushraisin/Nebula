// Remote pack "repository" support.
//
// A repository is a JSON manifest you host at a URL you control. It lists
// packs and their current versions + .mrpack download URLs. The launcher
// fetches it to show available packs and to detect updates.
//
// The BUILTIN repo is baked into the launcher so ANYONE who downloads it
// immediately sees your packs and can install them in one click. Users can
// still add extra repos of their own; those are stored in config.
//
// Manifest shape:
// {
//   "name": "My Packs",
//   "packs": [
//     {
//       "id": "3l10n",
//       "name": "3L1-0N",
//       "version": "0.1.1-alpha-patch1",
//       "gameVersion": "1.21.1",        // optional, shown before install
//       "loader": "neoforge",           // optional, shown before install
//       "icon": "https://.../icon.png",
//       "summary": "Short description",
//       "mrpack": "https://.../3l10n-0.1.1.mrpack"
//     }
//   ]
// }
const { fetchJson } = require('./download');
const store = require('./store');

// ===========================================================================
// Вбудований публічний маніфест: packs.json лежить у GitHub-репозиторії і
// редагується з адмін-панелі лаунчера (GitHub Contents API). Його бачать УСІ.
// ===========================================================================
const BUILTIN_REPOS = [
  'https://raw.githubusercontent.com/mushraisin/Nebula/main/packs.json'
];

function isPlaceholder(url) {
  return url.includes('USERNAME') || url.includes('YOUR-SITE');
}

async function fetchRepo(url) {
  // Cache-buster so GitHub raw's CDN edge cache (~5 min) can't hide a just-edited
  // manifest; combined with no-store this always pulls the latest packs.json.
  const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  const data = await fetchJson(bust);
  const packs = (data.packs || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    version: String(p.version ?? ''),
    gameVersion: p.gameVersion || p.mc || '',
    loader: p.loader || '',
    icon: p.icon || null,
    summary: p.summary || '',
    description: p.description || '',
    media: Array.isArray(p.media) ? p.media : [],
    changelog: p.changelog || '',
    featured: !!p.featured,
    effect: p.effect || '',
    mrpack: p.mrpack,
    repoUrl: url,
    repoName: data.name || url
  }));
  return { name: data.name || url, url, packs };
}

// Every repo URL: builtin (baked) first, then user-added. Deduped.
function allRepoUrls() {
  const user = (store.get('repos') || []).map((r) => r.url);
  const urls = [...BUILTIN_REPOS.filter((u) => !isPlaceholder(u)), ...user];
  return [...new Set(urls)];
}

// Fetch every repo, tolerating individual failures.
async function fetchAll() {
  const results = [];
  for (const url of allRepoUrls()) {
    try {
      results.push(await fetchRepo(url));
    } catch (e) {
      results.push({ name: url, url, packs: [], error: String(e.message || e) });
    }
  }
  return results;
}

function addRepo(url, name) {
  store.update((c) => {
    if (!c.repos.some((r) => r.url === url)) c.repos.push({ url, name: name || url });
  });
}

function removeRepo(url) {
  store.update((c) => { c.repos = c.repos.filter((r) => r.url !== url); });
}

module.exports = { fetchRepo, fetchAll, addRepo, removeRepo, BUILTIN_REPOS };
