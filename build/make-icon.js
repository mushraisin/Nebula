// Generates build/icon.ico + build/icon.png entirely in Node (no external raster
// tools): draws the Nebula logo - a glossy glass leaf with a specular highlight and
// accent glow on a dark rounded square - into an RGBA buffer, encodes a PNG by hand,
// then builds the .ico via png-to-ico.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const _pti = require('png-to-ico');
const pngToIco = typeof _pti === 'function' ? _pti : _pti.default;

const S = 256;
const R = 58;                    // corner radius
const BG_TOP = [30, 42, 34];     // frosted top
const BG_BOT = [12, 18, 15];     // deep bottom
const GLOW = [79, 212, 136];     // accent glow behind leaf
const LEAF_LIGHT = [140, 240, 178];
const LEAF_MID = [79, 212, 136];
const LEAF_DEEP = [40, 150, 104];
const RIM = [190, 255, 220];
const VEIN = [16, 66, 46];

function inRounded(x, y) {
  const dx = Math.max(R - x, x - (S - 1 - R), 0);
  const dy = Math.max(R - y, y - (S - 1 - R), 0);
  return dx * dx + dy * dy <= R * R;
}
// distance to the rounded-rect border (approx), for the glass edge highlight
function edgeDist(x, y) {
  const dx = Math.max(R - x, x - (S - 1 - R), 0);
  const dy = Math.max(R - y, y - (S - 1 - R), 0);
  if (dx === 0 && dy === 0) return Math.min(x, y, S - 1 - x, S - 1 - y);
  return R - Math.hypot(dx, dy);
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Leaf: pointed oval along the TL->BR diagonal.
const TIPX = 194, TIPY = 62, BASEX = 62, BASEY = 194;
function leafParam(px, py) {
  const vx = TIPX - BASEX, vy = TIPY - BASEY;
  const len2 = vx * vx + vy * vy;
  const t = ((px - BASEX) * vx + (py - BASEY) * vy) / len2; // 0..1 base->tip
  const perp = ((px - BASEX) * -vy + (py - BASEY) * vx) / Math.sqrt(len2);
  return { t, perp };
}
function leafCoverage(px, py) {
  const { t, perp } = leafParam(px, py);
  if (t < 0 || t > 1) return 0;
  const w = Math.sin(Math.PI * t) * 66; // half-width profile
  return clamp01((w - Math.abs(perp)) / 1.6);
}

const SS = 3; // supersampling
const buf = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      if (!inRounded(px, py)) continue;

      // background gradient + accent glow behind the leaf
      let c = mix(BG_TOP, BG_BOT, clamp01((px + py) / (2 * S)));
      const glow = clamp01(1 - Math.hypot(px - 128, py - 132) / 150);
      c = mix(c, GLOW, glow * glow * 0.4);

      // leaf
      const lc = leafCoverage(px, py);
      if (lc > 0) {
        const { t, perp } = leafParam(px, py);
        // base gradient across length + shade across width
        let pc = t < 0.5 ? mix(LEAF_LIGHT, LEAF_MID, t / 0.5) : mix(LEAF_MID, LEAF_DEEP, (t - 0.5) / 0.5);
        const widthShade = clamp01(0.72 + (perp / 66) * 0.5); // lighter on upper-left side
        pc = [pc[0] * widthShade, pc[1] * widthShade, pc[2] * widthShade];
        // central vein
        const vein = clamp01((2.2 - Math.abs(perp)) / 1.6) * (t > 0.06 && t < 0.94 ? 1 : 0);
        pc = mix(pc, VEIN, vein * 0.45);
        // specular gloss: soft bright blob on the upper-left of the leaf
        const spec = clamp01(1 - Math.hypot(px - 104, py - 100) / 48);
        pc = mix(pc, [255, 255, 255], Math.pow(spec, 1.6) * 0.5);
        // rim light on the lower-right edge
        const rim = clamp01(1 - (leafCoverage(px, py))) * (perp < -30 ? 1 : 0);
        pc = mix(pc, RIM, rim * 0.25);
        c = mix(c, pc, lc);
      }

      // glass edge highlight (top) + soft bottom shade
      const ed = edgeDist(px, py);
      if (ed < 3 && py < S * 0.6) c = mix(c, [255, 255, 255], (1 - ed / 3) * 0.16);

      r += c[0]; g += c[1]; b += c[2]; a += 255;
    }
    const n = SS * SS, o = (y * S + x) * 4;
    buf[o] = Math.round(r / n); buf[o + 1] = Math.round(g / n); buf[o + 2] = Math.round(b / n); buf[o + 3] = Math.round(a / n);
  }
}

// ---- minimal PNG encoder ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
pngToIco([png]).then((ico) => {
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
  console.log('icon.png:', png.length, '| icon.ico:', ico.length, 'bytes');
}).catch((e) => { console.error('ICO fail:', e.message); process.exit(1); });
