#!/usr/bin/env node
'use strict';
// Read-only: compares two Functions source trees (e.g. the repository and the
// package that was actually deployed) by normalized content hash (CRLF→LF).
// Usage: node scripts/functions-source-diff.cjs <live-functions-dir> [repo-functions-dir] [--json]
// Never writes, never deploys. Output contains only file paths and hashes.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function hashTree(root, base = root, out = {}) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name) || entry.name.startsWith('.env') || entry.name.startsWith('.secret')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) hashTree(full, base, out);
    else if (/\.(c?js|json)$/.test(entry.name))
      out[path.relative(base, full).split(path.sep).join('/')] = crypto.createHash('sha256')
        .update(fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  }
  return out;
}

function compare(liveDir, repoDir) {
  const live = hashTree(liveDir), repo = hashTree(repoDir);
  const result = { same: [], different: [], onlyLive: [], onlyRepo: [] };
  for (const file of [...new Set([...Object.keys(live), ...Object.keys(repo)])].sort()) {
    if (!repo[file]) result.onlyLive.push(file);
    else if (!live[file]) result.onlyRepo.push(file);
    else (live[file] === repo[file] ? result.same : result.different).push(file);
  }
  return { result, live, repo };
}

module.exports = { hashTree, compare };

if (require.main === module) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!args[0]) { console.error('Uso: node scripts/functions-source-diff.cjs <pasta-functions-publicada> [pasta-functions-repo] [--json]'); process.exit(2); }
  const { result } = compare(path.resolve(args[0]), path.resolve(args[1] || path.join(__dirname, '..', 'functions')));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 1));
  else {
    console.log(`Iguais: ${result.same.length}`);
    for (const key of ['different', 'onlyLive', 'onlyRepo']) {
      console.log(`${{ different: 'Diferentes', onlyLive: 'Só no publicado', onlyRepo: 'Só no repositório' }[key]}: ${result[key].length}`);
      for (const file of result[key]) console.log(`  ${file}`);
    }
  }
  process.exitCode = result.different.length || result.onlyLive.length || result.onlyRepo.length ? 1 : 0;
}
