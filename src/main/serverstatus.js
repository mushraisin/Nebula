// Live server status for the home screen.
//
// Two independent probes, run in parallel and merged:
//   1. Server List Ping (SLP) on 25565 - the vanilla protocol. Gives reliable
//      online/offline + player counts. Resolves SRV records first (many servers
//      publish _minecraft._tcp.<host>). This works with zero server-side changes.
//   2. HTTP status from our ServerPulse mod (see the `serverpulse-mod` folder) -
//      gives the TPS/MSPT the vanilla protocol does not expose.
//
// Merge rule: online = either probe succeeded; tps comes from the mod; players
// prefer SLP. If the mod endpoint is unreachable but SLP works, we still show the
// server as online, just without a TPS number.
const net = require('net');
const dns = require('dns').promises;

const DEFAULT_SLP_PORT = 25565;
const DEFAULT_HTTP_PORT = 25728; // must match ServerPulse's config `port`

/* ---------- VarInt helpers (Minecraft protocol) ---------- */
function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}
// Read a VarInt at offset; returns { value, size } or null if not enough bytes.
function readVarInt(buf, offset) {
  let value = 0, size = 0, byte;
  do {
    if (offset + size >= buf.length) return null;
    byte = buf[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size++;
    if (size > 5) throw new Error('VarInt задовгий');
  } while (byte & 0x80);
  return { value: value >>> 0, size };
}
function packet(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}
function mcString(str) {
  const s = Buffer.from(str, 'utf-8');
  return Buffer.concat([writeVarInt(s.length), s]);
}

// Resolve a Minecraft SRV record (falls back to the plain host:port).
async function resolveTarget(host, port) {
  try {
    const recs = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (recs && recs.length) {
      recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
      return { host: recs[0].name, port: recs[0].port };
    }
  } catch { /* no SRV -> use host:port directly */ }
  return { host, port };
}

// Vanilla Server List Ping. Resolves { online, players } or { online:false }.
async function slpPing(host, port, timeout) {
  const target = await resolveTarget(host, port);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch { /* */ } resolve(v); } };
    const socket = net.connect({ host: target.host, port: target.port });
    socket.setTimeout(timeout, () => finish({ online: false }));
    socket.on('error', () => finish({ online: false }));
    socket.on('connect', () => {
      // Handshake: protocol -1 (any), server addr, port, next state = 1 (status).
      const handshake = packet(0x00, Buffer.concat([
        writeVarInt(0xffffffff), mcString(target.host),
        Buffer.from([(target.port >> 8) & 0xff, target.port & 0xff]),
        writeVarInt(1)
      ]));
      socket.write(handshake);
      socket.write(packet(0x00, Buffer.alloc(0))); // Status Request
    });
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarInt(buf, 0);
        if (!len) return;                                   // length not complete yet
        const total = len.size + len.value;
        if (buf.length < total) return;                     // full packet not here yet
        let off = len.size;
        const pid = readVarInt(buf, off); off += pid.size;  // packet id (0x00)
        const strLen = readVarInt(buf, off); off += strLen.size;
        if (buf.length < off + strLen.value) return;
        const json = JSON.parse(buf.slice(off, off + strLen.value).toString('utf-8'));
        finish({ online: true, players: json.players ? { online: json.players.online, max: json.players.max } : null });
      } catch { finish({ online: false }); }
    });
  });
}

// Fetch TPS from the ServerPulse mod's HTTP endpoint.
async function httpStatus(host, port, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`http://${host}:${port}/status`, { signal: ctrl.signal, headers: { 'User-Agent': 'NebulaLauncher' } });
    if (!res.ok) return null;
    const j = await res.json();
    const tps = typeof j.tps === 'number' ? Math.round(j.tps * 10) / 10 : null;
    return { online: true, tps, mspt: typeof j.mspt === 'number' ? j.mspt : null, players: j.players || null };
  } catch { return null; }
  finally { clearTimeout(t); }
}

// Public: combined status for one server address.
async function query(host, opts = {}) {
  const slpPort = opts.slpPort || DEFAULT_SLP_PORT;
  const httpPort = opts.httpPort || DEFAULT_HTTP_PORT;
  const timeout = opts.timeout || 3500;
  const [slp, http] = await Promise.all([
    slpPing(host, slpPort, timeout),
    httpStatus(host, httpPort, timeout)
  ]);
  const online = !!((slp && slp.online) || (http && http.online));
  const tps = http && http.tps != null ? http.tps : null;
  const players = (slp && slp.players) || (http && http.players) || null;
  return { online, tps, mspt: http ? http.mspt : null, players };
}

module.exports = { query };
