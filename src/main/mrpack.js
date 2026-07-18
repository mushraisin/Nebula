// Parses and installs a Modrinth .mrpack into an instance directory.
//
// A .mrpack is a ZIP containing:
//   modrinth.index.json  -> metadata + file list + loader dependencies
//   overrides/           -> files copied verbatim into the game dir
//   client-overrides/    -> client-only overrides
//
// Uses @xmcl/unzip (streaming, yauzl-based) so multi-GB packs are extracted
// entry-by-entry to disk without loading the whole archive into memory.
//
// Installs INCREMENTALLY: existing files are verified (downloads by sha1, overrides
// by crc32) and only missing/changed ones are (re)written; files that the pack
// dropped since the previous install are deleted. A per-pack manifest of managed
// paths is returned so the next update knows what it previously owned.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { open, readEntry, openEntryReadStream, readAllEntries } = require('@xmcl/unzip');
const { downloadFile } = require('./download');

async function withZip(mrpackPath, fn) {
  const zip = await open(mrpackPath, { lazyEntries: true, autoClose: false });
  try { return await fn(zip); }
  finally { try { zip.close(); } catch { /* ignore */ } }
}

async function readIndexFrom(zip) {
  const entries = await readAllEntries(zip);
  const entry = entries.find((e) => e.fileName === 'modrinth.index.json');
  if (!entry) throw new Error('Невалідний .mrpack: немає modrinth.index.json');
  const index = JSON.parse((await readEntry(zip, entry)).toString('utf-8'));
  return { index, entries };
}

// Read just modrinth.index.json (used to detect the loader before install).
async function readIndex(mrpackPath) {
  return withZip(mrpackPath, async (zip) => (await readIndexFrom(zip)).index);
}

/* ---------- hashing helpers (streamed, memory-safe for big files) ---------- */
function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32File(p) {
  return new Promise((resolve, reject) => {
    let crc = ~0;
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (b) => { for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b[i]) & 0xff]; });
    s.on('end', () => resolve((crc ^ ~0) >>> 0));
  });
}
function rmIfExists(p) { try { if (fs.existsSync(p)) fs.rmSync(p, { force: true }); } catch { /* ignore */ } }

// Player-owned settings files: once they exist, updates must NOT overwrite or
// delete them, so custom keybinds/video/audio survive every pack update.
const PROTECTED_USER_FILES = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt']);
const isProtected = (rel) => PROTECTED_USER_FILES.has(path.basename(rel).toLowerCase());

// Run `worker` over items with a bounded number of parallel workers.
async function runPool(items, concurrency, worker) {
  let idx = 0;
  const n = Math.min(concurrency, items.length);
  const runners = [];
  for (let w = 0; w < n; w++) {
    runners.push((async () => {
      while (true) {
        const i = idx++;
        if (i >= items.length) break;
        await worker(items[i], i);
      }
    })());
  }
  await Promise.all(runners);
}
const DL_CONCURRENCY = 8; // parallel file downloads

// Install into instanceDir. onProgress({ phase, current, total, label }).
// prevManifest = { files: [relPath...], overrides: [relPath...] } from the previous
// install (or null for a fresh install) - used to delete files the pack removed.
async function installMrpack(mrpackPath, instanceDir, onProgress = () => {}, prevManifest = null) {
  return withZip(mrpackPath, async (zip) => {
    const { index, entries } = await readIndexFrom(zip);

    // ---- 1. Downloaded files (mods etc.), verified/kept by sha1 ----
    const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');
    const newFilePaths = files.map((f) => f.path);
    const newFileSet = new Set(newFilePaths);

    // Delete previously-managed downloaded files the pack no longer lists
    // (keeps user-added mods, which were never in the manifest).
    if (prevManifest && Array.isArray(prevManifest.files)) {
      for (const rel of prevManifest.files) if (!newFileSet.has(rel)) rmIfExists(path.join(instanceDir, rel));
    }

    let done = 0, fetched = 0, kept = 0;
    // Download/verify files in parallel to saturate fast connections.
    await runPool(files, DL_CONCURRENCY, async (f) => {
      const dest = path.join(instanceDir, f.path);
      let ok = false;
      if (fs.existsSync(dest)) {
        try {
          const st = fs.statSync(dest);
          if (f.fileSize && st.size !== f.fileSize) ok = false;      // size differs -> stale
          else if (f.hashes && f.hashes.sha1) ok = (await sha1File(dest)) === f.hashes.sha1;
          else ok = true;                                            // no hash + size ok
        } catch { ok = false; }
      }
      if (!ok) {
        const url = f.downloads && f.downloads[0];
        if (url) { await downloadFile(url, dest, { hash: f.hashes && f.hashes.sha1, algo: 'sha1' }); fetched++; }
      } else kept++;
      done++;
      onProgress({ phase: 'files', current: done, total: files.length, label: f.path });
    });

    // ---- 2. Overrides, verified/kept by crc32 ----
    const isOverride = (n, p) => n.startsWith(p) && !n.endsWith('/');
    const generic = entries.filter((e) => isOverride(e.fileName, 'overrides/'));
    const client = entries.filter((e) => isOverride(e.fileName, 'client-overrides/'));
    const overrides = [...generic, ...client]; // client-overrides applied last (wins)
    const newOverrideSet = new Set();

    let oi = 0;
    for (const e of overrides) {
      oi++;
      const rel = e.fileName.replace(/^(client-)?overrides\//, '');
      if (!rel) continue;
      newOverrideSet.add(rel);
      const dest = path.join(instanceDir, rel);
      // Keep the player's own settings (options.txt etc.) if they already exist.
      if (isProtected(rel) && fs.existsSync(dest)) {
        onProgress({ phase: 'overrides', current: oi, total: overrides.length, label: 'Збережено налаштування: ' + rel });
        continue;
      }
      let same = false;
      if (fs.existsSync(dest) && e.crc32 != null) {
        try { same = (await crc32File(dest)) === (e.crc32 >>> 0); } catch { same = false; }
      }
      onProgress({ phase: 'overrides', current: oi, total: overrides.length, label: (same ? 'Перевірка: ' : '') + rel });
      if (same) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const stream = await openEntryReadStream(zip, e);
      await pipeline(stream, fs.createWriteStream(dest));
    }

    // Delete override files the pack removed since last install (never protected ones).
    if (prevManifest && Array.isArray(prevManifest.overrides)) {
      for (const rel of prevManifest.overrides) if (!newOverrideSet.has(rel) && !isProtected(rel)) rmIfExists(path.join(instanceDir, rel));
    }

    return {
      name: index.name,
      versionId: index.versionId,
      summary: index.summary || '',
      dependencies: index.dependencies || {},
      manifest: { files: newFilePaths, overrides: [...newOverrideSet] },
      stats: { fetched, kept, total: files.length }
    };
  });
}

module.exports = { readIndex, installMrpack };
