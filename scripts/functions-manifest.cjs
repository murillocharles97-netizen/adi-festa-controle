#!/usr/bin/env node
'use strict';
// Fase 3 — controle de publicação das Cloud Functions. READ-ONLY toward production.
//
//   snapshot [--project P] [--out functions-deploy-manifest.json] [--live-json file]
//       Records what is published: per Function the firebase-functions-hash label,
//       upload time of the source, runtime and limits (from `firebase functions:list --json`).
//
//   verify <candidate-functions-dir> --only fnA[,fnB] --base <dir> --changes <changes.json>
//          [--manifest functions-deploy-manifest.json] [--live-json file] [--project P]
//       Pre-deploy gate. Blocks (exit 1) when:
//         1. production changed since the manifest (live hash ≠ manifest hash);
//         2. the base directory does not reproduce the LIVE hash (old/stale package);
//         3. the candidate changes files not declared in changes.json;
//         4. a declared change is missing from the candidate;
//         5. commitOperationalSync has a rejection without a stable reason (Fase 1).
//       On success prints an approval token = candidate hash, valid only for that content.
//
// Never deploys, never writes to production, never reads secret values.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { endpointHashes } = require('./functions-deploy-hash.cjs');
const { compare } = require('./functions-source-diff.cjs');

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
function liveFunctions(project, file) {
  const raw = file ? fs.readFileSync(file, 'utf8')
    : execFileSync(process.platform === 'win32' ? 'firebase.cmd' : 'firebase', ['functions:list', '--project', project, '--json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 << 20 });
  const parsed = JSON.parse(raw), list = parsed.result || parsed;
  if (!Array.isArray(list)) throw Error('functions:list não retornou uma lista.');
  return Object.fromEntries(list.map((f) => [f.id, {
    hash: f.labels?.['firebase-functions-hash'] || f.hash || null,
    sourceUploadedAt: f.source?.storageSource?.generation ? new Date(Number(f.source.storageSource.generation) / 1000).toISOString() : null,
    runtime: f.runtime, region: f.region, memoryMb: f.availableMemoryMb, timeoutSeconds: f.timeoutSeconds,
    maxInstances: f.maxInstances, state: f.state, platform: f.platform,
  }]));
}

function snapshot() {
  const project = arg('--project', 'adi-festa-controle'), out = arg('--out', 'functions-deploy-manifest.json');
  const live = liveFunctions(project, arg('--live-json'));
  const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { functions: {} };
  const functions = Object.fromEntries(Object.entries(live).sort().map(([name, info]) => [name, {
    ...info, origin: previous.functions?.[name]?.hash === info.hash ? previous.functions[name].origin || null : null,
    revision: previous.functions?.[name]?.hash === info.hash ? previous.functions[name].revision || null : null,
  }]));
  const manifest = { schemaVersion: 1, project, capturedAt: new Date().toISOString(), functions };
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Manifesto gravado: ${out} (${Object.keys(functions).length} Functions).`);
}

function rejectionCoverage(candidate) {
  const service = path.join(candidate, 'src/services/operational-commit-service.js');
  const table = path.join(candidate, 'src/shared/sync-rejection.js');
  if (!fs.existsSync(service) || !fs.existsSync(table)) return { checked: false, missing: [] };
  const Rejection = require(path.resolve(table));
  const missing = [...fs.readFileSync(service, 'utf8').matchAll(/fail\('((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1]).filter((m) => Rejection.classify(m).reason === 'unclassified');
  return { checked: true, missing };
}

function verify() {
  const candidate = path.resolve(process.argv[3] || '');
  const only = String(arg('--only', '')).split(',').filter(Boolean), base = arg('--base'), changesFile = arg('--changes');
  const project = arg('--project', 'adi-festa-controle'), manifestFile = arg('--manifest', 'functions-deploy-manifest.json');
  const problems = [];
  if (!fs.existsSync(path.join(candidate, 'package.json'))) problems.push(`Candidato inválido: ${candidate}`);
  if (!only.length) problems.push('Informe --only com as Functions a publicar.');
  if (!base) problems.push('Informe --base: o diretório que reproduz o código publicado agora.');
  if (!changesFile) problems.push('Informe --changes: a lista revisada de arquivos alterados.');
  if (problems.length) return finish(problems);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')), live = liveFunctions(project, arg('--live-json'));
  const baseHashes = Object.values(endpointHashes(path.resolve(base), project));
  for (const name of only) {
    const now = live[name], recorded = manifest.functions?.[name];
    if (!now) { problems.push(`${name}: não existe em produção (publicação nova exige aprovação explícita).`); continue; }
    if (!recorded || recorded.hash !== now.hash)
      problems.push(`${name}: produção mudou desde o manifesto (${recorded?.hash?.slice(0, 8) || '—'} → ${now.hash?.slice(0, 8)}). Atualize o manifesto e refaça a base.`);
    if (!baseHashes.includes(now.hash))
      problems.push(`${name}: a base NÃO reproduz o código publicado (${now.hash?.slice(0, 8)}). Pacote antigo ou diferente — publicação bloqueada.`);
  }
  const declared = JSON.parse(fs.readFileSync(changesFile, 'utf8'));
  const allowed = new Set([...(declared.modified || []), ...(declared.added || []), ...(declared.removed || [])]);
  const { result } = compare(candidate, path.resolve(base));
  const changed = [...result.different, ...result.onlyLive.map((f) => f), ...result.onlyRepo];
  // compare(live=candidate, repo=base): onlyLive = added in candidate, onlyRepo = removed from base.
  for (const file of changed) if (!allowed.has(file)) problems.push(`Alteração não declarada: ${file}`);
  for (const file of allowed) if (!changed.includes(file)) problems.push(`Alteração declarada mas ausente no candidato: ${file}`);
  if (only.includes('commitOperationalSync')) {
    const coverage = rejectionCoverage(candidate);
    if (coverage.checked && coverage.missing.length) problems.push(`Recusas sem motivo estável: ${coverage.missing.join(' | ')}`);
  }
  const token = Object.values(endpointHashes(candidate, project))[1];
  return finish(problems, { changed, token });
}

function finish(problems, info = {}) {
  if (problems.length) {
    console.error('PUBLICAÇÃO BLOQUEADA:');
    for (const p of problems) console.error('  - ' + p);
    process.exitCode = 1;
    return { ok: false, problems };
  }
  console.log(`OK. Alterações conferidas: ${info.changed.length}.`);
  console.log(`Token de aprovação (hash esperado após a publicação): ${info.token}`);
  return { ok: true, ...info };
}

module.exports = { liveFunctions, rejectionCoverage };
if (require.main === module) {
  const command = process.argv[2];
  if (command === 'snapshot') snapshot();
  else if (command === 'verify') verify();
  else { console.log('Uso: node scripts/functions-manifest.cjs snapshot | verify <dir> --only fn --base <dir> --changes <json>'); process.exitCode = 2; }
}
