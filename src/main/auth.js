// Authentication + account manager: Microsoft / Xbox (msmc) and offline.
// Multiple accounts are saved; one is "active" and used for launching.
// The active identity (`current`) exposes MCLC / @xmcl auth adapters.
const crypto = require('crypto');
const { Auth } = require('msmc');
const store = require('./store');

const authManager = new Auth('select_account');

let current = null; // active identity { kind, name, uuid, accessToken, mclc }

/* ---------- identity builders ---------- */
function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}
function buildOffline(name) {
  const uuid = offlineUUID(name);
  return {
    kind: 'offline', name, uuid, accessToken: '0', userProperties: '{}',
    mclc: { access_token: '0', client_token: uuid, uuid, name, user_properties: '{}', meta: { type: 'mojang', demo: false } }
  };
}
function buildMicrosoft(mc) {
  const m = mc.mclc();
  return { kind: 'microsoft', name: mc.profile?.name || m.name, uuid: m.uuid, accessToken: m.access_token, userProperties: m.user_properties || '{}', mclc: m };
}
function publicProfile() { return current ? { name: current.name, uuid: current.uuid, kind: current.kind } : null; }

/* ---------- account store helpers ---------- */
function accounts() { return store.get('accounts') || []; }
function migrateLegacy() {
  const old = store.get('account');
  if (old?.profile && !accounts().length) {
    const a = { id: (old.kind === 'offline' ? 'off:' : 'ms:') + old.profile.uuid, kind: old.kind, name: old.profile.name, uuid: old.profile.uuid, token: old.token };
    store.update((c) => { c.accounts = [a]; c.activeAccountId = a.id; c.account = null; });
  }
}
function upsert(acc) {
  store.update((c) => {
    c.accounts = c.accounts || [];
    const i = c.accounts.findIndex((a) => a.id === acc.id);
    if (i >= 0) c.accounts[i] = acc; else c.accounts.push(acc);
  });
}
function setActive(id) { store.set('activeAccountId', id); }

/* ---------- login ---------- */
// msmc rejects with { name: <lexcode>, message }. Translate the codes people
// actually hit into something actionable instead of a raw lexcode.
const AUTH_ERRORS = {
  'error.gui.closed': 'Вікно входу закрито — вхід скасовано.',
  'error.auth.minecraft.entitlements': 'На цьому акаунті немає Minecraft: Java Edition. Перевір, що гра куплена саме на ньому.',
  'error.auth.minecraft.profile': 'В акаунті ще не створено профіль Minecraft (нік). Створи його на minecraft.net і спробуй знову.',
  'error.auth.minecraft.login': 'Не вдалось увійти в Minecraft. Спробуй ще раз за кілька хвилин.',
  'error.auth.xsts.userNotFound': 'До цього акаунта Microsoft не привʼязаний Xbox Live.',
  'error.auth.xsts.child': 'Дитячий акаунт: потрібна згода дорослого в сімейній групі Microsoft.',
  'error.auth.xsts.bannedCountry': 'Xbox Live недоступний у цій країні (спробуй без VPN або з іншим регіоном).',
  'error.auth.xboxLive': 'Не вдалось увійти в Xbox Live.',
  'error.auth.microsoft': 'Не вдалось увійти в акаунт Microsoft.',
  'error.state.invalid': 'Вхід перервано (невірний стан). Спробуй ще раз.',
  'error.auth': 'Помилка авторизації Microsoft.'
};
function authError(e) {
  const code = e && (e.name || e.type);
  if (typeof code === 'string' && code.startsWith('error')) {
    const parts = code.split('.');
    while (parts.length) {                       // walk up: a.b.c -> a.b -> a
      const hit = AUTH_ERRORS[parts.join('.')];
      if (hit) return new Error(hit);
      parts.pop();
    }
  }
  const msg = String((e && (e.message || e.reason)) || e || 'невідома помилка');
  if (/network|fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket|getaddrinfo/i.test(msg))
    return new Error('Немає звʼязку з серверами Microsoft. Перевір інтернет (або вимкни VPN) і спробуй ще раз.');
  return new Error(msg);
}
// Never leave the UI waiting forever on a stuck auth step.
function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })
  ]);
}

async function login() {
  let xbox, mc;
  try {
    xbox = await withTimeout(authManager.launch('electron'), 5 * 60 * 1000,
      'Час на вхід вичерпано. Закрий вікно Microsoft і спробуй ще раз.');
  } catch (e) { throw authError(e); }
  try {
    mc = await withTimeout(xbox.getMinecraft(), 60 * 1000,
      'Microsoft не відповідає на запит профілю Minecraft. Спробуй ще раз.');
  } catch (e) { throw authError(e); }
  current = buildMicrosoft(mc);
  const acc = { id: 'ms:' + current.uuid, kind: 'microsoft', name: current.name, uuid: current.uuid, token: xbox.save() };
  upsert(acc); setActive(acc.id);
  return publicProfile();
}
async function loginOffline(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(clean)) throw new Error('Нік: 3-16 символів, латиниця/цифри/_');
  current = buildOffline(clean);
  const acc = { id: 'off:' + current.uuid, kind: 'offline', name: current.name, uuid: current.uuid };
  upsert(acc); setActive(acc.id);
  return publicProfile();
}

/* ---------- switch / restore / remove ---------- */
async function activate(acc) {
  if (acc.kind === 'offline') { current = buildOffline(acc.name); }
  else {
    let xbox, mc;
    // A stale/revoked refresh token must fail fast with a readable reason,
    // otherwise switching accounts just hangs.
    try {
      xbox = await withTimeout(authManager.refresh(acc.token), 45 * 1000,
        'Microsoft не відповідає. Спробуй ще раз або увійди заново.');
      mc = await withTimeout(xbox.getMinecraft(), 45 * 1000,
        'Microsoft не відповідає на запит профілю Minecraft.');
    } catch (e) { throw authError(e); }
    current = buildMicrosoft(mc);
    upsert({ ...acc, name: current.name, uuid: current.uuid, token: xbox.save() });
  }
  setActive(acc.id);
  return publicProfile();
}
async function switchAccount(id) {
  const acc = accounts().find((a) => a.id === id);
  if (!acc) throw new Error('Акаунт не знайдено');
  return activate(acc);
}
async function restore() {
  migrateLegacy();
  const id = store.get('activeAccountId');
  if (!id) return null;
  const acc = accounts().find((a) => a.id === id);
  if (!acc) return null;
  try { return await activate(acc); } catch { return null; }
}
async function removeAccount(id) {
  const wasActive = store.get('activeAccountId') === id;
  store.update((c) => { c.accounts = (c.accounts || []).filter((a) => a.id !== id); });
  if (wasActive) {
    current = null;
    const next = accounts()[0];
    if (next) { try { return await activate(next); } catch { setActive(null); } }
    else setActive(null);
  }
  return publicProfile();
}
function logout() { current = null; setActive(null); }

/* ---------- queries / adapters ---------- */
function listAccounts() {
  const active = store.get('activeAccountId');
  return accounts().map((a) => ({ id: a.id, name: a.name, uuid: a.uuid, kind: a.kind, active: a.id === active }));
}
function profile() { return publicProfile(); }
function isLoggedIn() { return !!current; }
function mclcAuth() { if (!current) throw new Error('Спочатку увійдіть в акаунт'); return current.mclc; }
function xmclAuth() { if (!current) throw new Error('Спочатку увійдіть в акаунт'); return { uuid: current.uuid, name: current.name, accessToken: current.accessToken, userType: 'mojang' }; }

module.exports = { login, loginOffline, switchAccount, removeAccount, restore, logout, listAccounts, profile, isLoggedIn, mclcAuth, xmclAuth };
