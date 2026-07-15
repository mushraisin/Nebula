// Minecraft version list + loader version resolution for custom profiles.
const { fetchJson } = require('./download');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
let mcCache = null;

// Release Minecraft versions, newest first.
async function listMinecraft() {
  if (!mcCache) { const m = await fetchJson(MANIFEST); mcCache = m.versions; }
  return mcCache.filter((v) => v.type === 'release').map((v) => v.id);
}

async function latestFabricLoader() {
  const list = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
  return (list.find((l) => l.stable) || list[0]).version;
}
async function latestQuiltLoader() {
  const list = await fetchJson('https://meta.quiltmc.org/v3/versions/loader');
  return list[0].version;
}
// NeoForge versions look like "21.1.73" (=> MC 1.21.1) or legacy "20.4.x".
async function latestNeoForge(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (!m) return null;
  const prefix = `${m[1]}.${m[2] || 0}.`;
  const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  const list = (data.versions || []).filter((v) => v.startsWith(prefix) && !/beta|alpha/i.test(v));
  return list.length ? list[list.length - 1] : null;
}
async function latestForge(mc) {
  const { getForgeVersionList } = require('@xmcl/installer');
  const res = await getForgeVersionList({ mcversion: mc });
  const versions = res.versions || res || [];
  const pick = versions.find((v) => v.type === 'recommended') || versions.find((v) => v.type === 'latest') || versions[0];
  return pick ? pick.version : null;
}

async function resolveLoaderVersion(loader, mc) {
  if (loader === 'fabric') return latestFabricLoader();
  if (loader === 'quilt') return latestQuiltLoader();
  if (loader === 'neoforge') return latestNeoForge(mc);
  if (loader === 'forge') return latestForge(mc);
  return null; // vanilla
}

module.exports = { listMinecraft, resolveLoaderVersion };
