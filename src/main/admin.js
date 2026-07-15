// Admin client for the site's launcher CRUD API (token-authenticated).
// Runs in the main process, so no CORS restrictions apply.
const store = require('./store');

function endpoint(path) {
  const base = (store.get('adminApiBase') || '').replace(/\/$/, '');
  if (!base) throw new Error('Не задано адресу адмін-API');
  return base + path;
}

async function req(method, path, body) {
  const token = store.get('adminToken');
  if (!token) throw new Error('Не задано адмін-токен');
  const res = await fetch(endpoint(path), {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'VoxelLauncher/1.0'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw new Error('Невірний адмін-токен');
  if (res.status === 503) throw new Error('Токен не налаштовано на сервері');
  if (!res.ok) throw new Error(`Помилка сервера: ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

module.exports = {
  verify: () => req('GET', '/admin/verify'),
  list: () => req('GET', '/admin/packs'),
  save: (pack) => req('POST', '/admin/packs', pack),          // create or upsert
  remove: (id) => req('DELETE', '/admin/packs/' + encodeURIComponent(id))
};
