// Resolves the on-disk layout for the launcher.
//
//   <baseDir>/
//     shared/        <- versions, libraries, assets (shared between all packs)
//     instances/<id> <- per-pack game dir (mods, config, saves, options.txt)
//     java/<major>   <- auto-installed JRE runtimes
//     tmp/           <- scratch for downloads
const path = require('path');
const fs = require('fs');
const store = require('./store');

function base() {
  return store.get('baseDir');
}

function sharedDir() {
  return ensure(path.join(base(), 'shared'));
}

function instancesDir() {
  return ensure(path.join(base(), 'instances'));
}

function instanceDir(id) {
  return ensure(path.join(instancesDir(), id));
}

function javaDir() {
  return ensure(path.join(base(), 'java'));
}

function tmpDir() {
  return ensure(path.join(base(), 'tmp'));
}

function ensure(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

module.exports = { base, sharedDir, instancesDir, instanceDir, javaDir, tmpDir, ensure };
