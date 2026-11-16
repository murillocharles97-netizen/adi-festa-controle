#!/usr/bin/env node
'use strict';
// Read-only: reproduces the "firebase-functions-hash" label that firebase-tools
// writes on each deployed Function, so a local source directory can be matched
// to what is actually live (firebase functions:list --json → labels).
// Algorithm (firebase-tools lib/deploy/functions/prepareFunctionsUpload.js + cache/hash.js):
//   sourceHash = sha1( sorted(sha1(file bytes) for every packaged file).join('') )
//   endpoint   = sha1( sourceHash + sha1(JSON(env vars)) + sha1(JSON(secret versions)) )
// Usage: node scripts/functions-deploy-hash.cjs <functions-dir> [--project adi-festa-controle] [--expect <hash>]
// Prints only hashes; never reads secrets' values, never deploys.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const IGNORE = new Set(['node_modules', '.git', 'test', 'firebase-debug.log']);

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name) || /^firebase-debug\..*\.log$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, out); else if (entry.isFile()) out.push(full);
  }
  return out;
}
function sourceHash(dir) { return sha1(files(dir).map((f) => sha1(fs.readFileSync(f))).sort().join('')); }
function dotenv(file) {
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
function candidates(dir, project) {
  const fromFiles = { ...dotenv(path.join(dir, '.env')), ...dotenv(path.join(dir, `.env.${project}`)) };
  const firebase = { FIREBASE_CONFIG: JSON.stringify({ projectId: project, storageBucket: `${project}.firebasestorage.app` }), GCLOUD_PROJECT: project };
  return {
    'env do arquivo': fromFiles,
    'env + FIREBASE_CONFIG/GCLOUD_PROJECT': { ...fromFiles, ...firebase },
    'FIREBASE_CONFIG/GCLOUD_PROJECT + env': { ...firebase, ...fromFiles },
  };
}
function endpointHashes(dir, project) {
  const src = sourceHash(dir), secrets = sha1(JSON.stringify({}));
  return Object.fromEntries(Object.entries(candidates(dir, project)).map(([name, env]) => [name, sha1(src + sha1(JSON.stringify(env)) + secrets)]));
}
module.exports = { sourceHash, endpointHashes };
if (require.main === module) {
  const args = process.argv.slice(2), dir = path.resolve(args.find((a) => !a.startsWith('--')) || 'functions');
  const project = args[args.indexOf('--project') + 1] && args.includes('--project') ? args[args.indexOf('--project') + 1] : 'adi-festa-controle';
  const expect = args.includes('--expect') ? args[args.indexOf('--expect') + 1] : null;
  const hashes = endpointHashes(dir, project);
  console.log(`source ${sourceHash(dir)}  (${files(dir).length} arquivos)`);
  for (const [name, hash] of Object.entries(hashes)) console.log(`${hash}  ${name}${expect && hash === expect ? '  <== IGUAL AO PUBLICADO' : ''}`);
  if (expect) process.exitCode = Object.values(hashes).includes(expect) ? 0 : 1;
}
