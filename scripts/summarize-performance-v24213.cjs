'use strict';

const {out, save} = require('./performance-lab-helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  const file = path.join(out, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
}

function interval(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
  return [median,sorted[0],sorted.at(-1)].map(value => Math.round(value*10)/10);
}

function tasks(entries) {
  return entries?.reduce((n, entry) => n+Math.max(0,entry.ms-50),0);
}

function grouped(rows, keyOf) {
  const result = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

const runtime = read(process.env.PERF_RUNTIME_OUTPUT || 'v24213-runtime.json');
const startup = read(process.env.PERF_STARTUP_OUTPUT || 'v24213-startup.json');
const storage = read('v24213-storage.json');
const report = {runtime:{},startup:{}};
for (const [label, rows] of grouped(runtime,row => row.theme+'-'+row.volume)) {
  const validNavigations = rows.flatMap(row => row.navigations).filter(row => !row.error && !row.errors.length);
  const nav = Object.fromEntries([...grouped(validNavigations,row => row.route+'-'+row.visit)].map(([key,samples]) =>
    [key,{n:samples.length,ms:interval(samples.map(r=>r.ms)),script:interval(samples.map(r=>r.ScriptDurationMs)),
      layoutStyle:interval(samples.map(r=>r.LayoutDurationMs+r.RecalcStyleDurationMs)),
      tbt:interval(samples.map(r=>tasks(r.long))),long:interval(samples.map(r=>r.long.length)),nodes:interval(samples.map(r=>r.nodes)),
      chargeCards:interval(samples.map(r=>r.chargeCards)),heap:interval(samples.map(r=>r.heapUsedMB))}]));
  const each = get => interval(rows.map(get));
  const measuredStorage = storage.filter(r => r.theme+'-'+r.volume === label);
  const persisted = get => interval((measuredStorage.length ? measuredStorage : rows).map(r => get(r.persistence)));
  report.runtime[label] = {n:rows.length,counts:rows[0].counts,nav,
    storage:{n:measuredStorage.length || rows.length,ms:persisted(r=>r.oneChange.ms),sync:persisted(r=>r.oneChange.synchronousMs),
      transaction:persisted(r=>r.oneChange.transactions === 1 ? r.oneChange.storageMs : NaN),
      written:persisted(r=>r.oneChange.commit?.written),records:persisted(r=>r.oneChange.commit?.records),
      noChange:persisted(r=>r.noChange.ms),
      noChangeTransactions:persisted(r=>r.oneChange.transactions === 1 ? r.noChange.transactions : NaN),bytes:persisted(r=>r.bytes)},
    charge:{ms:each(r=>r.inspection.list.ms),checks:each(r=>r.inspection.list.checks),clients:each(r=>r.inspection.list.clients),
      memoized:each(r=>r.inspection.memoized.ms),memoizedChecks:each(r=>r.inspection.memoized.checks)},
    home:{renderMs:each(r=>r.inspection.dashboard.ms),checks:each(r=>r.inspection.dashboard.checks)},
    remote:Object.fromEntries([...grouped(rows.flatMap(r=>r.remote),r=>r.route)].map(([key,samples])=>[key,{
      ms:interval(samples.map(r=>r.ms)),remounts:interval(samples.map(r=>r.remounts)),
      rootReplaced:samples.filter(r=>r.previousRootReplaced).length,tbt:interval(samples.map(r=>tasks(r.long)))}])),
    cycles:rows.find(r=>r.repeated.length)?.repeated,
    cpu:rows.find(r=>Object.keys(r.profilesByOperation).length)?.profilesByOperation,
    errors:rows.flatMap(r=>r.errors),
  };
}

for (const [key, rows] of grouped(startup,r=>r.phase)) {
  const valid = rows.filter(r=>!r.fault);
  const browserTasks = r => {
    const phase = r.phase;
    const accumulated = ['cold-login-screen','warm-reload','offline-reload','resume-session'].includes(phase)
      ? r.nowMs : r.elapsedMs;
    return r.longTasks?.filter(t=>t.at>=r.nowMs-accumulated);
  };
  const each = get => interval(valid.map(get));
  report.startup[key] = {n:valid.length,ms:each(r=>r.elapsedMs),fcp:each(r=>r.fcpMs),
    cpu:each(r=>r.ScriptDurationMs),mainThread:each(r=>r.TaskDurationMs),long:each(r=>browserTasks(r)?.length),
    tbt:each(r=>tasks(browserTasks(r))),listeners:each(r=>r.usage?.activeListeners),network:each(r=>r.network?.length),
    resources:each(r=>r.resources),decoded:each(r=>r.decodedBytes),transferred:each(r=>r.transferBytes),
    states:[...new Set(valid.map(r=>r.bootstrap))],events:each(r=>r.events?.filter(e=>e.at>=r.nowMs-r.elapsedMs&&e.event==='firebase-sync-status').length),
    faults:rows.filter(r=>r.fault).map(r=>r.fault)};
}
save(process.env.PERF_SUMMARY_OUTPUT || 'v24213-summary.json',report);
