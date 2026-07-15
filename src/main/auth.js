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
async function login() {
  const xbox = await authManager.launch('electron');
  const mc = await xbox.getMinecraft();
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
    const xbox = await authManager.refresh(acc.token);
    const mc = await xbox.getMinecraft();
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
