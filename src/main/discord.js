// Discord Rich Presence - dependency-free. Connects to the local Discord client
// over its IPC pipe (no bot token needed, only an Application/Client ID that the
// user creates at https://discord.com/developers). Fully optional and silent:
// if Discord isn't running or no client id is set, everything no-ops.
const net = require('net');
const store = require('./store');

// ★★★ ВСТАВ СЮДИ Application ID застосунку "Nebula" з https://discord.com/developers
// (створюється ОДИН раз тобою; після цього Rich Presence працює автоматично у ВСІХ
// користувачів - їм нічого вводити не треба). Порожнє = вимкнено.
const BUILTIN_CLIENT_ID = '1526629615660044438';

let socket = null, connected = false, ready = false;
let buf = Buffer.alloc(0);
let clientId = null, pending = null, startTs = Date.now();
let retryTimer = null, stopped = false;

const OP_HANDSHAKE = 0, OP_FRAME = 1, OP_CLOSE = 2;

function pipePath(id) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${id}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return `${String(base).replace(/\/$/, '')}/discord-ipc-${id}`;
}

function encode(op, data) {
  const body = Buffer.from(JSON.stringify(data));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function write(op, data) {
  if (socket && !socket.destroyed) { try { socket.write(encode(op, data)); } catch { /* ignore */ } }
}

function tryConnect(id) {
  if (stopped || !clientId) return;
  if (id > 9) { scheduleRetry(); return; }
  const s = net.connect(pipePath(id));
  s.once('error', () => { try { s.destroy(); } catch { /* */ } tryConnect(id + 1); });
  s.once('connect', () => {
    socket = s; connected = true; buf = Buffer.alloc(0);
    s.on('data', onData);
    s.on('close', handleClose);
    s.on('error', handleClose);
    write(OP_HANDSHAKE, { v: 1, client_id: clientId });
  });
}

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0);
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) break;
    const payload = buf.slice(8, 8 + len).toString();
    buf = buf.slice(8 + len);
    if (op === OP_CLOSE) { handleClose(); return; }
    let msg = null; try { msg = JSON.parse(payload); } catch { /* */ }
    if (msg && msg.evt === 'READY') { ready = true; if (pending) setActivity(pending); }
  }
}

function handleClose() {
  connected = false; ready = false;
  if (socket) { try { socket.destroy(); } catch { /* */ } socket = null; }
  scheduleRetry();
}

function scheduleRetry() {
  if (stopped || !clientId) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (!connected) tryConnect(0); }, 15000);
}

function setActivity(activity) {
  pending = activity;
  if (!ready) return;
  write(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) });
}

function activity(details, state) {
  const a = {
    details, // 2nd line under "Playing Nebula"
    timestamps: { start: startTs },
    assets: { large_image: 'logo', large_text: 'Nebula Launcher' },
    instance: false
  };
  if (state) a.state = state; // 3rd line
  return a;
}
function resolveId() {
  return (BUILTIN_CLIENT_ID || String(store.get('discordClientId') || '')).trim();
}

module.exports = {
  init() {
    clientId = resolveId();
    stopped = false;
    if (!clientId) return;
    startTs = Date.now();
    tryConnect(0);
    this.setIdle();
  },
  // Re-init if the id changed (e.g. optional override).
  reload() {
    const id = resolveId();
    if (id === clientId && (connected || !id)) return;
    this.shutdown();
    this.init();
  },
  setIdle() { if (clientId) setActivity(activity('У головному меню', 'Обирає збірку')); },
  setPlaying(name, gameVersion, loader) {
    if (!clientId) return;
    startTs = Date.now();
    const sub = [loader, gameVersion].filter(Boolean).join(' ');
    setActivity(activity(name || 'Minecraft', sub || undefined));
  },
  shutdown() {
    stopped = true; clearTimeout(retryTimer);
    if (socket) { try { socket.destroy(); } catch { /* */ } socket = null; }
    connected = false; ready = false; pending = null;
  }
};
