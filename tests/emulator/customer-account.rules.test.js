'use strict';
// Conta por Espaço, Fase 1 (modo sombra): nenhum aparelho lê ou grava a conta nem os
// marcadores de eventos aplicados; só o servidor. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
if (!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local Emulator required');
const {initializeTestEnvironment, assertFails} = require('@firebase/rules-unit-testing');
const {doc, getDoc, setDoc, updateDoc, deleteDoc} = require('firebase/firestore');
let env;
const bid = 'qa-customer-account', space = 'qa-customer-account-space';
const account = db => doc(db, 'businesses', bid, 'customerAccounts', 'qa-client');
const marker = db => doc(db, 'businesses', bid, 'customerAccounts', 'qa-client', 'appliedEvents', 'balance_adjustment:qa-op');
test.before(async () => {
  env = await initializeTestEnvironment({projectId: 'adi-festa-variations-test', firestore: {rules: fs.readFileSync('firestore.rules', 'utf8')}});
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'businesses', bid), {ownerId: 'qa-account-owner', active: true, legacyAccessDisabled: true, workspaceGeneration: 0, subscription: {planId: 'internal', status: 'active'}});
    for (const role of ['owner', 'manager', 'seller']) {
      const uid = 'qa-account-' + role;
      await setDoc(doc(db, 'users', uid), {uid, businessId: bid, role, active: true});
      await setDoc(doc(db, 'businesses', bid, 'members', uid), {uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
        permissions: {'customers.view': true, 'customers.receiveDebt': true, 'customers.adjustBalance': true, 'financial.view': true}});
    }
    await setDoc(account(db), {schemaVersion: 1, mode: 'shadow', businessId: bid, clientId: 'qa-client', debtCents: 15000, spaces: {[space]: 15000}});
    await setDoc(marker(db), {eventId: 'balance_adjustment:qa-op'});
  });
});
test.after(async () => env?.cleanup());
for (const role of ['owner', 'manager', 'seller']) test(`${role}: não lê nem grava a conta sombra ou seus marcadores`, async () => {
  const db = env.authenticatedContext('qa-account-' + role).firestore();
  await assertFails(getDoc(account(db)));
  await assertFails(getDoc(marker(db)));
  await assertFails(setDoc(account(db), {businessId: bid, debtCents: 0}));
  await assertFails(updateDoc(account(db), {debtCents: 0}));
  await assertFails(deleteDoc(account(db)));
  await assertFails(setDoc(marker(db), {eventId: 'forged'}));
});
test('sem login também não', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(account(db)));
  assert.ok(true);
});

// Fase 2: o relatório da carga também é só do servidor.
test('ninguém lê nem grava o relatório da carga das contas', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-run'), {runId: 'qa-run', businessId: bid});
    await setDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-run', 'items', 'qa-client'), {clientId: 'qa-client', status: 'ready'});
  });
  for (const role of ['owner', 'manager', 'seller']) {
    const db = env.authenticatedContext('qa-account-' + role).firestore();
    await assertFails(getDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-run')));
    await assertFails(getDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-run', 'items', 'qa-client')));
    await assertFails(setDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-forged'), {runId: 'qa-forged'}));
    await assertFails(setDoc(doc(db, 'businesses', bid, 'customerAccountBackfills', 'qa-run', 'items', 'qa-other'), {status: 'ready'}));
  }
});

// Fase 4: saldo por cliente e Espaço publicado para as telas.
test('saldo publicado: proprietário lê tudo; outros, só os Espaços que acessam; ninguém grava', async () => {
  const {collection, getDocs, query, where} = require('firebase/firestore');
  const spaceB = 'qa-customer-account-space-b';
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'businesses', bid, 'members', 'qa-account-restricted'), {uid: 'qa-account-restricted', role: 'cashier', status: 'active', spaceAccess: 'selected',
      allowedSpaceIds: [space], permissionsVersion: 2, permissions: {'customers.view': true, 'customers.receiveDebt': true}});
    await setDoc(doc(db, 'users', 'qa-account-restricted'), {uid: 'qa-account-restricted', businessId: bid, role: 'cashier', active: true});
    for (const [id, spaceId] of [['qa-client__' + space, space], ['qa-client__' + spaceB, spaceB], ['qa-client__sem-espaco', null]])
      await setDoc(doc(db, 'businesses', bid, 'customerSpaceAccounts', id), {businessId: bid, workspaceGeneration: 0, clientId: 'qa-client', spaceId, debtCents: 1000, status: 'ready'});
  });
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'businesses', bid, 'customerSpaceAccounts', 'old-generation'), {
      businessId: bid, workspaceGeneration: 9, clientId: 'qa-client', spaceId: space, debtCents: 1000, financialVersion: 6
    });
  });
  const accounts = db => collection(db, 'businesses', bid, 'customerSpaceAccounts');
  const owner = env.authenticatedContext('qa-account-owner').firestore();
  assert.equal((await getDocs(query(accounts(owner), where('workspaceGeneration', '==', 0)))).size, 3);
  const restricted = env.authenticatedContext('qa-account-restricted').firestore();
  assert.equal((await getDocs(query(accounts(restricted), where('spaceId', 'in', [space]), where('workspaceGeneration', '==', 0)))).size, 1);
  await assertFails(getDocs(query(accounts(restricted), where('workspaceGeneration', '==', 0))));
  await assertFails(getDoc(doc(restricted, 'businesses', bid, 'customerSpaceAccounts', 'qa-client__' + spaceB)));
  await assertFails(getDoc(doc(restricted, 'businesses', bid, 'customerSpaceAccounts', 'qa-client__sem-espaco')));
  await assertFails(getDoc(doc(restricted, 'businesses', bid, 'customerSpaceAccounts', 'old-generation')));
  await assertFails(getDoc(doc(owner, 'businesses', bid, 'customerSpaceAccounts', 'old-generation')));
  const manager = env.authenticatedContext('qa-account-manager').firestore();
  assert.equal((await getDocs(query(accounts(manager), where('spaceId', 'in', [space, spaceB]), where('workspaceGeneration', '==', 0)))).size, 2);
  await assertFails(getDoc(doc(manager, 'businesses', bid, 'customerSpaceAccounts', 'qa-client__sem-espaco')));
  for (const db of [owner, restricted, manager]) {
    await assertFails(setDoc(doc(db, 'businesses', bid, 'customerSpaceAccounts', 'qa-client__' + space), {debtCents: 0}));
    await assertFails(deleteDoc(doc(db, 'businesses', bid, 'customerSpaceAccounts', 'qa-client__' + space)));
  }
});

// Etapa 2: o registro de cada migração para a conta por Espaço é só do servidor.
test('ninguém lê nem grava o registro da migração', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'businesses', bid, 'customerAccountMigrations', 'qa-client'), {clientId: 'qa-client', businessId: bid});
  });
  for (const role of ['owner', 'manager', 'seller']) {
    const db = env.authenticatedContext('qa-account-' + role).firestore();
    await assertFails(getDoc(doc(db, 'businesses', bid, 'customerAccountMigrations', 'qa-client')));
    await assertFails(setDoc(doc(db, 'businesses', bid, 'customerAccountMigrations', 'qa-forged'), {clientId: 'qa-forged'}));
    await assertFails(deleteDoc(doc(db, 'businesses', bid, 'customerAccountMigrations', 'qa-client')));
  }
});

// Etapa 6: o resultado das auditorias das contas é só do servidor.
test('ninguém lê nem grava o resultado das auditorias', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'businesses', bid, 'customerAccountAudits', 'qa-client'), {clientId: 'qa-client', businessId: bid, status: 'match'});
  });
  for (const role of ['owner', 'manager', 'seller']) {
    const db = env.authenticatedContext('qa-account-' + role).firestore();
    await assertFails(getDoc(doc(db, 'businesses', bid, 'customerAccountAudits', 'qa-client')));
    await assertFails(setDoc(doc(db, 'businesses', bid, 'customerAccountAudits', 'qa-forged'), {status: 'match'}));
  }
});
