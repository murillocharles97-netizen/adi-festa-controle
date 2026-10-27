'use strict';
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {buildPublicSite, assertSafePublicFile, assertReferencesIncluded} = require('../scripts/build-public-site.cjs');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public-site.manifest.json'), 'utf8'));
let scratch, fixture, result, server, origin;
before(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'veconi-public-containment-'));
  fixture = path.join(scratch, 'source');
  fs.mkdirSync(fixture);
  for (const file of manifest.files) {
    const dest = path.join(fixture, file);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.copyFileSync(path.join(root, file), dest);
  }
  // Synthetic private material must never be copied even if it exists in the source tree.
  for (const file of ['diagnostic.json', 'tests/private.json', '.git/config', 'functions/src/private.js', 'js/unapproved.js']) {
    const dest = path.join(fixture, file);
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, 'SYNTHETIC_PRIVATE_SENTINEL');
  }
  result = buildPublicSite({root: fixture, manifest});
  server = http.createServer((req, res) => {
    let relative;
    try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch (_) { res.writeHead(400).end(); return; }
    const target = path.resolve(result.outDir, relative);
    if (!target.startsWith(result.outDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200); fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (scratch && scratch.startsWith(path.join(os.tmpdir(), 'veconi-public-containment-'))) fs.rmSync(scratch, {recursive: true, force: true});
});
test('public package contains exactly the reviewed allowlist and unchanged custom domain', () => {
  assert.equal(result.fileCount, manifest.files.length + 1);
  assert.equal(fs.readFileSync(path.join(result.outDir, 'CNAME'), 'utf8'), 'veconi.app.br\n');
  for (const file of manifest.files) assert.deepEqual(fs.readFileSync(path.join(result.outDir, file)), fs.readFileSync(path.join(root, file)), file);
});
test('private diagnostics, repository, tests, server implementation and unapproved resources cannot enter package', () => {
  for (const file of ['diagnostic.json', 'tests/private.json', '.git/config', 'functions/src/private.js', 'js/unapproved.js', 'firestore.rules', 'package.json', '.github/workflows/deploy-pages.yml']) assert.equal(fs.existsSync(path.join(result.outDir, file)), false, file);
});
test('tracked historical static datasets are absent and HTML has no import references', () => {
  for (const file of ['js/kyteData.js', 'js/kyteBalances.js', 'js/saldoCorrecoes.js']) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  for (const file of ['index.html', 'catalogo.html']) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /kyteData\.js|kyteBalances\.js|saldoCorrecoes\.js|kyteBootstrap\.js/);
});
test('Pages workflow uploads only the validated package and runs containment tests', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
  assert.match(workflow, /npm run test:public-containment/);
  assert.match(workflow, /npm run build:public/);
  assert.match(workflow, /path: dist-public/);
  assert.doesNotMatch(workflow, /path: \.(?:\s|$)/);
});
test('artifact cannot reuse a stale output directory', () => {
  assert.throws(() => buildPublicSite({root: fixture, manifest}), /must not exist/);
});
test('manifest rejects traversal, absolute paths, hidden paths and Windows separator aliases', () => {
  for (const file of ['../private.json', '/js/app.js', 'js/../js/app.js', 'js\\app.js', '.git/config', 'js/.hidden.js', 'C:/private.js']) assert.throws(() => assertSafePublicFile(file), /Invalid|Non-public/, file);
});
test('retired import scripts stay blocked even if manually added to the allowlist', () => {
  for (const file of ['kyteData.js', 'kyteBalances.js', 'kyteBootstrap.js', 'saldoCorrecoes.js', 'cleanupDemo.js', 'financeMigration.js']) assert.throws(() => assertSafePublicFile('js/' + file), /Non-public/);
});
test('renamed historical import datasets fail content validation without logging their contents', () => {
  for (const marker of ['KYTE_CLIENTS', 'KYTE_BALANCES']) assert.throws(() => assertSafePublicFile('js/renamed.js', Buffer.from('window.' + marker + ' = [{synthetic:true}];')), /Historical import data rejected: js\/renamed.js$/);
});
test('server shared code is restricted to the five existing browser modules', () => {
  assert.throws(() => assertSafePublicFile('functions/src/shared/sale-exchange.js'), /Non-public/);
  assert.throws(() => assertSafePublicFile('functions/src/services/client-service.js'), /Non-public/);
  assertSafePublicFile('functions/src/shared/online-order.js');
});
test('duplicate manifest paths fail before any output is written', () => {
  const outDir = path.join(fixture, 'duplicate-output');
  assert.throws(() => buildPublicSite({root: fixture, outDir, manifest: {...manifest, files: [...manifest.files, 'index.html']}}), /Duplicate/);
  assert.equal(fs.existsSync(outDir), false);
});
test('missing dependencies fail closed', () => {
  const files = new Map(manifest.files.map(file => [file, fs.readFileSync(path.join(root, file))]));
  files.delete('js/firebase/financial-space-service.js');
  assert.throws(() => assertReferencesIncluded(files), /Missing public dependency/);
});
test('symlinked source cannot escape the allowlist', () => {
  const linkedRoot = path.join(fixture, 'linked-source');
  fs.mkdirSync(linkedRoot);
  fs.symlinkSync(path.join(fixture, 'js'), path.join(linkedRoot, 'js'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildPublicSite({root: linkedRoot, manifest: {...manifest, files: ['js/app.js']}}), /Symlink rejected/);
});
for (const resource of ['/js/kyteData.js', '/js/kyteBalances.js', '/js/saldoCorrecoes.js', '/js/kyteData.js?cache=old', '/js/kyte%44ata.js', '/js/kyteBootstrap.js', '/js/cleanupDemo.js', '/js/financeMigration.js', '/tests/private.json', '/tests/fixtures/client-actions-harness.html', '/tests/mobile-home-clients-polish.fixture.html', '/.git/config', '/diagnostic.json', '/functions/src/private.js']) {
  test('anonymous retired/private resource is unavailable: ' + resource, async () => {
    const response = await fetch(origin + resource);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE_SENTINEL|KYTE_(?:CLIENTS|BALANCES)/);
  });
}
test('anonymous operational resources remain accessible, including lazy modules, receipt CSS, worker and catalog', async () => {
  for (const resource of ['/index.html', '/catalogo.html', '/404.html', '/manifest.json', '/service-worker.js', '/js/firebase/auth.js', '/js/firebase/sync.js', '/js/sale-exchanges.js', '/js/fiados.js', '/css/receipt.css', '/js/product-spreadsheet-worker.js', '/functions/src/shared/online-order.js', '/assets/veconi-icon-192-v133.png']) assert.equal((await fetch(origin + resource)).status, 200, resource);
  assert.match(await (await fetch(origin + '/js/build-info.js')).text(), /release: "209"/);
});
