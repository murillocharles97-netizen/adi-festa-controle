'use strict';

// Diagnóstico de cliente, somente leitura. Nunca imprime token nem dados de contato.
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const projectId = 'adi-festa-controle';
const customerName = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'Anderson Chilli';
const auditWholeBusiness = process.argv.includes('--business-wide');
const requestedAmount = Number(process.argv.find((argument) => argument.startsWith('--amount='))?.split('=')[1] || 13);
const since = process.argv.find((argument) => argument.startsWith('--since='))?.split('=')[1] || '';
const globalRoot = (process.platform === 'win32'
  ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], { encoding: 'utf8' })
  : execFileSync('npm', ['root', '-g'], { encoding: 'utf8' })).trim();
const fromCli = createRequire(path.join(globalRoot, 'firebase-tools', 'package.json'));
const auth = fromCli('./lib/auth');
let token;

async function accessToken() {
  if (token) return token;
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI não está autenticado.');
  token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token;
  return token;
}

function decode(field) {
  if (!field) return null;
  if ('nullValue' in field) return null;
  if ('stringValue' in field) return field.stringValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return Number(field.doubleValue);
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(decode);
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, value]) => [key, decode(value)]));
  return null;
}

const decodeDoc = (doc) => ({
  id: String(doc.name || '').split('/').at(-1),
  path: String(doc.name || '').split('/documents/')[1] || '',
  createTime: doc.createTime || null,
  updateTime: doc.updateTime || null,
  ...Object.fromEntries(Object.entries(doc.fields || {}).map(([key, field]) => [key, decode(field)])),
});

async function runQuery(structuredQuery, parent = '') {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const response = await fetch(`${base}${parent ? `/${parent}` : ''}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new Error(`Firestore query ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return (await response.json()).filter((row) => row.document).map((row) => decodeDoc(row.document));
}

const equal = (fieldPath, value) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: String(value) } } });
const equalNumber = (fieldPath, value) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { doubleValue: Number(value) } } });
const scoped = (businessId, collectionId, where) => runQuery({ from: [{ collectionId }], where, limit: 100 }, `businesses/${businessId}`);
const money = (value) => Math.round(Number(value) * 100) / 100;

function reconstructSinceLastZero(collections, savedBalance) {
  const entries = ['sales', 'payments', 'balanceAdjustments'].flatMap((name) => collections[name]
    .filter((row) => row.financialAppliedAt)
    .map((row) => ({ ...row, collection: name, resulting: row.saldoAtual ?? row.saldoNovo }))
    .filter((row) => row.resulting !== null && row.resulting !== undefined && Number.isFinite(Number(row.resulting))));
  entries.sort((a, b) => String(a.financialAppliedAt).localeCompare(String(b.financialAppliedAt)));
  const anchorIndex = entries.findLastIndex((row) => money(row.resulting) === 0);
  if (anchorIndex < 0) return { status: 'no-confirmed-zero-anchor', savedBalance };
  let calculatedBalance = 0;
  for (const entry of entries.slice(anchorIndex + 1)) {
    if (!Number.isFinite(Number(entry.saldoAnterior)))
      return { status: 'incomplete-chain', savedBalance, sourceId: entry.id };
    const delta = money(Number(entry.resulting) - Number(entry.saldoAnterior));
    calculatedBalance = money(calculatedBalance + delta);
  }
  return { status: 'anchored', anchorId: entries[anchorIndex].id,
    anchorAt: entries[anchorIndex].financialAppliedAt,
    eventsAfterAnchor: entries.length - anchorIndex - 1,
    eventIdsAfterAnchor: entries.slice(anchorIndex + 1).map((row) => ({ collection: row.collection,
      id: row.id, status: row.status, financialAppliedAt: row.financialAppliedAt,
      delta: money(Number(row.resulting) - Number(row.saldoAnterior)) })),
    calculatedBalance, savedBalance, difference: money(savedBalance - calculatedBalance) };
}

async function businessWideBalanceAudit(businessId) {
  const names = ['clients', 'sales', 'payments', 'balanceAdjustments', 'balanceEvents'];
  const collections = Object.fromEntries(await Promise.all(names.map(async (name) => [name,
    await runQuery({ from: [{ collectionId: name }] }, `businesses/${businessId}`),
  ])));
  const byClient = new Map(collections.clients.map((client) => [String(client.id), {
    sales: [], payments: [], balanceAdjustments: [], balanceEvents: [], savedBalance: client.saldo,
  }]));
  for (const name of names.slice(1)) for (const row of collections[name]) {
    const entry = byClient.get(String(row.clienteId || row.customerId || ''));
    if (entry) entry[name].push(row);
  }
  const results = [...byClient.entries()].map(([customerId, data]) => {
    const reconstruction = reconstructSinceLastZero(data, data.savedBalance);
    if (reconstruction.status === 'anchored') {
      reconstruction.unmarkedDocumentsAfterAnchor = ['sales', 'payments', 'balanceAdjustments']
        .flatMap((name) => data[name].filter((row) => !row.financialAppliedAt &&
          String(row.data || row.createdAt || row.criadoEm || '') > reconstruction.anchorAt)
          .map((row) => ({ collection: name, id: row.id, status: row.status || null })));
      const effects = data.balanceEvents.filter((event) =>
        String(event.sourceDocumentId || '') !== reconstruction.anchorId &&
        String(event.appliedAt || event.updatedAt || '') > reconstruction.anchorAt &&
        Number.isFinite(Number(event.balanceDelta)));
      reconstruction.confirmedEffectsAfterAnchor = effects.length;
      reconstruction.effectProjectedBalance = money(effects.reduce((sum, event) => sum + Number(event.balanceDelta), 0));
      reconstruction.effectDifference = money(data.savedBalance - reconstruction.effectProjectedBalance);
    }
    return { customerId, reconstruction };
  });
  return {
    businessId,
    documentsRead: Object.fromEntries(names.map((name) => [name, collections[name].length])),
    clientsWithAnchor: results.filter((item) => item.reconstruction.status === 'anchored').length,
    clientsWithoutAnchor: results.filter((item) => item.reconstruction.status === 'no-confirmed-zero-anchor').length,
    incompleteChains: results.filter((item) => item.reconstruction.status === 'incomplete-chain').length,
    provableDivergences: results.filter((item) => item.reconstruction.status === 'anchored' &&
      item.reconstruction.effectDifference !== 0 &&
      item.reconstruction.unmarkedDocumentsAfterAnchor.length === 0),
    projectionCandidates: results.filter((item) => item.reconstruction.status === 'anchored' && item.reconstruction.difference !== 0),
  };
}

async function main() {
  const businesses = await runQuery({ from: [{ collectionId: 'businesses' }], limit: 100 });
  const clients = (await Promise.all(businesses.map((business) => scoped(business.id, 'clients', equal('nome', customerName))))).flat();
  const candidateSales = [];
  for (const business of businesses) {
    for (const [field, filter] of [['valorFinal', equalNumber('valorFinal', requestedAmount)], ['clienteNome', equal('clienteNome', customerName)]]) {
      const rows = await scoped(business.id, 'sales', filter);
      for (const row of rows) candidateSales.push({ businessId: business.id, matchedField: field, row });
    }
  }
  const report = [];
  for (const client of clients) {
    const businessId = client.path.split('/')[1] || '';
    const collections = ['sales', 'payments', 'balanceAdjustments', 'balanceEvents', 'movements'];
    const byCollection = {};
    for (const name of collections) {
      const fields = name === 'balanceEvents' ? ['customerId', 'clienteId'] : ['clienteId', 'customerId'];
      const matches = [];
      for (const field of fields) {
        try {
          const rows = await scoped(businessId, name, equal(field, client.id));
          matches.push(...rows.filter((row) => row.path.startsWith(`businesses/${businessId}/`)));
        } catch (error) {
          if (!String(error.message).includes('FAILED_PRECONDITION')) throw error;
        }
      }
      byCollection[name] = [...new Map(matches.map((item) => [item.path, item])).values()].map((item) => ({
        id: item.id, path: item.path, operationId: item.operationId || null,
        status: item.status || null, applicationStatus: item.applicationStatus || null,
        type: item.type || item.tipo || null, amount: item.amount ?? item.valor ?? item.valorFinal ?? null,
        balanceDelta: item.balanceDelta ?? null, saldoAnterior: item.saldoAnterior ?? null,
        saldoAtual: item.saldoAtual ?? null, saldoNovo: item.saldoNovo ?? null,
        financialAppliedAt: item.financialAppliedAt || null,
        data: item.data || item.createdAt || item.criadoEm || null,
        updatedAt: item.updatedAt || item.updateTime || null,
        spaceId: item.spaceId || item.financialSpaceId || null,
      }));
    }
    report.push({
      businessId, customerId: client.id, name: client.nome,
      savedBalance: client.saldo, openBalance: client.openBalance ?? null,
      financialVersion: client.financialVersion ?? null,
      financialRevision: client.financialRevision ?? null,
      clientUpdatedAt: client.updatedAt || client.atualizadoEm || client.updateTime,
      documentPath: client.path,
      reconstruction: reconstructSinceLastZero(byCollection, client.saldo),
      collections: byCollection,
    });
  }
  const customerIds = new Set(clients.map((client) => String(client.id)));
  const matchingSales = [...new Map(candidateSales
    .filter(({ row }) => customerIds.has(String(row.clienteId || row.customerId || '')) || row.clienteNome === customerName)
    .map(({ businessId, row }) => [`${businessId}/${row.id}`, { businessId, id: row.id,
      clienteId: row.clienteId || row.customerId || null, valorFinal: row.valorFinal ?? null,
      status: row.status || null, operationId: row.operationId || null,
      financialVersionAnterior: row.financialVersionAnterior ?? null,
      sourceDeviceId: row.sourceDeviceId || null, createdBy: row.createdBy || null,
      data: row.data || row.createdAt || null, financialAppliedAt: row.financialAppliedAt || null }])).values()];
  const recentAmountSales = since ? candidateSales.filter(({ matchedField, row }) =>
    matchedField === 'valorFinal' && String(row.data || row.createdAt || '') >= since)
    .map(({ businessId, row }) => ({ businessId, id: row.id,
      clienteId: row.clienteId || row.customerId || null,
      operationId: row.operationId || null, data: row.data || row.createdAt || null })) : null;
  const businessAudit = auditWholeBusiness ? await businessWideBalanceAudit('adi-festa') : null;
  process.stdout.write(`${JSON.stringify({ mode: 'read-only', projectId, customerName, requestedAmount,
    businessesChecked: businesses.length,
    matchingSales,
    salesAtRequestedAmountInOtherCustomers: [...new Set(candidateSales
      .filter(({ matchedField }) => matchedField === 'valorFinal')
      .map(({ businessId, row }) => `${businessId}/${row.id}`))].length - matchingSales.filter((row) => Number(row.valorFinal) === requestedAmount).length,
    matches: report, ...(recentAmountSales ? { recentAmountSales } : {}),
    ...(businessAudit ? { businessAudit } : {}) }, null, 2)}\n`);
}

main().catch((error) => { console.error(`[balance-audit] ${error.message}`); process.exitCode = 1; });
