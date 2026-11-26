'use strict';
// Conta por Espaço — Fase 2: classificação da carga e regras de atribuição. Dados fictícios.
const test = require('node:test');
const assert = require('node:assert/strict');
const {STATUS, RULES, classify, sameAccount, validRules} = require('../functions/src/shared/customer-account-backfill');
const Account = require('../functions/src/shared/customer-account');

const base = {businessId: 'fx-shop', generation: 0, clientId: 'fx-client'};
const account = (spaces = {}, unattributed = 0, unexplained = 0) => {
  const debt = Object.values(spaces).reduce((n, v) => n + v, 0) + unattributed;
  return {...Account.empty(base), debtCents: debt, spaces, unattributedCents: unattributed, baseline: {source: 'test', cut: null, unexplainedCents: unexplained}};
};
const one = {customerSpaceIds: ['fx-a']}, two = {customerSpaceIds: ['fx-a', 'fx-b']};

test('saldo sem eventos que o expliquem sempre pede abertura, com qualquer regra', () => {
  const r = classify({account: account({}, 0, 19000), client: one, split: 'events', rules: Object.values(RULES), fallbackSpaceId: 'fx-a'});
  assert.equal(r.status, STATUS.NEEDS_OPENING); assert.deepEqual(r.rules, []);
});

test('sem saldo ou comprovada por Espaço: pronta sem regra', () => {
  assert.equal(classify({account: account(), client: two, split: 'events'}).status, STATUS.READY);
  const scoped = classify({account: account({'fx-a': 15000, 'fx-b': 7000}), client: two, split: 'scoped', rules: [RULES.ACCEPT_HISTORY_SPLIT]});
  assert.equal(scoped.status, STATUS.READY); assert.deepEqual(scoped.rules, [], 'regra não é aplicada quando não precisa');
});

test('dívida sem Espaço só ganha Espaço com regra aprovada', () => {
  const pending = classify({account: account({}, 8000), client: one, split: 'history_fifo'});
  assert.equal(pending.status, STATUS.NEEDS_ATTRIBUTION); assert.equal(pending.account.unattributedCents, 8000);
  const single = classify({account: account({}, 8000), client: one, split: 'history_fifo', rules: [RULES.SINGLE_LINKED_SPACE]});
  assert.equal(single.status, STATUS.READY_BY_RULE); assert.deepEqual(single.account.spaces, {'fx-a': 8000}); assert.deepEqual(single.rules, [RULES.SINGLE_LINKED_SPACE]);
});

test('Espaço único não vale para cliente de dois Espaços nem com dívida em outro', () => {
  assert.equal(classify({account: account({}, 5000), client: two, split: 'events', rules: [RULES.SINGLE_LINKED_SPACE]}).status, STATUS.NEEDS_ATTRIBUTION);
  assert.equal(classify({account: account({'fx-b': 2000}, 5000), client: one, split: 'events', rules: [RULES.SINGLE_LINKED_SPACE]}).status, STATUS.NEEDS_ATTRIBUTION);
  const fallback = classify({account: account({'fx-b': 2000}, 5000), client: two, split: 'events', rules: [RULES.FALLBACK_SPACE], fallbackSpaceId: 'fx-b'});
  assert.equal(fallback.status, STATUS.READY_BY_RULE); assert.deepEqual(fallback.account.spaces, {'fx-b': 7000});
});

test('divisão calculada entre Espaços numa conta antiga precisa ser aceita explicitamente', () => {
  const split = account({'fx-a': 3000, 'fx-b': 4000});
  assert.equal(classify({account: split, client: two, split: 'history_fifo'}).status, STATUS.NEEDS_ATTRIBUTION);
  assert.equal(classify({account: split, client: two, split: 'history_fifo', rules: [RULES.ACCEPT_HISTORY_SPLIT]}).status, STATUS.READY_BY_RULE);
  assert.equal(classify({account: split, client: two, split: 'events'}).status, STATUS.READY, 'soma dos eventos pelo próprio Espaço não é divisão calculada');
});

test('crédito sem Espaço segue as mesmas regras', () => {
  const r = classify({account: account({}, -5000), client: one, split: 'events', rules: [RULES.SINGLE_LINKED_SPACE]});
  assert.equal(r.status, STATUS.READY_BY_RULE); assert.deepEqual(r.account.spaces, {'fx-a': -5000}); assert.equal(r.account.debtCents, -5000);
});

test('regras válidas e comparação de contas', () => {
  assert.ok(validRules([])); assert.ok(validRules([RULES.SINGLE_LINKED_SPACE, RULES.FALLBACK_SPACE]));
  for (const bad of [null, ['inventada'], [RULES.FALLBACK_SPACE, RULES.FALLBACK_SPACE], 'x']) assert.equal(validRules(bad), false, JSON.stringify(bad));
  const a = {...account({'fx-a': 100}), status: STATUS.READY};
  assert.ok(sameAccount(a, {...a, updatedAt: 'outra hora', verification: {status: 'match'}}));
  assert.equal(sameAccount(a, {...a, spaces: {'fx-a': 200}}), false);
  assert.equal(sameAccount(a, {...a, status: STATUS.NEEDS_OPENING}), false);
  assert.equal(sameAccount(null, a), false);
});
