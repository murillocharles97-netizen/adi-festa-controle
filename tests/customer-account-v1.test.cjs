'use strict';
// Conta por Espaço (Fase 1, modo sombra): regras puras. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const Account = require('../functions/src/shared/customer-account');

const base = {businessId: 'fx-shop', generation: 0, clientId: 'fx-client'};
const event = (id, delta, extra = {}) => ({id, type: 'balance_adjustment', status: 'applied', businessId: 'fx-shop', workspaceGeneration: 0,
  customerId: 'fx-client', spaceId: 'fx-a', balanceDelta: delta, appliedAt: `2026-11-25T10:00:0${id.slice(-1)}.000Z`, ...extra});

test('cada evento soma ao Espaço de origem; sem Espaço vai para a parte não atribuída', () => {
  let a = Account.empty(base);
  a = Account.apply(a, event('e1', -150));
  a = Account.apply(a, event('e2', -70, {spaceId: 'fx-b'}));
  a = Account.apply(a, event('e3', 50));
  a = Account.apply(a, event('e4', -20, {spaceId: undefined}));
  assert.deepEqual(a.spaces, {'fx-a': 10000, 'fx-b': 7000});
  assert.equal(a.unattributedCents, 2000);
  assert.equal(a.debtCents, 19000);
  assert.equal(a.eventCount, 4);
  assert.deepEqual(a.lastEvent, {appliedAt: '2026-11-25T10:00:04.000Z', id: 'e4'});
});

test('a ordem de chegada dos eventos não muda o resultado', () => {
  const events = [event('e1', -150), event('e2', -70, {spaceId: 'fx-b'}), event('e3', 50), event('e4', 30, {spaceId: 'fx-b'})];
  const forward = events.reduce(Account.apply, Account.empty(base)), backward = [...events].reverse().reduce(Account.apply, Account.empty(base));
  for (const key of ['spaces', 'debtCents', 'unattributedCents', 'eventCount', 'lastEvent']) assert.deepEqual(backward[key], forward[key], key);
});

test('crédito é dívida negativa; um Espaço zerado sai da lista', () => {
  let a = Account.apply(Account.empty(base), event('e1', -20));
  a = Account.apply(a, event('e2', 50));
  assert.equal(a.debtCents, -3000);
  assert.deepEqual(a.spaces, {'fx-a': -3000});
  a = Account.apply(a, event('e3', -30));
  assert.deepEqual(a.spaces, {});
});

test('só valem eventos aplicados da mesma empresa e geração', () => {
  assert.ok(Account.applicable(event('e1', -1), base));
  for (const extra of [{status: 'pending'}, {status: 'conflict'}, {businessId: 'fx-other'}, {workspaceGeneration: 1}, {customerId: '', clientId: '', clienteId: ''}, {balanceDelta: 'x'}])
    assert.equal(Account.applicable(event('e1', -1, extra), base), false, JSON.stringify(extra));
});

test('a base a partir da projeção comprovada traz cada Espaço e o corte dos eventos', () => {
  const projection = {totalCents: 22000, creditCents: 0, entries: [{spaceId: 'fx-a', remainingCents: 15000}, {spaceId: 'fx-b', remainingCents: 4000}, {spaceId: 'fx-b', remainingCents: 3000}]};
  const events = [event('e1', -150), event('e2', -70, {spaceId: 'fx-b'}), event('e3', -1, {status: 'pending'})];
  const a = Account.fromProjection(projection, {...base, events, at: 'agora'});
  assert.deepEqual(a.spaces, {'fx-a': 15000, 'fx-b': 7000});
  assert.equal(a.debtCents, 22000);
  assert.equal(a.eventCount, 2);
  assert.deepEqual(a.baseline.cut, {appliedAt: '2026-11-25T10:00:02.000Z', id: 'e2'});
  assert.ok(Account.includedInBaseline(a, event('e2', -70)));
  assert.equal(Account.includedInBaseline(a, event('e4', -1)), false);
});

test('sem prova, a base soma os eventos e mostra o saldo que eles não explicam', () => {
  const a = Account.fromEvents([event('e1', -40), event('e2', -1, {businessId: 'fx-other'})], {...base, client: {saldo: -190}, at: 'agora', reason: 'sem prova'});
  assert.equal(a.debtCents, 4000);
  assert.equal(a.baseline.unexplainedCents, 15000);
  assert.equal(a.baseline.unprovableReason, 'sem prova');
  assert.equal(Account.compare(a, {client: {saldo: -190}, projection: null}).status, 'balance_only');
});

test('a verificação acusa saldo, total e Espaço divergentes; atribuição só informa', () => {
  const a = Account.apply(Account.apply(Account.empty(base), event('e1', -150)), event('e2', -70, {spaceId: 'fx-b'}));
  const scopedProjection = {totalCents: 22000, entries: [{spaceId: 'fx-a', remainingCents: 15000}, {spaceId: 'fx-b', remainingCents: 7000}]};
  assert.deepEqual(Account.compare(a, {client: {saldo: -220}, projection: scopedProjection, scoped: true}), {status: 'match', differences: []});
  const moved = {totalCents: 22000, entries: [{spaceId: 'fx-a', remainingCents: 22000}]};
  assert.equal(Account.compare(a, {client: {saldo: -220}, projection: moved, scoped: true}).status, 'mismatch');
  const fifo = Account.compare(a, {client: {saldo: -220}, projection: moved, scoped: false});
  assert.equal(fifo.status, 'match'); assert.ok(fifo.differences.every(d => d.kind === 'attribution'));
  const book = Account.compare(a, {client: {saldo: -200}, projection: scopedProjection, scoped: true});
  assert.equal(book.status, 'mismatch'); assert.deepEqual(book.differences[0], {kind: 'balance', account: 22000, expected: 20000});
});

test('Etapa 1: evento com horário em Timestamp e base em texto ISO têm a mesma chave', () => {
  const {Timestamp} = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');
  const iso = '2026-11-25T12:00:00.123Z', a = {...Account.empty(base), baseline: {cut: {appliedAt: iso, id: 'e2'}}};
  assert.equal(Account.includedInBaseline(a, {appliedAt: Timestamp.fromDate(new Date(iso)), id: 'e1'}), true, 'já está na base');
  assert.equal(Account.includedInBaseline(a, {appliedAt: Timestamp.fromDate(new Date('2026-11-25T12:00:01Z')), id: 'e3'}), false, 'evento novo');
  assert.equal(Account.includedInBaseline(a, {appliedAt: {seconds: Date.parse(iso) / 1000, nanoseconds: 0}, id: 'e0'}), true, 'Timestamp serializado');
  const applied = Account.apply(a, {...event('e9', -5), appliedAt: Timestamp.fromDate(new Date('2026-11-25T12:00:02Z'))});
  assert.equal(applied.lastEvent.appliedAt, '2026-11-25T12:00:02.000Z');
});
