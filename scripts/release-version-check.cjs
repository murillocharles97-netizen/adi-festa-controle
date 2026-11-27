#!/usr/bin/env node
'use strict';
// Fase 2/3 — a release do frontend precisa se identificar corretamente.
// Usage: node scripts/release-version-check.cjs [--published <build-info.js file or URL>]
// Default: reads the public https://veconi.app.br/js/build-info.js (read-only; no user data).
// Blocks (exit 1) when:
//   - appVersion is not "NNN", "NNN.N" or "NNN.N.N"; release ≠ integer major of appVersion;
//   - the service worker does not report the same release/appVersion, or its CACHE
//     name does not carry the appVersion;
//   - appVersion is not newer than the published one (a release that forgot to bump);
//   - the sync protocol / operation format changed together with the app version
//     (they are independent and must change only on purpose: --protocol-change).
const fs = require('fs'), vm = require('vm');

function readBuild(source) {
  const c = { window: {}, document: { querySelector: () => null, lastModified: '01/01/2026 00:00:00' }, console: { info() {} } };
  vm.createContext(c); vm.runInContext(source, c);
  return c.window.AdiFestaBuild || {};
}
const parse = (v) => String(v || '').split('.').map(Number);
function newer(a, b) { const x = parse(a), y = parse(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }

function check({ local, worker, sync, published, protocolChange = false }) {
  const problems = [], b = readBuild(local);
  if (!/^\d{3}(?:\.\d+){0,2}$/.test(String(b.appVersion || ''))) problems.push(`appVersion inválida: ${b.appVersion}`);
  if (String(b.release) !== String(b.appVersion || '').split('.')[0]) problems.push(`release (${b.release}) ≠ versão principal de appVersion (${b.appVersion}).`);
  if (!worker.includes(`release: '${b.release}', appVersion: '${b.appVersion}'`)) problems.push('O Service Worker informa outra versão (GET_VERSION).');
  if (!worker.includes(`const CACHE='veconi-v${String(b.appVersion).replaceAll('.', '')}-`)) problems.push('O nome do cache do Service Worker não acompanha a versão do app.');
  if (published) {
    const p = readBuild(published), publishedVersion = p.appVersion || p.release;
    if (!newer(b.appVersion, publishedVersion)) problems.push(`appVersion ${b.appVersion} não é posterior à publicada (${publishedVersion}). Atualize a versão antes de publicar.`);
  }
  if (!protocolChange) {
    if (!/syncProtocolVersion: 1,\r?\n\s+clientRelease: 202,/.test(sync)) problems.push('Protocolo/formato dos pacotes mudou junto com a release. Use --protocol-change só se for intencional.');
    if (!/PAYLOAD_VERSION = 4,/.test(sync)) problems.push('PAYLOAD_VERSION mudou. Use --protocol-change só se for intencional.');
  }
  return { ok: !problems.length, problems, appVersion: b.appVersion, release: b.release };
}
module.exports = { check, newer, readBuild };

if (require.main === module) (async () => {
  const at = process.argv.indexOf('--published'), target = at > 0 ? process.argv[at + 1] : 'https://veconi.app.br/js/build-info.js';
  let published = null;
  try { published = /^https?:/.test(target) ? await (await fetch(target, { headers: { 'User-Agent': 'release-version-check' } })).text() : fs.readFileSync(target, 'utf8'); }
  catch (error) { console.error(`Não foi possível ler a versão publicada (${error.message}).`); process.exitCode = 1; return; }
  const result = check({ local: fs.readFileSync('js/build-info.js', 'utf8'), worker: fs.readFileSync('service-worker.js', 'utf8'),
    sync: fs.readFileSync('js/firebase/sync.js', 'utf8'), published, protocolChange: process.argv.includes('--protocol-change') });
  if (result.ok) console.log(`OK: versão ${result.appVersion} (compatibilidade ${result.release}).`);
  else { console.error('RELEASE BLOQUEADA:'); for (const p of result.problems) console.error('  - ' + p); process.exitCode = 1; }
})();
