// Automatic Java (JRE) provisioning.
//
// The required Java major version is read from Mojang's version manifest
// (versionJson.javaVersion.majorVersion) which is authoritative, with a
// heuristic fallback. The matching Eclipse Temurin JRE is downloaded from
// the Adoptium API and cached under <baseDir>/java/<major>.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { fetchJson, downloadFile } = require('./download');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

let manifestCache = null;
async function versionManifest() {
  if (!manifestCache) manifestCache = await fetchJson(VERSION_MANIFEST);
  return manifestCache;
}

// Heuristic: MC <=1.16 -> 8, 1.17-1.20.4 -> 17, >=1.20.5 -> 21.
function heuristicMajor(mcVersion) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mcVersion || '');
  if (!m) return 17;
  const minor = Number(m[1]);
  const patch = Number(m[2] || 0);
  if (minor <= 16) return 8;
  if (minor < 20) return 17;
  if (minor === 20 && patch < 5) return 17;
  return 21;
}

// Returns { id, url } for @xmcl vanilla install.
async function versionMeta(mcVersion) {
  const manifest = await versionManifest();
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Версію Minecraft ${mcVersion} не знайдено`);
  return { id: entry.id, url: entry.url };
}

async function requiredMajor(mcVersion) {
  try {
    const manifest = await versionManifest();
    const entry = manifest.versions.find((v) => v.id === mcVersion);
    if (entry) {
      const detail = await fetchJson(entry.url);
      const major = detail?.javaVersion?.majorVersion;
      if (major) return major;
    }
  } catch { /* fall through to heuristic */ }
  return heuristicMajor(mcVersion);
}

function osArch() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const os = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'mac' : 'linux';
  return { os, arch };
}

function javaExeName() {
  return process.platform === 'win32' ? 'javaw.exe' : 'java';
}

// Find an existing javaw/java executable inside a runtime folder.
function findJavaExe(dir) {
  if (!fs.existsSync(dir)) return null;
  const wanted = javaExeName();
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name.toLowerCase() === wanted) return full;
    }
  }
  return null;
}

// Ensure a JRE for the given MC version exists; returns the javaw/java path.
async function ensureJava(mcVersion, onStatus = () => {}) {
  const major = await requiredMajor(mcVersion);
  const target = path.join(paths.javaDir(), String(major));

  const existing = findJavaExe(target);
  if (existing) return { javaPath: existing, major };

  onStatus(`Завантаження Java ${major}...`);
  const { os, arch } = osArch();
  const assetUrl =
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
    `?image_type=jre&os=${os}&architecture=${arch}&vendor=eclipse`;

  const assets = await fetchJson(assetUrl);
  if (!assets.length) throw new Error(`Немає Java ${major} для ${os}/${arch}`);
  const pkg = assets[0].binary.package;

  fs.mkdirSync(target, { recursive: true });
  const archive = path.join(paths.tmpDir(), `jre-${major}-${Date.now()}${os === 'windows' ? '.zip' : '.tar.gz'}`);

  await downloadFile(pkg.link, archive, {
    hash: pkg.checksum,
    algo: 'sha256',
    onProgress: (r, t) => onStatus(`Java ${major}: ${fmt(r)}${t ? ' / ' + fmt(t) : ''}`)
  });

  onStatus(`Розпакування Java ${major}...`);
  if (os === 'windows') {
    new AdmZip(archive).extractAllTo(target, true);
  } else {
    // tar available on mac/linux
    const { execFileSync } = require('child_process');
    execFileSync('tar', ['-xzf', archive, '-C', target]);
  }
  fs.rmSync(archive, { force: true });

  const exe = findJavaExe(target);
  if (!exe) throw new Error('Не знайдено java після розпакування');
  return { javaPath: exe, major };
}

function fmt(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

module.exports = { ensureJava, requiredMajor, versionMeta };
