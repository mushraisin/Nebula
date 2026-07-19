'use strict';
const $ = (id) => document.getElementById(id);
const api = window.nebula;

const state = {
  installed: [], available: [], catalog: [],
  selectedId: null, page: 0, profile: null, loggedIn: false, launching: false,
  installing: false, running: false, busyId: null, busyText: '',
  detailOpen: false, glass: false, theme: { bg: '#0f1512', accent: '#4fd488' }
};
// Material Design 3 is the base look; Liquid Glass is an opt-in overlay (.glass).
function applyGlass(on) { document.documentElement.classList.toggle('glass', !!on); }
const isBusy = () => state.launching || state.installing || state.running;
const PER_PAGE = 3;

/* ---------------- Theme ---------------- */
const DEFAULT_THEME = { bg: '#0f1512', accent: '#4fd488' };
const PRESETS = [
  { bg: '#0f1512', accent: '#4fd488' }, // ліс (типова)
  { bg: '#10140f', accent: '#8bd450' }, // лайм-трава
  { bg: '#0d1512', accent: '#35c4b0' }, // м'ята
  { bg: '#141009', accent: '#e6a94d' }, // бурштин
  { bg: '#14100c', accent: '#e08a52' }, // теракота
  { bg: '#0d1214', accent: '#54b8e0' }, // озеро
  { bg: '#131015', accent: '#b98cf0' }, // лаванда
  { bg: '#121413', accent: '#9fb0a4' }  // камінь
];
function hexToRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join(''); }
function shift(hex, amt) { const [r, g, b] = hexToRgb(hex); const d = 255 * amt; return rgbToHex(r + d, g + d, b + d); }
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function lum(hex) { const [r, g, b] = hexToRgb(hex).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
// Derive a Material Design 3-flavoured token set from a neutral background (surface)
// and an accent (primary seed): neutral surfaces get a subtle primary tint, and
// elevation is expressed as progressively lighter surface-container tones.
function applyTheme(bg, accent) {
  const light = lum(bg) > 0.55;
  const [ar, ag, ab] = hexToRgb(accent);
  const edge = light ? '#0b0d0c' : '#ffffff';                  // lighten (dark scheme) / darken (light)
  const lift = (amt) => mix(bg, edge, amt);
  const surf = (amt, tint) => mix(lift(amt), accent, tint);    // tinted surface-container
  const vars = {
    '--bg': bg,                                                // surface / surface-dim
    '--bg-2': surf(0.028, 0.03),                               // surface-container-low
    '--surface': surf(0.06, 0.05),                            // surface-container
    '--surface-2': surf(0.10, 0.06),                          // surface-container-high
    '--surface-3': surf(0.15, 0.07),                          // surface-container-highest
    '--text': light ? '#1a1c1b' : mix('#ffffff', accent, 0.05),           // on-surface
    '--muted': light ? mix('#3f4a45', accent, 0.06) : mix('#c3ccc7', accent, 0.06), // on-surface-variant
    '--line': light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.11)',      // outline-variant
    '--line-2': light ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.22)',    // outline
    '--accent': accent,                                        // primary
    '--on-accent': light ? '#ffffff' : mix(accent, '#0a120d', 0.74),      // on-primary
    '--accent-hover': mix(accent, edge, 0.12),                 // primary hover state
    '--primary-container': light ? mix(accent, '#ffffff', 0.6) : mix(accent, bg, 0.66),
    '--on-primary-container': light ? mix(accent, '#0a120d', 0.5) : mix(accent, '#ffffff', 0.66),
    '--secondary-container': light ? mix(surf(0.06, 0.05), accent, 0.2) : mix(surf(0.10, 0.06), accent, 0.16),
    '--accent-soft': `rgba(${ar},${ag},${ab},${light ? 0.14 : 0.18})`,    // primary state layer
    '--accent-text': light ? mix(accent, '#0a120d', 0.4) : mix(accent, '#ffffff', 0.5)
  };
  const css = ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}';
  let el = document.getElementById('theme-vars');
  if (!el) { el = document.createElement('style'); el.id = 'theme-vars'; document.head.appendChild(el); }
  el.textContent = css;
}

/* ---------------- Toasts ---------------- */
function toast(msg, kind = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toast-wrap').appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/* ---------------- Window ---------------- */
$('tb-min').onclick = () => api.win.minimize();
$('tb-close').onclick = () => api.win.close();
$('brand-home').onclick = () => closeDetail();

/* ---------------- Modals + tabs ---------------- */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close-modal]').forEach((b) => { b.onclick = () => closeModal(b.dataset.closeModal); });
document.querySelectorAll('.scrim').forEach((sc) => { sc.onclick = (e) => { if (e.target === sc) sc.classList.add('hidden'); }; });
document.querySelectorAll('.seg').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); $(t.dataset.tab).classList.add('active');
  };
});
document.querySelectorAll('.tabs .tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); $(t.dataset.pane).classList.add('active');
    if (t.dataset.pane === 'pane-mods') renderMods(selectedEntry());
  };
});
// Settings sub-tabs
document.querySelectorAll('.set-tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.set-tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.set-pane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); $(t.dataset.set).classList.add('active');
  };
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openScrim = document.querySelector('.scrim:not(.hidden)');
    if (openScrim) openScrim.classList.add('hidden');
    else if (state.detailOpen) closeDetail();
    return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (document.querySelector('.scrim:not(.hidden)') || state.detailOpen) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moveSelection(-1); }
  else if (e.key === 'Enter') {
    const en = selectedEntry(); if (!en) return;
    const card = [...document.querySelectorAll('#pack-cards .card')].find((c, i) => pageEntries()[i]?.id === state.selectedId);
    openDetail(en, card);
  }
});
function moveSelection(delta) {
  const f = featuredEntry();
  const rest = carouselList();
  const order = f ? [f, ...rest] : rest; // featured first, then carousel
  if (!order.length) return;
  let idx = order.findIndex((e) => e.id === state.selectedId);
  if (idx < 0) idx = 0;
  idx = Math.max(0, Math.min(order.length - 1, idx + delta));
  const target = order[idx];
  state.selectedId = target.id;
  if (f && target.id === f.id) { renderHome(); return; } // featured hero
  const ri = rest.findIndex((e) => e.id === target.id);
  const newPage = Math.floor(ri / PER_PAGE);
  if (newPage !== state.page) { state.page = newPage; renderHome(); }
  else setSelected(state.selectedId);
}

/* ---------------- Account ---------------- */
async function refreshAccount() {
  const { profile, active } = await api.profile();
  state.profile = profile; state.loggedIn = active;
  renderAccount(); refreshPlayButtons();
}
// Skin-head icon for a licensed (Microsoft) account. mc-heads.net is reliable and
// includes the hat overlay; falls back to crafatar, then to the gradient avatar.
function headUrl(uuid) { return `https://mc-heads.net/avatar/${String(uuid).replace(/-/g, '')}/64`; }
function altHeadUrl(uuid) { return `https://crafatar.com/avatars/${String(uuid).replace(/-/g, '')}?size=64&overlay`; }
function setSkin(el, prof) {
  el.querySelectorAll('img.skin').forEach((n) => n.remove());
  el.classList.remove('has-skin');
  if (!prof || prof.kind !== 'microsoft' || !prof.uuid) return; // only licensed accounts
  const img = document.createElement('img');
  img.className = 'skin'; img.alt = ''; img.src = headUrl(prof.uuid);
  let tried = false;
  img.onerror = () => { if (!tried) { tried = true; img.src = altHeadUrl(prof.uuid); } else { el.classList.remove('has-skin'); img.remove(); } };
  img.onload = () => el.classList.add('has-skin');
  el.appendChild(img);
}
function renderAccount() {
  const p = state.profile;
  if (p) {
    $('acc-name').textContent = p.name;
    $('acc-sub').textContent = state.loggedIn ? (p.kind === 'offline' ? 'Офлайн (піратка)' : 'Microsoft') : 'Сесія завершена';
  } else {
    $('acc-name').textContent = 'Не увійдено'; $('acc-sub').textContent = 'Увійти';
  }
  setSkin($('avatar'), state.loggedIn ? p : null);
}
function closeAccountMenu() { $('account-menu').classList.add('hidden'); }
async function doLogout() { await api.logout(); await refreshAccount(); }
async function renderAccountList() {
  const box = $('account-list'); let list = [];
  try { list = await api.accounts(); } catch { /* */ }
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="hint small" style="padding:6px 8px">Ще немає акаунтів.</div>'; return; }
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'menu-item acc' + (a.active ? ' active' : '');
    row.innerHTML = `<span class="mi-av"></span>
      <span class="mi-main"><span class="mi-name">${esc(a.name)}${a.active ? ' ✓' : ''}</span><span class="mi-kind">${a.kind === 'offline' ? 'Офлайн' : 'Microsoft'}</span></span>
      <button class="mi-del" title="Видалити">×</button>`;
    setSkin(row.querySelector('.mi-av'), a);
    row.onclick = async (ev) => {
      if (ev.target.closest('.mi-del')) return;
      closeAccountMenu();
      if (a.active) return;
      const t = toast('Перемикання на ' + a.name + '...', '', 0);
      try { await api.switchAccount(a.id); t.remove(); toast('Акаунт: ' + a.name, 'ok'); await refreshAccount(); }
      catch (e) { t.remove(); toast('Помилка: ' + e.message, 'error'); }
    };
    row.querySelector('.mi-del').onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(`Видалити акаунт "${a.name}" зі списку?`)) return;
      await api.removeAccount(a.id); await refreshAccount(); renderAccountList();
    };
    box.appendChild(row);
  }
}
$('account').onclick = async (e) => {
  e.stopPropagation();
  const menu = $('account-menu');
  if (menu.classList.contains('hidden')) { await renderAccountList(); menu.classList.remove('hidden'); }
  else menu.classList.add('hidden');
};
$('menu-add').onclick = () => { closeAccountMenu(); openModal('login-modal'); };
$('menu-logout').onclick = async () => { closeAccountMenu(); await doLogout(); };
document.addEventListener('click', (e) => { if (!e.target.closest('.account-wrap')) closeAccountMenu(); });
$('login-ms').onclick = async () => {
  const t = toast('Відкривається вікно Microsoft...', '', 0);
  try { await api.login(); t.remove(); closeModal('login-modal'); toast('Успішний вхід', 'ok'); await refreshAccount(); }
  catch (e) { t.remove(); toast('Помилка входу: ' + e.message, 'error'); }
};
$('login-offline').onclick = async () => {
  const nick = $('offline-nick').value.trim();
  try { await api.loginOffline(nick); closeModal('login-modal'); toast('Увійшли як ' + nick, 'ok'); await refreshAccount(); }
  catch (e) { toast('Помилка: ' + e.message, 'error'); }
};

/* ---------------- Data ---------------- */
async function refreshInstalled() { state.installed = await api.listPacks(); }
async function refreshAvailable() {
  try {
    const repos = await api.fetchRepos();
    const flat = [];
    for (const r of repos) if (!r.error) for (const p of r.packs) flat.push(p);
    state.available = flat;
  } catch { /* offline */ }
}
function buildCatalog() {
  const instById = new Map(state.installed.map((p) => [p.id, p]));
  const seen = new Set(); const out = [];
  for (const rp of state.available) {
    if (seen.has(rp.id)) continue; seen.add(rp.id);
    const inst = instById.get(rp.id);
    out.push({
      id: rp.id, name: rp.name, version: inst?.version || rp.version,
      icon: rp.icon || inst?.icon || null, summary: rp.summary || inst?.summary || '',
      gameVersion: inst?.gameVersion || rp.gameVersion || '', loaderType: inst?.loaderType || rp.loader || '',
      loaderVersion: inst?.loaderVersion || '',
      description: rp.description || '', media: Array.isArray(rp.media) ? rp.media : [], changelog: rp.changelog || '',
      featured: !!rp.featured,
      installed: !!inst, updatable: !!inst && !!rp.version && inst.version !== rp.version,
      repoPack: rp, pack: inst || null
    });
  }
  for (const p of state.installed) {
    if (seen.has(p.id)) continue; seen.add(p.id);
    out.push({
      id: p.id, name: p.name, version: p.version, icon: p.icon, summary: p.summary,
      gameVersion: p.gameVersion, loaderType: p.loaderType, loaderVersion: p.loaderVersion,
      description: '', media: [], changelog: '',
      featured: false,
      installed: true, updatable: false, repoPack: null, pack: p
    });
  }
  state.catalog = out;
  // Default selection prefers the featured ("main") pack.
  const featuredId = out.find((e) => e.featured)?.id;
  if (!state.selectedId || !out.find((e) => e.id === state.selectedId)) state.selectedId = featuredId || out[0]?.id || null;
}
function render() { buildCatalog(); renderHome(); if (state.detailOpen) renderDetail(); updateBadge(); }

/* ---------------- Home / carousel ---------------- */
function selectedEntry() { return state.catalog.find((e) => e.id === state.selectedId) || null; }
function featuredEntry() { return state.catalog.find((e) => e.featured) || null; }
// Carousel shows everything except the featured ("main") pack, which gets its own hero.
function carouselList() { const f = featuredEntry(); return f ? state.catalog.filter((e) => e.id !== f.id) : state.catalog; }
function pageEntries() { const list = carouselList(); const s = state.page * PER_PAGE; return list.slice(s, s + PER_PAGE); }

function loaderClass(l) { l = String(l || '').toLowerCase(); if (l.includes('neoforge')) return 'neoforge'; if (l.includes('forge')) return 'forge'; if (l.includes('quilt')) return 'quilt'; if (l.includes('fabric')) return 'fabric'; return 'vanilla'; }
function statusBadge(e) {
  if (e.updatable) return '<div class="card-status upd"><span>↑</span>Оновлення</div>';
  if (!e.installed) return '<div class="card-status new"><span>◆</span>Нове</div>';
  return '<div class="card-status ok"><span>✓</span>Встановлено</div>';
}
function cardMarkup(e) {
  const meta = [e.loaderType, e.gameVersion].filter(Boolean).join(' • ');
  return `
    <div class="card-img" ${e.icon ? `style="background-image:url('${e.icon}')"` : ''}>
      ${e.icon ? '' : `<div class="ph">${initials(e.name)}</div>`}
      ${statusBadge(e)}
      <div class="card-sel-flag">✓ обрано</div>
    </div>
    <div class="card-body">
      <div class="card-name">${esc(e.name)}</div>
      <div class="card-meta">${e.loaderType ? `<span class="ldot ${loaderClass(e.loaderType)}"></span>` : ''}<span class="card-meta-txt">${esc(meta || 'Minecraft')}</span>${e.version ? `<span class="ver-chip">v${esc(e.version)}</span>` : ''}</div>
      <div class="card-desc">${esc(e.summary || e.description || 'Опис відсутній.')}</div>
      <button class="card-detail" data-detail>Детально <span class="cd-arrow">→</span></button>
    </div>`;
}

function renderHome() {
  const has = state.catalog.length > 0;
  const featured = featuredEntry();
  const rest = carouselList();
  const hasRest = rest.length > 0;
  const pages = Math.max(1, Math.ceil(rest.length / PER_PAGE));
  if (state.page > pages - 1) state.page = pages - 1;

  $('empty').classList.toggle('hidden', has);
  $('home-bar').classList.toggle('hidden', !has);
  $('home').classList.toggle('has-featured', !!featured);
  $('featured-hero').classList.toggle('hidden', !featured);
  $('rest-label').classList.toggle('hidden', !(featured && hasRest));
  $('stage').classList.toggle('hidden', !hasRest);
  $('car-dots').classList.toggle('hidden', !hasRest);
  $('home-sub').textContent = has ? `${state.catalog.length} ${plural(state.catalog.length, 'збірка', 'збірки', 'збірок')} у бібліотеці` : 'Обери світ і поринай у гру';
  if (!has) return;

  if (featured) renderFeaturedHero($('featured-hero'), featured);

  const box = $('pack-cards'); box.innerHTML = '';
  pageEntries().forEach((e, i) => {
    const card = document.createElement('div');
    card.className = 'card' + (e.id === state.selectedId ? ' sel' : '');
    card.style.animationDelay = (i * 0.06) + 's';
    card.innerHTML = cardMarkup(e);
    // Click selects the pack for play; "Детально" opens the full detail view.
    card.onclick = () => setSelected(e.id);
    card.querySelector('[data-detail]').onclick = (ev) => { ev.stopPropagation(); setSelected(e.id); openDetail(e, card); };
    box.appendChild(card);
  });

  $('car-prev').disabled = state.page <= 0;
  $('car-next').disabled = state.page >= pages - 1;
  $('car-prev').classList.toggle('hidden', pages <= 1);
  $('car-next').classList.toggle('hidden', pages <= 1);

  const dots = $('car-dots'); dots.innerHTML = '';
  if (pages > 1) for (let p = 0; p < pages; p++) {
    const d = document.createElement('div'); d.className = 'dot' + (p === state.page ? ' active' : '');
    d.onclick = () => { state.page = p; renderHome(); };
    dots.appendChild(d);
  }
  refreshPlayButtons();
}
function setSelected(id) {
  state.selectedId = id;
  const entries = pageEntries();
  document.querySelectorAll('#pack-cards .card').forEach((c, i) => {
    c.classList.toggle('sel', entries[i]?.id === id);
  });
  const f = featuredEntry();
  $('featured-hero').classList.toggle('sel', !!f && f.id === id);
  refreshPlayButtons();
}
function renderFeaturedHero(hero, e) {
  hero.className = 'featured-hero' + (e.id === state.selectedId ? ' sel' : '');
  hero.innerHTML = `
    <div class="fh-bg" ${e.icon ? `style="background-image:url('${e.icon}')"` : ''}></div>
    <div class="fh-veil"></div>
    <div class="fh-badge">★ Головна збірка</div>
    ${statusBadge(e)}
    <div class="fh-inner">
      <div class="fh-name">${esc(e.name)}</div>
      <div class="fh-sum">${esc(e.summary || e.description || 'Опис відсутній.')}</div>
      <div class="fh-foot">
        <span class="fh-meta">${e.loaderType ? `<span class="ldot ${loaderClass(e.loaderType)}"></span>` : ''}${esc([e.loaderType, e.gameVersion].filter(Boolean).join(' • ') || 'Minecraft')}</span>
        ${e.version ? `<span class="ver-chip">v${esc(e.version)}</span>` : ''}
        <button class="fh-detail" data-fdetail>Детально <span class="cd-arrow">→</span></button>
      </div>
    </div>`;
  hero.onclick = () => setSelected(e.id);
  hero.querySelector('[data-fdetail]').onclick = (ev) => { ev.stopPropagation(); setSelected(e.id); openDetail(e, hero); };
}
$('car-prev').onclick = () => { if (state.page > 0) { state.page--; renderHome(); } };
$('car-next').onclick = () => { const pages = Math.ceil(carouselList().length / PER_PAGE); if (state.page < pages - 1) { state.page++; renderHome(); } };

function playLabel(e) {
  if (isBusy()) return state.busyText || 'Зачекайте...';
  return !e ? 'Грати'
    : !e.installed ? 'Завантажити'
    : e.updatable ? 'Оновити'
    : !state.loggedIn ? 'Увійти в акаунт'
    : 'Грати';
}
function refreshPlayButtons() {
  const e = selectedEntry();
  const busy = isBusy();
  const hp = $('home-play'); hp.disabled = busy || !e; hp.classList.toggle('busy', busy);
  $('home-play-label').textContent = playLabel(e);
  if (state.detailOpen) {
    const pb = $('play-btn'); pb.disabled = busy || !e; pb.classList.toggle('busy', busy);
    $('play-label').textContent = playLabel(e);
  }
}
function doPlayAction() {
  if (isBusy()) return; // guard against repeated clicks while working
  const e = selectedEntry(); if (!e) return;
  if (!e.installed || e.updatable) { startInstallRepo(e.repoPack, false); return; }
  if (!state.loggedIn) return openModal('login-modal');
  launchPack(e.id);
}
$('home-play').onclick = doPlayAction;
$('play-btn').onclick = doPlayAction;

/* ---------------- Detail overlay (animated) ---------------- */
function openDetail(entry, cardEl) {
  state.selectedId = entry.id;
  state.detailOpen = true;
  // reset to first tab
  document.querySelectorAll('.tabs .tab').forEach((x, i) => x.classList.toggle('active', i === 0));
  document.querySelectorAll('.pane').forEach((x, i) => x.classList.toggle('active', i === 0));
  renderDetail();
  const ov = $('detail-overlay');
  if (cardEl) {
    const r = cardEl.getBoundingClientRect();
    ov.style.transformOrigin = `${r.left + r.width / 2}px ${r.top + r.height / 2 - 52}px`;
  } else { ov.style.transformOrigin = 'center'; }
  ov.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => ov.classList.add('open'));
  $('dv-scroll').scrollTop = 0;
}
function closeDetail() {
  if (!state.detailOpen) return;
  const ov = $('detail-overlay');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden', 'true');
  state.detailOpen = false;
  renderHome();
}
$('dv-back').onclick = () => closeDetail();

function renderDetail() {
  const e = selectedEntry();
  if (!e) return;
  $('dv-name').textContent = e.name;
  $('dv-bg').style.backgroundImage = e.icon ? `url('${e.icon}')` : '';
  $('dv-icon').style.backgroundImage = e.icon ? `url('${e.icon}')` : '';
  $('dv-icon').textContent = e.icon ? '' : initials(e.name);
  $('dv-tags').innerHTML = [
    e.gameVersion ? `<span class="chip accent">${esc(e.gameVersion)}</span>` : '',
    e.loaderType ? `<span class="chip">${esc(e.loaderType)}${e.loaderVersion ? ' ' + esc(e.loaderVersion) : ''}</span>` : '',
    e.version ? `<span class="chip">v${esc(e.version)}</span>` : '',
    e.updatable ? `<span class="chip warn">оновлення → ${esc(e.repoPack.version)}</span>` : '',
    !e.installed ? '<span class="chip accent">не встановлено</span>' : ''
  ].filter(Boolean).join('');

  $('open-folder').classList.toggle('hidden', !e.installed);
  $('remove-pack').classList.toggle('hidden', !e.installed);
  refreshPlayButtons();

  renderOverview(e); renderMedia(e.media); renderChangelog(e.changelog);
  if ($('pane-mods').classList.contains('active')) renderMods(e);
}
function renderOverview(e) {
  const d = e.description && e.description.trim() ? e.description : (e.summary || 'Опис відсутній.');
  $('ov-desc').textContent = d;
  $('ov-specs').innerHTML = [
    spec('Версія MC', e.gameVersion || '-'),
    spec('Лоадер', (e.loaderType || 'vanilla') + (e.loaderVersion ? ' ' + e.loaderVersion : '')),
    spec('Версія збірки', e.version || '-'),
    spec('Статус', e.installed ? (e.updatable ? 'Є оновлення' : 'Встановлено') : 'Не встановлено')
  ].join('');
  [...$('ov-specs').children].forEach((el, i) => { el.style.animationDelay = (i * 0.05) + 's'; });
}
function spec(k, v) { return `<div class="spec"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`; }

function youtubeId(url) {
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}
function renderMedia(media) {
  const box = $('media-grid');
  if (!media || !media.length) { box.innerHTML = '<div class="muted-note">Немає медіа для цієї збірки.</div>'; return; }
  box.innerHTML = '';
  for (const url of media) {
    const yid = youtubeId(url);
    const item = document.createElement('div'); item.className = 'media-item';
    if (yid) {
      item.innerHTML = `<iframe src="https://www.youtube.com/embed/${yid}" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    } else if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) || /(^|\/\/)i\.imgur\.com\//i.test(url)) {
      item.innerHTML = `<img src="${esc(url)}" loading="lazy" alt="" />`;
    } else {
      item.className = 'media-item link';
      const b = document.createElement('button'); b.textContent = 'Відкрити посилання ↗';
      b.onclick = () => api.openExternal(url); item.appendChild(b);
    }
    box.appendChild(item);
  }
  [...box.children].forEach((el, i) => { el.style.animationDelay = (i * 0.06) + 's'; });
}
function renderChangelog(text) {
  const box = $('cl-body');
  if (!text || !text.trim()) { box.innerHTML = '<div class="muted-note">Список змін поки порожній.</div>'; return; }
  box.innerHTML = text.split('\n').map((line) => {
    const l = line.trim();
    if (/^#{1,3}\s?/.test(l)) return `<h3>${esc(l.replace(/^#{1,3}\s?/, ''))}</h3>`;
    if (/^[-*]\s+/.test(l)) return `<div class="li">${esc(l.replace(/^[-*]\s+/, ''))}</div>`;
    if (!l) return '<div class="sp"></div>';
    return `<div>${esc(l)}</div>`;
  }).join('');
}

$('open-folder').onclick = () => { const e = selectedEntry(); if (e?.installed) api.openDir(e.id); };
$('remove-pack').onclick = async () => {
  const e = selectedEntry(); if (!e?.installed) return;
  if (!confirm(`Видалити збірку "${e.name}"? Файли збірки буде видалено.`)) return;
  await api.removePack(e.id); toast('Збірку видалено', 'ok'); closeDetail(); await refreshInstalled(); render();
};

/* ---------------- Install + launch ---------------- */
async function startInstallRepo(rp, thenPlay) {
  if (!rp) { toast('Немає джерела для завантаження', 'error'); return; }
  if (isBusy()) return;
  if (thenPlay && !state.loggedIn) { openModal('login-modal'); return; }
  const inst = state.installed.find((p) => p.id === rp.id);
  const isUpd = inst && rp.version && inst.version !== rp.version;
  state.installing = true; state.busyId = rp.id;
  state.busyText = isUpd ? 'Оновлення...' : 'Завантаження...';
  state.selectedId = rp.id; render();
  const t = toast(`Встановлення: ${rp.name}...`, '', 0);
  showProgress(`${rp.name}: підготовка...`, true);
  try {
    await api.installRepo(rp); t.remove(); toast(`${rp.name}: готово`, 'ok');
    state.installing = false; state.busyId = null;
    await refreshInstalled(); render();
    if (thenPlay) { await launchPack(rp.id); } else { setProgress(1, 1, 'Готово'); setTimeout(hideProgress, 1500); }
  } catch (e) {
    state.installing = false; state.busyId = null; refreshPlayButtons();
    t.remove(); hideProgress(); toast('Помилка встановлення: ' + e.message, 'error', 6000); showError('Встановлення не вдалось: ' + e.message);
  }
}
async function launchPack(id) {
  if (!state.loggedIn) { openModal('login-modal'); return; }
  const entry = state.catalog.find((e) => e.id === id);
  state.selectedId = id; state.launching = true; state.busyId = id; state.busyText = 'Запуск...';
  renderHome(); if (state.detailOpen) renderDetail();
  showProgress(`${entry ? entry.name + ': ' : ''}підготовка...`, true);
  try { await api.play(id); }
  catch (e) { toast('Помилка запуску: ' + e.message, 'error', 6000); showError('Запуск не вдався: ' + e.message); state.launching = false; state.busyId = null; hideProgress(); refreshPlayButtons(); }
}

/* ---------------- Progress / console ---------------- */
function jsProg() { return [...document.querySelectorAll('.js-progress')]; }
function showProgress(text, indeterminate) {
  jsProg().forEach((p) => {
    p.classList.remove('hidden');
    p.querySelector('.js-progress-status').textContent = text || '';
    p.querySelector('.js-progress-pct').textContent = '';
    const fill = p.querySelector('.js-progress-fill'); fill.classList.toggle('indeterminate', !!indeterminate); fill.style.width = indeterminate ? '' : '0%';
  });
}
function setProgress(current, total, label) {
  jsProg().forEach((p) => {
    const fill = p.querySelector('.js-progress-fill');
    if (total > 0) { const pct = Math.min(100, Math.round((current / total) * 100)); fill.classList.remove('indeterminate'); fill.style.width = pct + '%'; p.querySelector('.js-progress-pct').textContent = pct + '%'; }
    else { fill.classList.add('indeterminate'); p.querySelector('.js-progress-pct').textContent = ''; }
    if (label) p.querySelector('.js-progress-status').textContent = label;
  });
}
function hideProgress() { jsProg().forEach((p) => p.classList.add('hidden')); }
function logLine(line) { const b = $('console-body'); b.textContent += line + '\n'; if (b.textContent.length > 60000) b.textContent = b.textContent.slice(-40000); b.scrollTop = b.scrollHeight; }
function showError(text) { $('console').classList.remove('hidden'); logLine('✗ ' + text); }
$('console-close').onclick = () => $('console').classList.add('hidden');
$('log-toggle').onclick = () => $('console').classList.toggle('hidden');

/* ---------------- Add pack ---------------- */
$('add-pack').onclick = () => { openModal('add-modal'); loadRepoPacks(); };
$('empty-add').onclick = () => { openModal('add-modal'); loadRepoPacks(); };
$('repo-add').onclick = async () => {
  const url = $('repo-url').value.trim(); if (!url) return;
  await api.addRepo(url); $('repo-url').value = ''; toast('Репозиторій додано', 'ok'); await refreshAvailable(); render(); loadRepoPacks();
};
async function loadRepoPacks() {
  const box = $('repo-packs'); box.innerHTML = '<div class="hint">Завантаження...</div>';
  const repos = await api.fetchRepos(); box.innerHTML = ''; let any = false;
  for (const r of repos) {
    if (r.error) { box.insertAdjacentHTML('beforeend', `<div class="hint">${esc(r.name)}: ${esc(r.error)}</div>`); continue; }
    for (const p of r.packs) {
      any = true;
      const installed = state.installed.find((x) => x.id === p.id);
      const isNewer = installed && installed.version !== p.version;
      const row = document.createElement('div'); row.className = 'repo-pack';
      row.innerHTML = `<div class="rp-icon" ${p.icon ? `style="background-image:url('${p.icon}')"` : ''}></div>
        <div class="rp-meta"><div class="rp-name">${esc(p.name)} <span class="hint">v${esc(p.version)}</span></div><div class="rp-sub">${esc(p.summary || r.name)}</div></div>
        <button class="btn-primary">${installed ? (isNewer ? 'Оновити' : 'Перевстановити') : 'Встановити'}</button>`;
      row.querySelector('button').onclick = () => { closeModal('add-modal'); startInstallRepo(p, false); };
      box.appendChild(row);
    }
  }
  if (!any) box.innerHTML = '<div class="hint">Немає збірок. Додай URL репозиторію вище.</div>';
}
$('url-install').onclick = async () => {
  const url = $('url-input').value.trim(); if (!url) return;
  const name = $('url-name').value.trim(); closeModal('add-modal');
  const t = toast('Встановлення збірки...', '', 0);
  try { const pack = await api.installUrl(url, name); t.remove(); toast('Встановлено: ' + pack.name, 'ok'); state.selectedId = pack.id; $('url-input').value = ''; $('url-name').value = ''; await refreshInstalled(); render(); }
  catch (e) { t.remove(); toast('Помилка: ' + e.message, 'error'); }
};
$('file-install').onclick = async () => {
  const t = toast('Встановлення збірки...', '', 0);
  try { const pack = await api.installFile(); t.remove(); if (!pack) return; toast('Встановлено: ' + pack.name, 'ok'); state.selectedId = pack.id; closeModal('add-modal'); await refreshInstalled(); render(); }
  catch (e) { t.remove(); toast('Помилка: ' + e.message, 'error'); }
};

/* ---------------- Updates ---------------- */
$('check-updates').onclick = async () => {
  $('upd-label').textContent = 'Перевірка...';
  try { await refreshAvailable(); render(); const n = state.catalog.filter((e) => e.updatable).length; toast(n ? `Знайдено оновлень: ${n}` : 'Все актуальне', n ? '' : 'ok'); }
  catch (e) { toast('Помилка перевірки: ' + e.message, 'error'); }
  finally { $('upd-label').textContent = 'Оновлення'; }
};
function updateBadge() { const b = $('upd-badge'); const n = state.catalog.filter((e) => e.updatable).length; b.textContent = n; b.classList.toggle('hidden', n === 0); }

/* ---------------- Settings ---------------- */
$('open-settings').onclick = async () => {
  const s = await api.getSettings();
  $('mem-min').value = s.memory.min; $('mem-max').value = s.memory.max;
  $('mem-min-val').textContent = s.memory.min; $('mem-max-val').textContent = s.memory.max;
  $('java-args').value = s.javaArgs || ''; $('close-launch').checked = !!s.closeOnLaunch; $('base-dir').value = s.baseDir;
  state.glass = s.liquidGlass === true;
  $('glass-switch').classList.toggle('on', state.glass);
  state.theme = s.theme || DEFAULT_THEME;
  setThemeInputs(state.theme); renderPresets();
  const ac = await api.adminConfig();
  $('admin-base').value = ac.base || ''; $('admin-token').value = ''; $('admin-token').placeholder = ac.hasToken ? '••••••• (збережено)' : 'LAUNCHER_ADMIN_TOKEN'; $('admin-status').textContent = '';
  renderRepoManage(); openModal('settings-modal');
};
async function saveAdminConfig() { const base = $('admin-base').value.trim(); const tok = $('admin-token').value.trim(); await api.adminSetConfig(base, tok ? tok : null); }
$('admin-verify-btn').onclick = async () => {
  await saveAdminConfig(); $('admin-status').textContent = 'Перевірка...';
  try { await api.adminVerify(); $('admin-status').textContent = '✓ Токен дійсний'; await refreshAdminButton(); }
  catch (e) { $('admin-status').textContent = '✗ ' + e.message; }
};
$('mem-min').oninput = (e) => $('mem-min-val').textContent = e.target.value;
$('mem-max').oninput = (e) => $('mem-max-val').textContent = e.target.value;
$('settings-save').onclick = async () => {
  const min = Number($('mem-min').value); const max = Math.max(min, Number($('mem-max').value));
  const theme = { bg: $('theme-bg').value, accent: $('theme-accent').value };
  state.theme = theme;
  const glassOn = $('glass-switch').classList.contains('on');
  state.glass = glassOn;
  await api.setSettings({ memory: { min, max }, javaArgs: $('java-args').value.trim(), closeOnLaunch: $('close-launch').checked, liquidGlass: glassOn, theme });
  await saveAdminConfig(); await refreshAdminButton(); toast('Збережено', 'ok'); closeSettings(true);
};

/* ---- Theme controls ---- */
function setThemeInputs(t) {
  $('theme-bg').value = t.bg; $('theme-accent').value = t.accent;
  $('theme-bg-hex').textContent = t.bg; $('theme-accent-hex').textContent = t.accent;
}
function previewTheme() {
  const bg = $('theme-bg').value, accent = $('theme-accent').value;
  $('theme-bg-hex').textContent = bg; $('theme-accent-hex').textContent = accent;
  applyTheme(bg, accent);
}
// Liquid Glass toggle - live preview; reverted on cancel like the theme.
$('glass-switch').onclick = () => {
  const on = !$('glass-switch').classList.contains('on');
  $('glass-switch').classList.toggle('on', on);
  applyGlass(on);
};
$('theme-bg').oninput = previewTheme;
$('theme-accent').oninput = previewTheme;
$('theme-reset').onclick = () => { setThemeInputs(DEFAULT_THEME); applyTheme(DEFAULT_THEME.bg, DEFAULT_THEME.accent); };
function renderPresets() {
  const box = $('theme-presets'); box.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'preset'; b.type = 'button';
    b.style.background = p.bg; b.style.setProperty('--sw', p.accent);
    b.title = `${p.bg} / ${p.accent}`;
    b.onclick = () => { setThemeInputs(p); applyTheme(p.bg, p.accent); };
    box.appendChild(b);
  }
}
function closeSettings(saved) {
  if (!saved) { applyTheme(state.theme.bg, state.theme.accent); applyGlass(state.glass); }
  closeModal('settings-modal');
}
$('settings-modal').addEventListener('click', (e) => {
  if (e.target === $('settings-modal')) closeSettings(false);
  if (e.target.closest('[data-close-modal="settings-modal"]')) closeSettings(false);
});
async function renderRepoManage() {
  const repos = await api.listRepos(); const box = $('repo-manage'); box.innerHTML = '';
  if (!repos.length) { box.innerHTML = '<div class="hint">Немає доданих репозиторіїв (окрім вбудованого).</div>'; return; }
  for (const r of repos) {
    const row = document.createElement('div'); row.className = 'repo-row';
    row.innerHTML = `<span title="${esc(r.url)}">${esc(r.url)}</span>`;
    const del = document.createElement('button'); del.className = 'win-btn'; del.textContent = '×';
    del.onclick = async () => { await api.removeRepo(r.url); await refreshAvailable(); render(); renderRepoManage(); };
    row.appendChild(del); box.appendChild(row);
  }
}

/* ---------------- Admin panel ---------------- */
async function refreshAdminButton() { try { const ac = await api.adminConfig(); $('admin-btn').classList.toggle('hidden', !ac.hasToken); } catch { $('admin-btn').classList.add('hidden'); } }
$('admin-btn').onclick = () => { clearAdminForm(); openModal('admin-modal'); renderAdminList(); };
async function renderAdminList() {
  const box = $('admin-list'); box.innerHTML = '<div class="hint">Завантаження...</div>';
  try {
    const data = await api.adminList(); const list = data.packs || []; box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="hint">Ще немає збірок. Додай нижче.</div>'; return; }
    for (const p of list) {
      const row = document.createElement('div'); row.className = 'repo-pack';
      row.innerHTML = `<div class="rp-icon" ${p.icon ? `style="background-image:url('${p.icon}')"` : ''}></div>
        <div class="rp-meta"><div class="rp-name">${p.featured ? '<span title="Головна" style="color:var(--accent)">★</span> ' : ''}${esc(p.name)} <span class="hint">v${esc(p.version || '?')}</span></div><div class="rp-sub">${esc(p.gameVersion || '')} ${esc(p.loader || '')}</div></div>
        <div class="admin-row-actions"><button class="btn-soft" data-edit>Ред.</button><button class="btn-ghost danger" data-del>✕</button></div>`;
      row.querySelector('[data-edit]').onclick = () => fillAdminForm(p);
      row.querySelector('[data-del]').onclick = async () => {
        if (!confirm(`Видалити "${p.name}" зі списку?`)) return;
        try { await api.adminRemove(p.id); toast('Видалено', 'ok'); await renderAdminList(); await refreshAvailable(); render(); }
        catch (e) { toast('Помилка: ' + e.message, 'error'); }
      };
      box.appendChild(row);
    }
  } catch (e) { box.innerHTML = `<div class="hint">Помилка: ${esc(e.message)}</div>`; }
}
function fillAdminForm(p) {
  $('af-name').value = p.name || ''; $('af-id').value = p.id || ''; $('af-version').value = p.version || '';
  $('af-gv').value = p.gameVersion || ''; $('af-loader').value = p.loader || ''; $('af-mrpack').value = p.mrpack || '';
  $('af-summary').value = p.summary || ''; $('af-icon').value = p.icon || '';
  $('af-description').value = p.description || '';
  $('af-media').value = Array.isArray(p.media) ? p.media.join('\n') : (p.media || '');
  $('af-changelog').value = p.changelog || '';
  $('af-featured').checked = !!p.featured;
}
function clearAdminForm() {
  ['af-name', 'af-id', 'af-version', 'af-gv', 'af-mrpack', 'af-summary', 'af-icon', 'af-description', 'af-media', 'af-changelog'].forEach((k) => { $(k).value = ''; });
  $('af-loader').value = ''; $('af-featured').checked = false;
}
$('admin-clear-btn').onclick = clearAdminForm;
$('admin-save-btn').onclick = async () => {
  const pack = {
    id: $('af-id').value.trim() || undefined, name: $('af-name').value.trim(), version: $('af-version').value.trim(),
    gameVersion: $('af-gv').value.trim(), loader: $('af-loader').value, mrpack: $('af-mrpack').value.trim(),
    summary: $('af-summary').value.trim(), icon: $('af-icon').value.trim(),
    description: $('af-description').value.trim(),
    media: $('af-media').value.split('\n').map((s) => s.trim()).filter(Boolean),
    changelog: $('af-changelog').value,
    featured: $('af-featured').checked
  };
  if (!pack.name) { toast('Вкажи назву', 'error'); return; }
  if (!pack.mrpack) { toast('Вкажи посилання на .mrpack', 'error'); return; }
  try { await api.adminSave(pack); toast('Збережено на сайті', 'ok'); clearAdminForm(); await renderAdminList(); await refreshAvailable(); render(); }
  catch (e) { toast('Помилка: ' + e.message, 'error'); }
};

/* ---------------- Create profile ---------------- */
let mcVersionsCache = null;
let profileToast = null;
$('new-profile').onclick = async () => {
  openModal('profile-modal');
  const sel = $('pf-mc');
  if (!mcVersionsCache) { sel.innerHTML = '<option>Завантаження...</option>'; try { mcVersionsCache = await api.mcVersions(); } catch { mcVersionsCache = []; } }
  sel.innerHTML = mcVersionsCache.map((v) => `<option value="${v}">${v}</option>`).join('');
};
$('pf-create').onclick = async () => {
  const name = $('pf-name').value.trim();
  const mc = $('pf-mc').value;
  const loader = $('pf-loader').value;
  if (!mc) { toast('Обери версію', 'error'); return; }
  closeModal('profile-modal');
  profileToast = toast(`Створення профілю ${name || ''}...`, '', 0);
  try {
    const pack = await api.createProfile({ name, mc, loader });
    profileToast.remove(); profileToast = null;
    toast('Профіль створено: ' + pack.name, 'ok');
    state.selectedId = pack.id; $('pf-name').value = '';
    await refreshInstalled(); render();
  } catch (e) {
    if (profileToast) { profileToast.remove(); profileToast = null; }
    toast('Помилка: ' + e.message, 'error', 6000); showError('Профіль: ' + e.message);
  }
};

/* ---------------- Mods manager ---------------- */
function fmtDl(n) { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'М' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'К' : String(n); }

const modsState = { packId: null, query: '', sort: 'relevance', offset: 0, limit: 20, total: 0 };
const mpid = () => modsState.packId;

function showModsView(v) {
  $('mods-toolbar').classList.toggle('hidden', v === 'page');
  $('mods-browse').classList.toggle('hidden', v !== 'browse');
  $('mods-installed-view').classList.toggle('hidden', v !== 'installed');
  $('mod-page').classList.toggle('hidden', v !== 'page');
  if (v !== 'page') $('mod-page').innerHTML = '';
}
async function renderMods(e) {
  const locked = !e || !e.installed;
  $('mods-locked').classList.toggle('hidden', !locked);
  $('mods-ui').classList.toggle('hidden', locked);
  if (locked) return;
  modsState.packId = e.id;
  $('mod-status').classList.add('hidden');
  showModsView('browse');
  await doModSearch(true);
  updateInstalledCount(e.id);
}
async function updateInstalledCount(id) {
  let n = 0; try { n = (await api.modsList(id)).length; } catch { /* */ }
  const t = n ? `(${n})` : '';
  $('mods-count').textContent = t; $('mods-count2').textContent = t;
}
async function doModSearch(reset) {
  if (!mpid()) return;
  if (reset) { modsState.query = $('mod-query').value.trim(); modsState.sort = $('mod-sort').value; modsState.offset = 0; }
  showModsView('browse');
  const res = $('mod-results'); res.innerHTML = '<div class="muted-note">Пошук...</div>'; $('mod-pager').innerHTML = '';
  try {
    const data = await api.modsSearch(mpid(), modsState.query, { offset: modsState.offset, limit: modsState.limit, sort: modsState.sort });
    modsState.total = data.total || 0;
    renderModResults(data.hits || []);
    renderModPager();
  } catch (err) { res.innerHTML = `<div class="muted-note">Помилка пошуку: ${esc(err.message)}</div>`; }
}
function renderModResults(hits) {
  const res = $('mod-results'); res.innerHTML = '';
  if (!hits.length) { res.innerHTML = '<div class="muted-note">Нічого не знайдено для цієї версії/лоадера.</div>'; return; }
  let i = 0;
  for (const h of hits) {
    const card = document.createElement('div'); card.className = 'mod-card'; card.style.animationDelay = (i++ * 0.02) + 's';
    const cats = (h.categories || []).slice(0, 4).map((c) => `<span class="mod-cat">${esc(c)}</span>`).join('');
    card.innerHTML = `
      <div class="mod-icon" ${h.icon ? `style="background-image:url('${esc(h.icon)}')"` : ''}></div>
      <div class="mod-meta">
        <div class="mod-title-row"><span class="mod-title">${esc(h.title)}</span>${h.author ? `<span class="mod-author">від ${esc(h.author)}</span>` : ''}</div>
        <div class="mod-desc">${esc(h.description || '')}</div>
        <div class="mod-tags">${cats}<span class="mod-dl">⬇ ${fmtDl(h.downloads)}</span></div>
      </div>
      <button class="btn-primary" data-add>Додати</button>`;
    card.onclick = (ev) => { if (ev.target.closest('[data-add]')) return; openModPage(h.id); };
    card.querySelector('[data-add]').onclick = async (ev) => {
      ev.stopPropagation(); const btn = ev.target; btn.disabled = true; btn.textContent = '...';
      try { await api.modsInstall(mpid(), h.id); toast(`${h.title}: додано`, 'ok'); btn.textContent = '✓ Додано'; updateInstalledCount(mpid()); }
      catch (err) { toast('Помилка: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Додати'; }
    };
    res.appendChild(card);
  }
}
function renderModPager() {
  const box = $('mod-pager'); box.innerHTML = '';
  const { offset, limit, total } = modsState;
  if (total <= limit) return;
  const page = Math.floor(offset / limit); const pages = Math.ceil(total / limit);
  const go = (p) => { modsState.offset = p * limit; doModSearch(false); $('mod-results').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const mk = (label, p, dis, active) => { const b = document.createElement('button'); b.className = 'pg' + (active ? ' active' : ''); b.textContent = label; b.disabled = !!dis; if (!dis && !active) b.onclick = () => go(p); return b; };
  const ell = () => { const s = document.createElement('span'); s.className = 'pg-ell'; s.textContent = '…'; return s; };
  box.appendChild(mk('‹', page - 1, page <= 0));
  const win = 2, start = Math.max(0, page - win), end = Math.min(pages - 1, page + win);
  if (start > 0) { box.appendChild(mk('1', 0, false, page === 0)); if (start > 1) box.appendChild(ell()); }
  for (let p = start; p <= end; p++) box.appendChild(mk(String(p + 1), p, false, p === page));
  if (end < pages - 1) { if (end < pages - 2) box.appendChild(ell()); box.appendChild(mk(String(pages), pages - 1, false, page === pages - 1)); }
  box.appendChild(mk('›', page + 1, page >= pages - 1));
  const info = document.createElement('span'); info.className = 'pg-info'; info.textContent = `${total} модів`; box.appendChild(info);
}
async function openModPage(projectId) {
  showModsView('page');
  const box = $('mod-page');
  box.innerHTML = '<div class="muted-note">Завантаження...</div>';
  let proj, versions;
  try { [proj, versions] = await Promise.all([api.modsProject(projectId), api.modsVersions(mpid(), projectId)]); }
  catch (err) { box.innerHTML = `<button class="btn-ghost mp-back" id="mp-back">← Каталог</button><div class="muted-note" style="margin-top:14px">Помилка: ${esc(err.message)}</div>`; $('mp-back').onclick = () => showModsView('browse'); return; }
  const verOpts = versions.length
    ? versions.map((v) => `<option value="${esc(v.id)}">${esc(v.versionNumber || v.name)} · ${esc((v.loaders || []).join('/'))} · ${esc((v.gameVersions || []).slice(0, 4).join(', '))}${v.type && v.type !== 'release' ? ' [' + esc(v.type) + ']' : ''}</option>`).join('')
    : '<option value="">Немає сумісних версій</option>';
  const cats = (proj.categories || []).map((c) => `<span class="mod-cat">${esc(c)}</span>`).join('');
  const gallery = (proj.gallery || []).map((g) => `<img class="mp-shot" src="${esc(g.url)}" loading="lazy" alt="${esc(g.title)}" title="${esc(g.title)}">`).join('');
  const linkNames = { source: 'Код', issues: 'Баги', wiki: 'Wiki', discord: 'Discord' };
  const links = Object.entries(proj.links || {}).filter(([, v]) => v).map(([k, v]) => `<button class="mp-link" data-link="${esc(v)}">${linkNames[k] || k}</button>`).join('');
  box.innerHTML = `
    <button class="btn-ghost mp-back" id="mp-back">← Каталог</button>
    <div class="mp-head">
      <div class="mp-icon" ${proj.icon ? `style="background-image:url('${esc(proj.icon)}')"` : ''}></div>
      <div class="mp-titles">
        <div class="mp-title">${esc(proj.title)}</div>
        <div class="mp-sub">${esc(proj.description || '')}</div>
        <div class="mp-stats"><span>⬇ ${fmtDl(proj.downloads)}</span><span>❤ ${fmtDl(proj.followers)}</span>${cats}</div>
      </div>
    </div>
    <div class="mp-actions">
      <select id="mp-version" class="mp-version">${verOpts}</select>
      <button class="btn-primary" id="mp-install" ${versions.length ? '' : 'disabled'}>Встановити</button>
      ${links ? `<div class="mp-links">${links}</div>` : ''}
    </div>
    ${gallery ? `<div class="mp-gallery">${gallery}</div>` : ''}
    <div class="prose mp-body">${mdToHtml(proj.body || proj.description || 'Опис відсутній.')}</div>`;
  $('mp-back').onclick = () => showModsView('browse');
  box.querySelectorAll('[data-link]').forEach((b) => { b.onclick = () => api.openExternal(b.dataset.link); });
  box.querySelectorAll('.mp-shot').forEach((img) => { img.onclick = () => api.openExternal(img.src); });
  box.querySelectorAll('.mp-body .md-link').forEach((s) => { s.onclick = () => api.openExternal(s.dataset.link); });
  $('mp-install').onclick = async () => {
    const vid = $('mp-version').value; if (!vid) return;
    const btn = $('mp-install'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Встановлення...';
    try { await api.modsInstallVersion(mpid(), vid); toast(`${proj.title}: встановлено`, 'ok'); btn.textContent = '✓ Встановлено'; updateInstalledCount(mpid()); setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1600); }
    catch (err) { toast('Помилка: ' + err.message, 'error'); btn.textContent = old; btn.disabled = false; }
  };
  box.scrollTop = 0;
}
// Lightweight, safe Markdown -> HTML for mod descriptions.
function mdToHtml(md) {
  md = String(md || '');
  const tok = []; const stash = (html) => { tok.push(html); return ` T${tok.length - 1} `; };
  md = md.replace(/```([\s\S]*?)```/g, (m, c) => stash('<pre>' + esc(c.replace(/^\w*\n/, '')) + '</pre>'));
  md = md.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, a, u) => stash(`<img class="md-img" src="${esc(u)}" alt="${esc(a)}" loading="lazy">`));
  md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash(`<span class="md-link" data-link="${esc(u)}">${esc(t)}</span>`));
  md = md.replace(/`([^`\n]+)`/g, (m, c) => stash('<code>' + esc(c) + '</code>'));
  let h = esc(md);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const lines = h.split('\n'); const out = []; let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const l = line.trim(); let m;
    if ((m = l.match(/^#{1,6}\s+(.*)$/))) { closeList(); out.push('<h3>' + m[1] + '</h3>'); continue; }
    if ((m = l.match(/^[-*]\s+(.*)$/))) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + m[1] + '</li>'); continue; }
    if (/^[-=]{3,}$/.test(l)) { closeList(); continue; }
    if (!l) { closeList(); continue; }
    closeList(); out.push('<p>' + line + '</p>');
  }
  closeList();
  return out.join('').replace(/ T(\d+) /g, (m, i) => tok[+i]);
}
async function loadInstalledMods(id) {
  const box = $('mods-installed');
  let list = [];
  try { list = await api.modsList(id); } catch { /* */ }
  const t = list.length ? `(${list.length})` : '';
  $('mods-count').textContent = t; $('mods-count2').textContent = t;
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="muted-note">Модів ще немає. Знайди і додай у каталозі.</div>'; return; }
  for (const m of list) {
    const row = document.createElement('div');
    row.className = 'mod-row' + (m.enabled ? '' : ' off');
    row.innerHTML = `<div class="switch ${m.enabled ? 'on' : ''}"></div><div class="mr-name">${esc(m.name)}</div><div class="mr-size">${(m.size / 1048576).toFixed(1)} МБ</div><button class="btn-ghost danger" data-del>✕</button>`;
    row.querySelector('.switch').onclick = async () => { await api.modsToggle(id, m.filename); await loadInstalledMods(id); };
    row.querySelector('[data-del]').onclick = async () => { await api.modsRemove(id, m.filename); await loadInstalledMods(id); };
    box.appendChild(row);
  }
}
$('mod-search-btn').onclick = () => doModSearch(true);
$('mod-query').onkeydown = (e) => { if (e.key === 'Enter') doModSearch(true); };
$('mod-sort').onchange = () => doModSearch(true);
$('mods-installed-btn').onclick = () => { if (mpid()) { showModsView('installed'); loadInstalledMods(mpid()); } };
$('mods-back-catalog').onclick = () => showModsView('browse');
$('mods-folder').onclick = () => { if (mpid()) api.openDir(mpid()); };

/* ---------------- Events ---------------- */
api.on((ev) => {
  switch (ev.type) {
    case 'auth-restored': refreshAccount(); break;
    // Progress is tracked by state.busyId (the pack being worked on), not the
    // currently selected pack - so the bar keeps moving even after switching packs.
    case 'task-start': if (ev.id === state.busyId) showProgress(ev.title || 'Встановлення...', true); break;
    case 'task-progress':
      if (ev.id === state.busyId) setProgress(ev.current || 0, ev.total || 0, ev.label);
      else if (ev.id === 'new-profile' && profileToast) profileToast.textContent = ev.label || 'Створення профілю...';
      break;
    case 'mods-status':
      if (ev.id === state.selectedId) { const el = $('mod-status'); if (ev.text) { el.textContent = ev.text; el.classList.remove('hidden'); } else el.classList.add('hidden'); }
      break;
    case 'launch-status': if (ev.id === state.busyId) showProgress(ev.text); break;
    case 'launch-progress': if (ev.id === state.busyId) setProgress(ev.current || 0, ev.total || 0, ev.label); break;
    case 'launch-log': logLine(ev.line); break;
    case 'launch-running':
      if (ev.id === state.busyId) { setProgress(1, 1, 'Гру запущено'); setTimeout(hideProgress, 2500); }
      // Game is now open: stay "busy" (running) so a second client can't be launched.
      state.launching = false; state.running = true; state.busyText = 'Гра запущена'; refreshPlayButtons(); toast('Minecraft запущено', 'ok'); break;
    case 'launch-closed':
      logLine(`[гру завершено, код ${ev.code}]`);
      if (ev.id === state.busyId) { state.launching = false; state.running = false; state.busyId = null; }
      hideProgress(); refreshPlayButtons(); break;
    case 'launch-error': state.launching = false; state.running = false; state.busyId = null; hideProgress(); refreshPlayButtons(); if (ev.message) showError('Запуск: ' + ev.message); break;
    case 'task-error': if (ev.message) showError('Встановлення: ' + ev.message); break;
    case 'update-available': toast(`Оновлення лаунчера ${ev.version} завантажується...`, '', 5000); break;
    case 'update-downloaded': showUpdateReady(ev.version); break;
  }
});

let updateBanner = null;
function showUpdateReady(version) {
  if (updateBanner) updateBanner.remove();
  const el = document.createElement('div');
  el.className = 'toast ok';
  el.innerHTML = `<div><b>Оновлення ${esc(version)} готове</b></div><div class="hint small">Перезапусти, щоб застосувати (або застосується при виході).</div>`;
  const b = document.createElement('button');
  b.className = 'btn-primary block'; b.style.marginTop = '10px'; b.textContent = 'Перезапустити й оновити';
  b.onclick = () => api.updaterRestart();
  el.appendChild(b);
  $('toast-wrap').appendChild(el);
  updateBanner = el;
}

/* ---------------- Utils ---------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return String(name || '?').trim().slice(0, 2).toUpperCase(); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/* ---------------- Falling leaves (accent-tinted) ---------------- */
function buildLeaves() {
  const box = $('leaves'); if (!box) return;
  const N = 14; let html = '';
  for (let i = 0; i < N; i++) {
    const left = Math.random() * 100;
    const size = 10 + Math.random() * 15;
    const dur = 9 + Math.random() * 11;          // fall duration
    const delay = -Math.random() * 22;           // negative = already in flight
    const op = (0.16 + Math.random() * 0.34).toFixed(2);
    const sway = (1.8 + Math.random() * 2.4).toFixed(2);
    html += `<div class="leaf-wrap" style="left:${left}%;width:${size}px;height:${size}px;opacity:${op};animation-duration:${dur}s;animation-delay:${delay}s"><div class="leaf" style="animation-duration:${sway}s"></div></div>`;
  }
  box.innerHTML = html;
}

/* ---------------- Boot ---------------- */
(async function boot() {
  buildLeaves();
  try { const v = await api.appVersion(); state.version = v; $('tb-ver').textContent = 'v' + v; $('set-ver').textContent = 'Nebula v' + v; } catch { /* dev/preview */ }
  try { const s = await api.getSettings(); state.theme = s.theme || DEFAULT_THEME; applyTheme(state.theme.bg, state.theme.accent); state.glass = s.liquidGlass === true; applyGlass(state.glass); } catch { applyTheme(DEFAULT_THEME.bg, DEFAULT_THEME.accent); applyGlass(false); }
  await refreshAccount();
  refreshAdminButton();
  await refreshInstalled(); render();
  await refreshAvailable(); render();
})();
