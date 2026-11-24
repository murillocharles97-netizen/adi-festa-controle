'use strict';
// Exportação no PWA Android: o arquivo precisa sair de verdade, e a mensagem
// precisa dizer o que aconteceu (compartilhado, cancelado, baixado ou falhou).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

const source = fs.readFileSync('js/export-center.js', 'utf8');
function browser({share = 'ok', canShare = true, clipboard = 'ok', download = true, execCommand = true} = {}) {
  const events = [], timers = [], body = {children: [], appendChild(node) { this.children.push(node); node.parentNode = this; events.push(['append', node.tag]); }};
  const element = tag => {
    const node = {tag, style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, remove() { body.children = body.children.filter(n => n !== this); events.push(['remove', tag]); },
      click() { events.push(['click', this.download, this.parentNode === body, this.href]); }, select() {}};
    if (tag === 'a' && download) node.download = '';
    return node;
  };
  const revoked = [];
  const window = {
    navigator: {
      ...(canShare !== null ? {canShare: () => canShare, share: async (data) => { events.push(['share', data.files[0].name]); if (share === 'abort') throw Object.assign(Error('cancel'), {name: 'AbortError'}); if (share === 'fail') throw Object.assign(Error('Permission denied'), {name: 'NotAllowedError'}); }} : {}),
      clipboard: {writeText: async (value) => { if (clipboard !== 'ok') throw Error('denied'); events.push(['clipboard', value.length]); }},
    },
    document: {body, createElement: element, execCommand: () => { events.push(['execCommand']); return execCommand; }},
    Blob: class { constructor(parts, opts) { this.size = parts.join('').length; this.type = opts.type; } },
    File: class { constructor(parts, name, opts) { this.name = name; this.size = parts.join('').length; this.type = opts.type; } },
    URL: {createObjectURL: () => 'blob:qa-1', revokeObjectURL: url => revoked.push(url)},
    setTimeout: (fn, ms) => { timers.push(ms); return 1; },
    matchMedia: () => ({matches: true}),
  };
  const context = vm.createContext({window, JSON, Error, Promise, Math, Boolean, Object, Array, String});
  vm.runInContext(source, context);
  return {api: window.VeconiExport, events, timers, revoked, body};
}

test('reprodução: o download publicado usa link fora da página e revoga em 1 s', () => {
  const published = execFileSync('git', ['show', '2c9312602ff58263a0bf55f4aa45b3a890ef82e8:js/firebase/sync.js'], {encoding: 'utf8', maxBuffer: 64 << 20});
  const body = published.slice(published.indexOf('function downloadJsonFile('), published.indexOf('function automaticRecoveryBackup('));
  assert.doesNotMatch(body, /appendChild/);
  assert.match(body, /revokeObjectURL\(url\), 1000/);
});

test('download fica na página, dura 60 s e informa nome e tamanho, sem afirmar conclusão', () => {
  const b = browser(), result = b.api.download({a: 1}, 'diagnostico.json');
  assert.equal(result.ok, true); assert.equal(result.confirmed, false);
  assert.deepEqual(b.events.find(e => e[0] === 'click').slice(0, 3), ['click', 'diagnostico.json', true]);
  assert.deepEqual(b.timers, [60000]);
  assert.match(result.message, /diagnostico\.json \(\d+ KB\).*Downloads/);
});

test('compartilhar entrega o arquivo e confirma; cancelar não é tratado como sucesso', async () => {
  const ok = await browser().api.deliver({content: {a: 1}, filename: 'd.json', mode: 'share'});
  assert.equal(ok.ok, true); assert.equal(ok.method, 'share'); assert.equal(ok.confirmed, true);
  const cancelled = await browser({share: 'abort'}).api.deliver({content: {a: 1}, filename: 'd.json', mode: 'share'});
  assert.equal(cancelled.ok, false); assert.equal(cancelled.cancelled, true);
  assert.match(cancelled.message, /cancelado/);
});

test('compartilhamento indisponível ou com erro cai para o download, avisando', async () => {
  const unsupported = browser({canShare: false}), r1 = await unsupported.api.deliver({content: 'x', filename: 'd.json', mode: 'share'});
  assert.equal(r1.ok, true); assert.equal(r1.method, 'download'); assert.equal(r1.fallbackFrom, 'share');
  assert.match(r1.message, /não está disponível.*Download/);
  const failing = browser({share: 'fail'}), r2 = await failing.api.deliver({content: 'x', filename: 'd.json', mode: 'share'});
  assert.equal(r2.method, 'download'); assert.match(r2.message, /falhou/);
});

test('sem compartilhamento e sem download, o erro é real e explica as duas tentativas', async () => {
  const b = browser({canShare: null, download: false}), result = await b.api.deliver({content: 'x', filename: 'd.json', mode: 'share'});
  assert.equal(result.ok, false); assert.equal(result.attempts.length, 2);
  assert.match(result.message, /Não foi possível baixar/);
});

test('copiar confirma; sem área de transferência tenta execCommand e depois cópia manual', async () => {
  const ok = await browser().api.copy('resumo');
  assert.equal(ok.ok, true); assert.equal(ok.method, 'copy');
  const fallback = await browser({clipboard: 'fail'}).api.copy('resumo');
  assert.equal(fallback.ok, true);
  const manual = await browser({clipboard: 'fail', execCommand: false}).api.copy('resumo');
  assert.equal(manual.ok, false); assert.equal(manual.manual, true); assert.equal(manual.content, 'resumo');
});

test('todos os downloads de arquivo do app usam a entrega confiável', () => {
  // js/firebase/auth.js is frozen below the invite flow by tests/login-redesign-v203.test.cjs;
  // its login-screen backup keeps the old download until that freeze is reviewed.
  const files = ['js/firebase/sync.js', 'js/app.js', 'js/sale-recovery-ui.js', 'js/recibos.js', 'js/installment-credit.js'];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /revokeObjectURL\(url\),\s*1000/, `${file} ainda revoga em 1 s`);
    for (const m of text.matchAll(/(\w+)\.download\s*=[^;]+;/g)) {
      const after = text.slice(m.index, m.index + 400), name = m[1];
      if (/^(link|a|anchor)$/.test(name)) assert.match(after, new RegExp(`(appendChild|append)\\(${name}\\)`), `${file}: ${name} precisa estar na página`);
    }
  }
});
