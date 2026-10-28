'use strict';

// Deployment is an explicit allowlist, never an upload of the repository root.
// No customer data, test fixtures, diagnostics, backend implementation or Git history belongs here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ROOT_FILES = new Set(['.nojekyll', '404.html', 'catalogo.html', 'index.html', 'manifest.json', 'service-worker.js']);
const SHARED_FILES = new Set(['online-order.js', 'online-store.js', 'plan-catalog.js', 'product-model.js', 'product-spreadsheet.js', 'permission-policy.js'].map(name => 'functions/src/shared/' + name));
const RETIRED_FILES = new Set(['kyteData.js', 'kyteBalances.js', 'kyteBootstrap.js', 'saldoCorrecoes.js', 'cleanupDemo.js', 'financeMigration.js'].map(name => name.toLowerCase()));
const HISTORICAL_HASHES = new Set([
  '27d48673824d3f3051da5e579a4063164a28d757f18e269003f5925c646a3de7',
  '543f3186c6a00e49730c2bc16b166d91ca851f9fa0497016fe6f40ff8b1d9bff',
  'bd9b843269f7f41b141e2bbb7c9dd74a72466e1e7e235bf3aa54efd6c00f8d72',
]);

function assertSafePublicFile(file, bytes) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || path.posix.normalize(file) !== file || file.startsWith('/') || file.split('/').some(part => part === '..' || part.startsWith('.'))) {
    if (file !== '.nojekyll') throw new Error('Invalid public path');
  }
  const allowed = ROOT_FILES.has(file) || SHARED_FILES.has(file) ||
    /^(?:js\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js|css\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.css|assets\/[a-zA-Z0-9_.-]+\.(?:png|svg|ico|js|txt))$/.test(file);
  if (!allowed || RETIRED_FILES.has(path.posix.basename(file).toLowerCase())) throw new Error('Non-public resource rejected: ' + file);
  if (bytes) {
    const normalized = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const sha = crypto.createHash('sha256').update(normalized).digest('hex');
    if (HISTORICAL_HASHES.has(sha) || /\bKYTE_(?:CLIENTS|BALANCES)\b/.test(normalized)) throw new Error('Historical import data rejected: ' + file);
  }
}

function assertReferencesIncluded(files) {
  const names = new Set(files.keys());
  function requireReference(from, ref, relative = false) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return;
    let resource = ref.split(/[?#]/)[0];
    if (!resource || resource === './') return;
    resource = path.posix.normalize(path.posix.join(relative ? path.posix.dirname(from) : '.', resource));
    if (!names.has(resource)) throw new Error('Missing public dependency: ' + from + ' -> ' + resource);
  }
  for (const [name, bytes] of files) {
    const source = bytes.toString('utf8');
    if (name.endsWith('.html')) for (const match of source.matchAll(/(?:src|href)=["'](\.[^"']+)["']/g)) requireReference(name, match[1]);
    if (name.endsWith('.css')) for (const match of source.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)) requireReference(name, match[1], true);
    if (name.endsWith('.js')) {
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)) requireReference(name, match[1], true);
      for (const match of source.matchAll(/\b(?:importScripts|Worker)\s*\(\s*["'](\.[^"']+)["']/g)) requireReference(name, match[1], !source.includes('new Worker'));
    }
  }
  const context = {self: {addEventListener() {}}, URL, Request, Response};
  vm.runInNewContext(files.get('service-worker.js').toString('utf8') + '\nself.precache = ARQUIVOS;', context, {timeout: 1000});
  for (const ref of context.self.precache) requireReference('service-worker.js', ref);
  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  for (const icon of manifest.icons || []) requireReference('manifest.json', icon.src);
}

function buildPublicSite({root = ROOT, outDir = path.join(root, 'dist-public'), manifest} = {}) {
  root = path.resolve(root);
  outDir = path.resolve(outDir);
  // Fail closed on reused output: no stale file can survive a previous package.
  if (fs.existsSync(outDir)) throw new Error('Public output must not exist; use a new empty output path');
  if (!outDir.startsWith(root + path.sep)) throw new Error('Public output must be inside the source directory');
  manifest = manifest || JSON.parse(fs.readFileSync(path.join(root, 'public-site.manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.domain !== 'veconi.app.br' || !Array.isArray(manifest.files)) throw new Error('Invalid public manifest');
  const files = new Map();
  for (const file of manifest.files) {
    assertSafePublicFile(file);
    if (files.has(file)) throw new Error('Duplicate public path: ' + file);
    const source = path.join(root, file);
    let ancestor = root;
    for (const part of file.split('/')) {
      ancestor = path.join(ancestor, part);
      if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Symlink rejected: ' + file);
    }
    if (!fs.statSync(source).isFile()) throw new Error('Not a regular public file: ' + file);
    const bytes = fs.readFileSync(source);
    assertSafePublicFile(file, bytes);
    files.set(file, bytes);
  }
  for (const file of ROOT_FILES) if (!files.has(file)) throw new Error('Required public file missing: ' + file);
  assertReferencesIncluded(files);
  files.set('CNAME', Buffer.from(manifest.domain + '\n'));
  // All validation completes before writing any output. No source, storage or business data is modified.
  fs.mkdirSync(outDir);
  for (const [file, bytes] of files) {
    const target = path.join(outDir, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes, {flag: 'wx'});
  }
  return {outDir, fileCount: files.size, bytes: [...files.values()].reduce((total, bytes) => total + bytes.length, 0)};
}

if (require.main === module) {
  try {
    const result = buildPublicSite();
    console.log('Public package validated: ' + result.fileCount + ' allowlisted files, ' + result.bytes + ' bytes.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {buildPublicSite, assertSafePublicFile, assertReferencesIncluded};
