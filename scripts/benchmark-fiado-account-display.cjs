'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {readFileSync} = require('node:fs');
const {performance} = require('node:perf_hooks');
const vm = require('node:vm');

const base = process.argv[2] || 'f84d34f';
const scripts = {
  previous: execFileSync('git', ['show', base + ':js/clientes.js'], {encoding: 'utf8'}),
  next: readFileSync('js/clientes.js', 'utf8')
};
const storeSource = readFileSync('js/customer-space-accounts.js', 'utf8');
const day = '2026-10-20', company = 'qa-company', space = 'qa-space';

function fixture(size) {
  const clients = Array.from({length: size}, (_, n) => ({id: 'qa-' + n, financialVersion: 2, saldo: -60, customerSpaceIds: [space],
    fiadoHistoryActivation: {spaceRegularization: {version: 1}}}));
  const dues = [{dueDate: '2026-10-01', remainingCents: 4000, spaceId: space},
    {dueDate: '2026-11-01', remainingCents: 2000, spaceId: space}];
  const data = {clientes: clients, vendas: clients.flatMap(client => Array.from({length: 8}, (_, i) => ({
    id: client.id + '-' + i, clienteId: client.id, spaceId: space, formaPagamento: i === 0 ? 'fiado' : 'dinheiro',
    status: i === 0 ? 'fiado' : 'pago', ...(i === 0 ? {installmentPlan: {}} : {})
  })))};
  return {clients, dues, data};
}

function load(source, state, enabled) {
  const context = {
    DB: {readForView: () => state.data, getBusinessId: () => company, getWorkspaceGeneration: () => 0},
    SpaceContext: {activeId: () => space, homeSpaces: () => [{id: space}], scopesCustomers: () => true},
    Router: {atual: () => 'clientes'},
    BusinessContext: {get: () => ({role: 'owner', businessId: company})},
    TeamAccess: {has: () => true},
    addEventListener() {},
    InstallmentPlan: {today: () => day, rows: () => state.dues},
    InstallmentCredit: {displayAccount: () => ({creditCents: 0, totalCents: 6000, dueCents: 4000, futureCents: 2000, entries: state.dues})},
    SyncFirebase: {confirmedClientFinancialVersion: client => client.financialVersion}
  };
  context.window = context;
  vm.createContext(context);
  if (enabled) {
    vm.runInContext(storeSource, context);
    context.CustomerSpaceAccounts.reset({uid: 'qa-owner', businessId: company, complete: true});
    context.CustomerSpaceAccounts.apply(company, state.clients.map(client => ({type: 'added', id: client.id + '__' + space,
      data: {businessId: company, workspaceGeneration: 0, clientId: client.id, spaceId: space, debtCents: 6000, financialVersion: 2}})));
  }
  vm.runInContext(source, context);
  return context.Clientes;
}

function timeList(module, clients, reset) {
  if (reset) module.prepareList();
  let checksum = 0;
  const start = performance.now();
  for (const client of clients) {
    const result = module.listFinancialStatus(client, {display: true});
    checksum += result.debt * 100 + result.futureCents;
  }
  const ms = performance.now() - start;
  assert.equal(checksum, clients.length * 6000);
  return ms;
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b).map(t => Number(t.toFixed(3)));
  return {min: sorted[0], median: sorted[sorted.length >> 1], max: sorted.at(-1)};
}

for (const size of [138, 1000]) {
  const state = fixture(size);
  const versions = [load(scripts.previous, state, false), load(scripts.next, state, true)];
  const samples = versions.map(() => ({cold: [], warm: []}));
  for (let trial = -3; trial < 15; trial++) {
    for (const index of trial % 2 ? [1, 0] : [0, 1]) {
      const cold = timeList(versions[index], state.clients, true), warm = timeList(versions[index], state.clients, false);
      if (trial >= 0) { samples[index].cold.push(cold); samples[index].warm.push(warm); }
    }
  }
  console.log(JSON.stringify({clients: size, sales: state.data.vendas.length, runs: 15, base,
    v24212: {coldMs: summarize(samples[0].cold), warmMs: summarize(samples[0].warm)},
    v24213: {coldMs: summarize(samples[1].cold), warmMs: summarize(samples[1].warm)}}));
}
