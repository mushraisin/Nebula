// Installs mod-loader version profiles into the shared versions folder.
//
// Fabric / Quilt: a meta API returns a ready launcher profile JSON; MCLC then
//   downloads their libraries at launch. -> engine "mclc".
// Forge / NeoForge: the official installer (via @xmcl/installer) downloads
//   libraries and runs the patching processors, producing a proper version
//   profile with the module-path JVM args that MCLC cannot build. Launched
//   through @xmcl/core. -> engine "xmcl".
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const javaMod = require('./java');
const { fetchJson } = require('./download');
const { install, installForge, installNeoForged } = require('@xmcl/installer');
const { createDefaultRetryHandler, resolveAgent } = require('@xmcl/file-transfer');
const { Agent } = require('undici');

// Downloader for the XMCL installers (Minecraft base + Forge/NeoForge).
//
// Two things this fixes:
//  1. Stalls. Without explicit timeouts a single hung connection (flaky wifi,
//     ISP throttling, a dead Mojang CDN edge) leaves the whole install waiting
//     forever with no error and no progress. The timeouts turn a stall into an
//     error, which the retry handler can then actually retry.
//  2. Retries. `retryHandler` is an *agent* option - passing it as a top-level
//     download option (as before) silently did nothing.
//
// It also reports how many files are done, so a slow-but-alive download no
// longer looks frozen.
function createDownloader(onStatus) {
  const dispatcher = new Agent({
    connect: { timeout: 15000 },   // TCP/TLS handshake
    headersTimeout: 30000,         // server went quiet before responding
    bodyTimeout: 60000,            // transfer stalled mid-file
    connections: 24
  });
  const agent = resolveAgent({ dispatcher, retryHandler: createDefaultRetryHandler(5) });

  let label = 'Завантаження', done = 0, lastTick = 0;
  const dispatch = agent.dispatch.bind(agent);
  agent.dispatch = async (...args) => {
    const res = await dispatch(...args);
    done++;
    const now = Date.now();
    if (now - lastTick > 300) { lastTick = now; onStatus(`${label}: ${done} файлів...`); }
    return res;
  };

  return {
    // Options for one install step; resets the per-step file counter.
    opts(stepLabel) {
      if (stepLabel) { label = stepLabel; done = 0; }
      return { agent, assetsDownloadConcurrency: 12, librariesDownloadConcurrency: 8 };
    },
    close() { try { dispatcher.destroy(); } catch { /* already closed */ } }
  };
}

// Pull the most useful underlying message out of an aggregate download error.
function detail(e) {
  const errs = e && e.errors;
  if (Array.isArray(errs) && errs.length) {
    const first = errs.find((x) => x && (x.message || x.code)) || errs[0];
    const msg = first?.message || first?.code || String(first);
    return `${e.message} (${errs.length} помилок, напр.: ${msg})`;
  }
  return e?.message || String(e);
}

// Retry an install step a few times; XMCL skips already-downloaded files, so
// each retry only fills in what failed before.
async function withRetry(label, fn, onStatus, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts) {
        onStatus(`${label}: повтор ${i + 1}/${attempts}...`);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  }
  const err = new Error(`${label}: ${detail(lastErr)}`);
  throw err;
}

// Map a mrpack `dependencies` object to a normalized loader descriptor.
function detectLoader(dependencies = {}) {
  const mc = dependencies['minecraft'];
  if (dependencies['fabric-loader'])
    return { type: 'fabric', mc, version: dependencies['fabric-loader'] };
  if (dependencies['quilt-loader'])
    return { type: 'quilt', mc, version: dependencies['quilt-loader'] };
  if (dependencies['neoforge'])
    return { type: 'neoforge', mc, version: dependencies['neoforge'] };
  if (dependencies['forge'])
    return { type: 'forge', mc, version: dependencies['forge'] };
  return { type: 'vanilla', mc, version: null };
}

async function installFabricLike(kind, mc, loaderVersion) {
  const metaBase = kind === 'quilt'
    ? 'https://meta.quiltmc.org/v3'
    : 'https://meta.fabricmc.net/v2';
  const profile = await fetchJson(`${metaBase}/versions/loader/${mc}/${loaderVersion}/profile/json`);
  const id = profile.id;
  const dir = path.join(paths.sharedDir(), 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(profile, null, 2));
  return id;
}

// NeoForge for MC 1.20.1 still lives under the `forge` project with a
// mc-prefixed version (e.g. 1.20.1-47.1.106); 1.20.2+ uses `neoforge`.
function neoTarget(loader) {
  if (loader.mc === '1.20.1') {
    const v = loader.version.includes('-') ? loader.version : `1.20.1-${loader.version}`;
    return { project: 'forge', version: v };
  }
  return { project: 'neoforge', version: loader.version };
}

// Returns { versionNumber, customVersionId, engine }.
async function installLoader(loader, onStatus = () => {}) {
  const shared = paths.sharedDir();

  if (loader.type === 'vanilla')
    return { versionNumber: loader.mc, customVersionId: null, engine: 'mclc' };

  if (loader.type === 'fabric' || loader.type === 'quilt') {
    onStatus(`Встановлення ${loader.type} ${loader.version}...`);
    const id = await installFabricLike(loader.type, loader.mc, loader.version);
    return { versionNumber: loader.mc, customVersionId: id, engine: 'mclc' };
  }

  if (loader.type === 'forge' || loader.type === 'neoforge') {
    const dl = createDownloader(onStatus);
    try {
      // 1. Vanilla base (jar + libraries + assets) is required by the installer.
      onStatus(`Завантаження Minecraft ${loader.mc} (файли + ресурси)...`);
      const meta = await javaMod.versionMeta(loader.mc);
      await withRetry('Minecraft', () => install(meta, shared, dl.opts(`Minecraft ${loader.mc}`)), onStatus);

      // 2. Java is needed to run the loader's post-processors.
      const { javaPath } = await javaMod.ensureJava(loader.mc, onStatus);

      // 3. Run the official installer -> returns the installed version id.
      onStatus(`Встановлення ${loader.type} ${loader.version}...`);
      let id;
      if (loader.type === 'neoforge') {
        const t = neoTarget(loader);
        id = await withRetry(loader.type,
          () => installNeoForged(t.project, t.version, shared, { java: javaPath, ...dl.opts(loader.type) }), onStatus);
      } else {
        id = await withRetry('forge',
          () => installForge({ mcversion: loader.mc, version: loader.version }, shared, { java: javaPath, ...dl.opts('forge') }), onStatus);
      }
      return { versionNumber: loader.mc, customVersionId: id, engine: 'xmcl' };
    } finally { dl.close(); }
  }

  throw new Error(`Невідомий лоадер: ${loader.type}`);
}

module.exports = { detectLoader, installLoader };
