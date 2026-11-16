'use strict';
// Fase 3 — verificação pré-deploy. Synthetic Functions trees + a fake functions:list;
// never touches production.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { endpointHashes, sourceHash } = require('../scripts/functions-deploy-hash.cjs');
const SCRIPT = path.resolve('scripts/functions-manifest.cjs');

function tree(root, files) {
  for (const [name, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body); }
  return root;
}
const rejection = fs.readFileSync('functions/src/shared/sync-rejection.js', 'utf8');
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veconi-gate-'));
  const files = { 'package.json': '{"name":"f","main":"src/index.js"}', '.env.adi-festa-controle': 'A=1\n', 'src/index.js': 'exports.x=1;\n',
    'src/services/operational-commit-service.js': "const fail=()=>{};fail('Estoque sem movimento autorizado.');\n", 'test/ignored.js': 'ignored' };
  const live = tree(path.join(dir, 'live'), files);
  const candidate = tree(path.join(dir, 'candidate'), { ...files, 'src/shared/sync-rejection.js': rejection,
    'src/services/operational-commit-service.js': "const fail=()=>{};fail('Estoque sem movimento autorizado.');fail('Valor inválido.');\n" });
  const stale = tree(path.join(dir, 'stale'), { ...files, 'src/index.js': 'exports.x=0;\n' });
  const liveHash = Object.values(endpointHashes(live, 'adi-festa-controle'))[1];
  const listing = (hash) => { const file = path.join(dir, `list-${hash.slice(0, 6)}.json`);
    fs.writeFileSync(file, JSON.stringify({ status: 'success', result: [{ id: 'commitOperationalSync', labels: { 'firebase-functions-hash': hash }, source: { storageSource: { generation: '1794770610542147' } } }] })); return file; };
  const manifest = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, functions: { commitOperationalSync: { hash: liveHash } } }));
  const changes = path.join(dir, 'changes.json');
  fs.writeFileSync(changes, JSON.stringify({ added: ['src/shared/sync-rejection.js'], modified: ['src/services/operational-commit-service.js'] }));
  const run = ({ base = live, cand = candidate, list = listing(liveHash), changesFile = changes } = {}) =>
    spawnSync(process.execPath, [SCRIPT, 'verify', cand, '--only', 'commitOperationalSync', '--base', base, '--changes', changesFile, '--manifest', manifest, '--live-json', list], { encoding: 'utf8' });
  return { dir, live, candidate, stale, liveHash, listing, run, changes };
}

test('hash de publicação: ignora node_modules/test e muda com qualquer byte', () => {
  const f = fixture(), before = sourceHash(f.live);
  fs.mkdirSync(path.join(f.live, 'node_modules')); fs.writeFileSync(path.join(f.live, 'node_modules', 'x.js'), 'x');
  fs.writeFileSync(path.join(f.live, 'test', 'ignored.js'), 'changed');
  assert.equal(sourceHash(f.live), before);
  fs.writeFileSync(path.join(f.live, 'src/index.js'), 'exports.x=1;\r\n');
  assert.notEqual(sourceHash(f.live), before, 'CRLF também conta: o publicado é byte a byte');
});

test('candidato sobre a base publicada e com alterações declaradas: aprovado com token', () => {
  const f = fixture(), r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Token de aprovação \(hash esperado após a publicação\): [0-9a-f]{40}/);
});

test('base antiga (pacote que não reproduz o publicado): bloqueado', () => {
  const f = fixture(), r = f.run({ base: f.stale });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a base NÃO reproduz o código publicado/);
});

test('produção mudou desde o manifesto: bloqueado', () => {
  const f = fixture(), r = f.run({ list: f.listing('f'.repeat(40)) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /produção mudou desde o manifesto/);
});

test('alteração não declarada (módulo defasado de carona): bloqueado', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.candidate, 'src/index.js'), 'exports.x=2;\n');
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Alteração não declarada: src\/index\.js/);
});

test('alteração declarada ausente: bloqueado', () => {
  const f = fixture();
  fs.writeFileSync(f.changes, JSON.stringify({ added: ['src/shared/sync-rejection.js'], modified: ['src/services/operational-commit-service.js', 'src/index.js'] }));
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /declarada mas ausente no candidato: src\/index\.js/);
});

test('commitOperationalSync com recusa sem motivo estável: bloqueado', () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.candidate, 'src/services/operational-commit-service.js'), "fail('Recusa nova sem motivo.');\n");
  const r = f.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Recusas sem motivo estável: Recusa nova sem motivo\./);
});

test('o manifesto versionado não contém variáveis de ambiente nem segredos', () => {
  const text = fs.readFileSync('functions-deploy-manifest.json', 'utf8'), m = JSON.parse(text);
  assert.ok(Object.keys(m.functions).length >= 100);
  assert.doesNotMatch(text, /APP_USR|MERCADO_PAGO|ACCESS_TOKEN|WEBHOOK_SECRET|environmentVariables|serviceAccount/);
  assert.match(m.functions.commitOperationalSync.hash, /^[0-9a-f]{40}$/);
  assert.equal(m.functions.commitOperationalSync.revision, 'commitoperationalsync-00019-xol');
});
