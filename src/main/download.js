// Download helpers. File downloads use Node's native `https`/`http` stack
// (NOT Electron's fetch/undici, which was corrupting large response bodies)
// with redirect following, resume via HTTP Range, sha verification, retries,
// and progress callbacks.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { setTimeout: sleep } = require('timers/promises');

const UA = 'VoxelLauncher/1.0';

// Keep-alive agents so many small downloads reuse TCP/TLS connections instead of
// re-handshaking per file (big win when fetching lots of mods).
const AGENT_OPTS = { keepAlive: true, keepAliveMsecs: 15000, maxSockets: 24, maxFreeSockets: 12 };
const httpsAgent = new https.Agent(AGENT_OPTS);
const httpAgent = new http.Agent(AGENT_OPTS);
const agentFor = (u) => (u.protocol === 'http:' ? httpAgent : httpsAgent);

// Small JSON/text still use fetch (tiny payloads; corruption there surfaces as
// a parse error immediately).
async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// Rewrite a Google Drive "share" link into a direct-download URL. Handles
// /file/d/<id>/view, open?id=<id>, uc?id=<id>. Works for public files; large
// files may still hit Google's virus-scan interstitial or a download quota
// (handled as a clear error in downloadOnce).
function googleDirect(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$/i.test(u.hostname) && !/(^|\.)drive\.usercontent\.google\.com$/i.test(u.hostname)) return url;
    let id = null;
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (m) id = m[1]; else id = u.searchParams.get('id');
    if (!id) return url;
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  } catch { return url; }
}

// GET with redirect following. Resolves with the Node response stream.
function httpGet(url, headers = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers: { 'User-Agent': UA, ...headers }, agent: agentFor(u) }, (res) => {
      const sc = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location && redirects > 0) {
        res.resume(); // drain and follow
        httpGet(new URL(res.headers.location, u).toString(), headers, redirects - 1).then(resolve, reject);
      } else {
        resolve(res);
      }
    });
    req.on('error', reject);
    req.setTimeout(90000, () => req.destroy(new Error('час очікування вичерпано')));
  });
}

// Download `url` to `dest`. Retries a few times; large files resume from a
// partial .part via HTTP Range. Verifies size and (if given) sha hash.
async function downloadFile(url, dest, opts = {}) {
  const attempts = opts.attempts ?? 4;
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await downloadOnce(url, dest, opts);
    } catch (e) {
      lastErr = e;
      if (i < attempts) await sleep(800 * i);
    }
  }
  throw lastErr;
}

async function downloadOnce(url, dest, { hash, algo = 'sha1', onProgress } = {}) {
  url = googleDirect(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (hash && fs.existsSync(dest) && (await verify(dest, hash, algo))) return dest;

  const tmp = dest + '.part';
  let start = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;

  const headers = {};
  if (start > 0) headers.Range = `bytes=${start}-`;

  const res = await httpGet(url, headers);
  const sc = res.statusCode;
  if (sc !== 200 && sc !== 206) { res.resume(); throw new Error(`GET ${url} -> ${sc}`); }
  // Google Drive returns an HTML interstitial (not the file) when a public file
  // is too large to scan or the download quota is exceeded.
  if (/text\/html/i.test(res.headers['content-type'] || '') && /google\.com/i.test(url)) {
    res.resume();
    throw new Error('Google Drive не віддав файл напряму (великий файл або перевищено денний ліміт завантажень). Краще використати пряме посилання чи інший хостинг.');
  }

  // Only append if the server returned a proper partial (206) starting exactly
  // at our offset; otherwise restart clean to avoid corrupting the file.
  let append = false;
  if (start > 0 && sc === 206) {
    const m = /bytes\s+(\d+)-\d+\/(\d+|\*)/i.exec(res.headers['content-range'] || '');
    if (m && Number(m[1]) === start) append = true;
  }
  if (!append) { start = 0; if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); }

  const total = (Number(res.headers['content-length']) || 0) + (append ? start : 0);
  let received = start;
  const counter = new Transform({
    transform(chunk, _enc, cb) { received += chunk.length; if (onProgress) onProgress(received, total); cb(null, chunk); }
  });

  await pipeline(res, counter, fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' }));

  const got = fs.statSync(tmp).size;
  if (total > 0 && got !== total) {
    if (hash) fs.rmSync(tmp, { force: true }); // hashed: restart clean; unhashed: keep for resume
    throw new Error(`Неповне завантаження ${path.basename(dest)}: ${got}/${total} байт`);
  }
  if (hash && !(await verify(tmp, hash, algo))) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Хеш не збігається (${path.basename(dest)}): розмір ${got} байт правильний, але вміст пошкоджено`);
  }

  fs.renameSync(tmp, dest);
  return dest;
}

// Multi-connection download for large single files: probes for Range support +
// size, then pulls N byte-ranges in parallel into a preallocated file (writing at
// offsets, no concat). Falls back to a single stream if ranges aren't supported or
// the file is small. Big win on fast links where one TCP stream is the limiter.
const SEGMENT_MIN = 16 * 1024 * 1024; // only segment files >= 16 MB

async function downloadSegmented(url, dest, opts = {}) {
  url = googleDirect(url);
  const segments = opts.segments || 6;
  let total = 0, ranges = false;
  try {
    const probe = await httpGet(url, { Range: 'bytes=0-0' });
    ranges = probe.statusCode === 206;
    const m = /\/(\d+)\s*$/.exec(probe.headers['content-range'] || '');
    if (m) total = Number(m[1]);
    else total = Number(probe.headers['content-length']) || 0;
    probe.resume();
  } catch { /* fall back below */ }

  if (!ranges || !total || total < SEGMENT_MIN) {
    return downloadFile(url, dest, opts); // single-stream (with retries/resume)
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const fd = fs.openSync(tmp, 'w');
  try { fs.ftruncateSync(fd, total); } finally { fs.closeSync(fd); }

  const partSize = Math.ceil(total / segments);
  let received = 0;
  const bump = (delta) => { received += delta; if (received < 0) received = 0; if (opts.onProgress) opts.onProgress(received, total); };

  const tasks = [];
  for (let i = 0; i < segments; i++) {
    const s = i * partSize;
    if (s >= total) break;
    const e = Math.min(total - 1, s + partSize - 1);
    tasks.push(downloadSegment(url, tmp, s, e, bump));
  }
  await Promise.all(tasks);

  const got = fs.statSync(tmp).size;
  if (got !== total) { fs.rmSync(tmp, { force: true }); throw new Error(`Неповне завантаження: ${got}/${total} байт`); }
  if (opts.hash && !(await verify(tmp, opts.hash, opts.algo || 'sha1'))) {
    fs.rmSync(tmp, { force: true }); throw new Error('Хеш не збігається (segmented)');
  }
  fs.renameSync(tmp, dest);
  return dest;
}

async function downloadSegment(url, tmp, start, end, bump, attempts = 4) {
  const expect = end - start + 1;
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    let segGot = 0;
    try {
      const res = await httpGet(url, { Range: `bytes=${start}-${end}` });
      if (res.statusCode !== 206) { res.resume(); throw new Error(`GET range -> ${res.statusCode}`); }
      const ws = fs.createWriteStream(tmp, { flags: 'r+', start });
      await new Promise((resolve, reject) => {
        res.on('data', (c) => { segGot += c.length; bump(c.length); });
        res.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
        res.pipe(ws);
      });
      if (segGot !== expect) throw new Error(`сегмент ${segGot}/${expect} байт`);
      return;
    } catch (e) { lastErr = e; bump(-segGot); if (a < attempts) await sleep(700 * a); }
  }
  throw lastErr;
}

function verify(file, expected, algo = 'sha1') {
  return new Promise((resolve) => {
    const h = crypto.createHash(algo);
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex').toLowerCase() === String(expected).toLowerCase()));
    s.on('error', () => resolve(false));
  });
}

module.exports = { fetchJson, fetchText, downloadFile, downloadSegmented, verify };
