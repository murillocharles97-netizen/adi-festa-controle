'use strict';
// Fase 2 — identificação das versões. Reusable: compares the current sources,
// so a release that bumps one place and forgets another fails here.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function build() {
  const c = { window: {}, document: { querySelector: () => null, lastModified: '01/01/2026 00:00:00' }, console: { info() {} } };
  vm.createContext(c); vm.runInContext(read('js/build-info.js'), c);
  return c.window.AdiFestaBuild;
}

test('versão do app é única: release inteiro derivado dela e igual no Service Worker', () => {
  const b = build();
  assert.match(b.appVersion, /^\d{3}(?:\.\d+)?$/);
  assert.equal(b.release, b.appVersion.split('.')[0]);
  assert.ok(Number.isInteger(Number(b.release)) && Number(b.release) >= 227, 'o servidor publicado exige clientRelease inteiro >= 202 e usa >= 227 para contratos atuais');
  const worker = read('service-worker.js');
  assert.match(worker, new RegExp(`postMessage\\(\\{cache: CACHE, release: '${b.release}', appVersion: '${b.appVersion.replace('.', '\\.')}'\\}\\)`));
  assert.match(worker, new RegExp(`const CACHE='veconi-v${b.appVersion.replace('.', '')}-`), 'o nome do cache acompanha a versão do app');
});

test('o app mostra a versão real ao usuário e no diagnóstico', () => {
  assert.match(read('js/mobile-navigation.js'), /const version = window\.AdiFestaBuild\?\.appVersion \|\| window\.AdiFestaBuild\?\.release \|\| "1\.0\.0";/);
  assert.match(read('js/firebase/firebase-ui.js'), /<dt>Versão do app<\/dt><dd>\$\{escape\(build\.appVersion\|\|build\.release\|\|'—'\)\}<\/dd>/);
});

test('protocolo e formato continuam fixos; pacotes novos registram a versão que os criou', () => {
  const sync = read('js/firebase/sync.js');
  assert.match(sync, /PAYLOAD_VERSION = 4,/);
  const creation = sync.slice(sync.indexOf('      payloadVersion: PAYLOAD_VERSION,\n      syncProtocolVersion: 1,'), sync.indexOf('    queued.subtype = queueSubtype(queued);'));
  assert.match(creation, /syncProtocolVersion: 1,\n\s+clientRelease: 202,\n\s+createdByAppVersion: String\(window\.AdiFestaBuild\?\.appVersion \|\| window\.AdiFestaBuild\?\.release \|\| ""\),\n\s+createdByRelease: Number\(window\.AdiFestaBuild\?\.release\) \|\| null,/);
  assert.match(creation, /schemaVersion: 3,/);
  // Never rewritten retroactively: the fields are assigned ONLY at creation.
  assert.equal((sync.match(/createdByAppVersion/g) || []).length, 1);
  assert.equal((sync.match(/createdByRelease/g) || []).length, 1);
  assert.doesNotMatch(sync, /clientRelease\s*=\s*/);
});

test('o envio informa a versão do app sem mudar o contrato aceito pelas Functions publicadas', () => {
  const sync = read('js/firebase/sync.js');
  assert.match(sync, /syncProtocolVersion:1,clientRelease:Number\(window\.AdiFestaBuild\?\.release\)\|\|202,\n\s+appVersion:String\(window\.AdiFestaBuild\?\.appVersion\|\|""\),/);
  // The deployed boundary only checks protocol 1 + integer clientRelease >= 202.
  const callable = read('functions/src/shared/operational-callable.js');
  assert.match(callable, /request\.data\?\.syncProtocolVersion!==1\|\|!Number\.isInteger\(request\.data\?\.clientRelease\)\|\|request\.data\.clientRelease<202/);
  const b = build();
  assert.ok(Number.isInteger(Number(b.release)) && Number(b.release) >= 202);
  // appVersion is sent ONLY to commitOperationalSync (other callables have strict key lists).
  assert.equal((sync.match(/appVersion:String\(window\.AdiFestaBuild/g) || []).length, 1);
});

test('verificação de release: bloqueia versão não atualizada e aceita a próxima', () => {
  const { check, newer } = require('../scripts/release-version-check.cjs');
  const local = read('js/build-info.js'), worker = read('service-worker.js'), sync = read('js/firebase/sync.js');
  const published229 = 'window.AdiFestaBuild=Object.freeze({release:"229"});';
  assert.equal(check({ local, worker, sync, published: published229 }).ok, true, 'atual 231.1 é posterior à 229 publicada');
  const same = check({ local, worker, sync, published: local });
  assert.equal(same.ok, false); assert.match(same.problems.join(), /não é posterior à publicada/);
  const forgotWorker = check({ local, worker: worker.replace("release: '231', appVersion: '231.1'", "release: '231', appVersion: '231.0'"), sync, published: published229 });
  assert.match(forgotWorker.problems.join(), /Service Worker informa outra versão/);
  const protocol = check({ local, worker, sync: sync.replace('PAYLOAD_VERSION = 4,', 'PAYLOAD_VERSION = 5,'), published: published229 });
  assert.match(protocol.problems.join(), /PAYLOAD_VERSION mudou/);
  assert.equal(check({ local, worker, sync: sync.replace('PAYLOAD_VERSION = 4,', 'PAYLOAD_VERSION = 5,'), published: published229, protocolChange: true }).ok, true);
  assert.equal(newer('232', '231.1'), true); assert.equal(newer('231.1', '231.1'), false); assert.equal(newer('231.2', '231.10'), false);
});
