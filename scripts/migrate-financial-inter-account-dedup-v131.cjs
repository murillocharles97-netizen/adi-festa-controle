'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ID = 'adi-festa-controle';
const OWNER_UID = 'z3ao8ODMHzbGLIBHgcJbvZtXeDp2';
const DUPLICATE = {
  homeSpaceId: '3d319b0a-9372-49ef-9a72-2ac90f00b64c',
  accountId: 'bb9925a2-c0bd-4475-8042-10b167237827',
};
const CANONICAL = {
  homeSpaceId: '76dea1f8-22de-472f-9b53-0fd608c5cd54',
  accountId: 'f13eb5b3-8acd-4dea-9644-db41654cff4b',
};
const INTER_CARD = {
  homeSpaceId: '3d319b0a-9372-49ef-9a72-2ac90f00b64c',
  cardId: 'fc9d4a6a-0de6-4b73-a17a-2ab206b68324',
};
const MIGRATION_ID = 'financial_account_dedup_inter_v131_2026_09';
const API = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const execute = process.argv.includes('--execute');

const fields = {
  string: (value) => ({ stringValue: String(value) }),
  integer: (value) => ({ integerValue: String(value) }),
  boolean: (value) => ({ booleanValue: Boolean(value) }),
  timestamp: (value) => ({ timestampValue: value }),
  null: () => ({ nullValue: null }),
  array: (values = []) => ({ arrayValue: { values: values.map((value) => fields.string(value)) } }),
  map: (value = {}) => ({ mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } }),
};

function encode(value) {
  if (value === null || value === undefined) return fields.null();
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'boolean') return fields.boolean(value);
  if (Number.isInteger(value)) return fields.integer(value);
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'object') return fields.map(value);
  return fields.string(value);
}

function decode(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(input = {}) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, decode(value)]));
}

function credential() {
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const config = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    const token = config.tokens?.access_token || config.user?.tokens?.access_token;
    if (token) return token;
  }
  throw new Error('Credencial do Firebase CLI não encontrada. Execute firebase login e tente novamente.');
}

const token = credential();
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${body.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

const documentName = (homeSpaceId, collection, id) => `projects/${PROJECT_ID}/databases/(default)/documents/financialSpaces/${homeSpaceId}/${collection}/${id}`;
const documentUrl = (homeSpaceId, collection, id) => `${API}/documents/financialSpaces/${homeSpaceId}/${collection}/${id}`;

async function readDocument(homeSpaceId, collection, id, optional = false) {
  try {
    const document = await request(documentUrl(homeSpaceId, collection, id));
    return { ...document, value: decodeFields(document.fields || {}) };
  } catch (error) {
    if (optional && /Firestore REST 404:/.test(error.message)) return null;
    throw error;
  }
}

async function listDocuments(relativePath) {
  const output = [];
  let pageToken = '';
  do {
    const suffix = `${relativePath.includes('?') ? '&' : '?'}pageSize=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      response = await request(`${API}/documents/${relativePath}${suffix}`);
    output.push(...(response.documents || []));
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return output;
}

const referenceSpecs = [
  ['space', 'entries', 'financialAccountId', 'financialAccountHomeSpaceId'],
  ['space', 'events', 'financialAccountId', 'financialAccountHomeSpaceId'],
  ['space', 'recurrences', 'financialAccountId', 'financialAccountHomeSpaceId'],
  ['space', 'creditCardInvoicePayments', 'financialAccountId', 'financialAccountHomeSpaceId'],
  ['space', 'creditCards', 'paymentAccountId', 'paymentAccountHomeSpaceId'],
  ['business', 'payments', 'financialAccountId', 'financialAccountHomeSpaceId'],
  ['business', 'payments', 'destinationAccountId', 'destinationAccountHomeSpaceId'],
  ['business', 'payments', 'sourceAccountId', 'sourceAccountHomeSpaceId'],
  ['business', 'income', 'destinationAccountId', 'destinationAccountHomeSpaceId'],
  ['business', 'expenses', 'sourceAccountId', 'sourceAccountHomeSpaceId'],
  ['root', 'financialTransfers', 'fromFinancialAccountId', 'fromFinancialAccountHomeSpaceId'],
  ['root', 'financialTransfers', 'toFinancialAccountId', 'toFinancialAccountHomeSpaceId'],
];

async function auditReferences() {
  const spaces = (await listDocuments('financialSpaces')).map((document) => ({ document, value: decodeFields(document.fields || {}) })).filter((item) => item.value.ownerUid === OWNER_UID),
    businessIds = [...new Set(spaces.map((item) => item.value.linkedBusinessId).filter(Boolean))], cache = new Map(), rows = [];
  for (const [scope, collectionId, fieldPath, homeFieldPath] of referenceSpecs) {
    const parents = scope === 'space' ? spaces.map((item) => `financialSpaces/${item.document.name.split('/').at(-1)}`)
      : scope === 'business' ? businessIds.map((id) => `businesses/${id}`) : [''];
    for (const parent of parents) {
      const relative = `${parent ? `${parent}/` : ''}${collectionId}`;
      if (!cache.has(relative)) cache.set(relative, await listDocuments(relative));
      for (const document of cache.get(relative)) {
        const value = decodeFields(document.fields || {});
        if (String(value[fieldPath] || '') === DUPLICATE.accountId) rows.push({ document, value, collectionId, fieldPath, homeFieldPath });
      }
    }
  }
  for (const item of spaces) {
    if (item.value.automation?.defaultIncomeFinancialAccountId !== DUPLICATE.accountId) continue;
    rows.push({ document: item.document, value: item.value, collectionId: 'financialSpaces', fieldPath: 'automation.defaultIncomeFinancialAccountId', homeFieldPath: 'automation.defaultIncomeFinancialAccountHomeSpaceId' });
  }
  return rows;
}

function updateWrite(document, patch) {
  const nested = {};
  for (const [fieldPath, value] of Object.entries(patch)) {
    const parts = fieldPath.split('.');
    let cursor = nested;
    while (parts.length > 1) {
      const part = parts.shift();
      cursor[part] ||= {};
      cursor = cursor[part];
    }
    cursor[parts[0]] = value;
  }
  return {
    update: { name: document.name, fields: Object.fromEntries(Object.entries(nested).map(([key, value]) => [key, encode(value)])) },
    updateMask: { fieldPaths: Object.keys(patch) },
    currentDocument: { updateTime: document.updateTime },
  };
}

async function main() {
  const [duplicate, canonical, interCard, existingAudit] = await Promise.all([
    readDocument(DUPLICATE.homeSpaceId, 'financialAccounts', DUPLICATE.accountId, true),
    readDocument(CANONICAL.homeSpaceId, 'financialAccounts', CANONICAL.accountId),
    readDocument(INTER_CARD.homeSpaceId, 'creditCards', INTER_CARD.cardId),
    request(`${API}/documents/financialMigrations/${MIGRATION_ID}`).catch((error) => /Firestore REST 404:/.test(error.message) ? null : Promise.reject(error)),
  ]);
  if (!duplicate && existingAudit) {
    console.log(JSON.stringify({ status: 'already-applied', migrationId: MIGRATION_ID, canonicalAccountId: CANONICAL.accountId }, null, 2));
    return;
  }
  if (!duplicate) throw new Error('A conta duplicada não existe e o audit log da migração também não foi encontrado.');
  for (const account of [duplicate, canonical]) {
    if (account.value.ownerUid !== OWNER_UID) throw new Error(`Owner inesperado em ${account.name}.`);
  }
  if (!/^banco inter$/i.test(String(duplicate.value.name || ''))) throw new Error('A conta duplicada não corresponde inequivocamente a Banco inter.');
  if (!/^inter$/i.test(String(canonical.value.name || ''))) throw new Error('A conta canônica não corresponde inequivocamente a Inter.');
  const balances = [duplicate, canonical].map((account) => Number.isInteger(account.value.currentBalanceCents) ? account.value.currentBalanceCents : Number(account.value.initialBalanceCents || 0));
  if (balances.some((value) => value !== 0)) throw new Error(`Migração bloqueada: os saldos físicos não são ambos zero (${balances.join(', ')}).`);
  if (interCard.value.ownerUid !== OWNER_UID || String(interCard.value.last4) !== '0937') throw new Error('O cartão Inter esperado não foi identificado com segurança.');

  const references = (await auditReferences()).filter((row) => row.value.ownerUid === OWNER_UID || row.value.ownerId === OWNER_UID || row.value.createdBy === OWNER_UID);
  const now = new Date().toISOString(), writes = [
    updateWrite(canonical, {
      name: 'Inter', institution: 'Banco Inter', institutionKey: 'banco_inter', accountHomeSpaceId: CANONICAL.homeSpaceId,
      accessMode: 'all_spaces', allowedFinancialSpaceIds: [], defaultFinancialSpaceId: CANONICAL.homeSpaceId,
      currentBalanceCents: 0, schemaVersion: 4, updatedAt: now,
    }),
    updateWrite(interCard, { institution: 'Banco Inter', issuer: 'Banco Inter', institutionKey: 'banco_inter', updatedAt: now }),
    ...references.map((row) => updateWrite(row.document, { [row.fieldPath]: CANONICAL.accountId, [row.homeFieldPath]: CANONICAL.homeSpaceId })),
    {
      update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/financialMigrations/${MIGRATION_ID}`, fields: Object.fromEntries(Object.entries({
        migrationVersion: 'v131', status: 'applied', duplicateAccountId: DUPLICATE.accountId, duplicateAccountHomeSpaceId: DUPLICATE.homeSpaceId,
        canonicalAccountId: CANONICAL.accountId, canonicalAccountHomeSpaceId: CANONICAL.homeSpaceId, ownerUid: OWNER_UID,
        referencesMoved: references.length, physicalBalanceCents: 0, migrationAt: now, noFinancialResultCreated: true,
      }).map(([key, value]) => [key, encode(value)])) },
      currentDocument: { exists: false },
    },
    { delete: duplicate.name, currentDocument: { updateTime: duplicate.updateTime } },
  ];
  const report = {
    mode: execute ? 'execute' : 'dry-run',
    projectId: PROJECT_ID,
    ownerUid: OWNER_UID,
    duplicate: { id: DUPLICATE.accountId, homeSpaceId: DUPLICATE.homeSpaceId, name: duplicate.value.name, institution: duplicate.value.institution || null, balanceCents: balances[0] },
    canonical: { id: CANONICAL.accountId, homeSpaceId: CANONICAL.homeSpaceId, name: canonical.value.name, institution: canonical.value.institution || null, balanceCents: balances[1] },
    cardPreserved: { id: INTER_CARD.cardId, last4: interCard.value.last4 },
    references: references.map((row) => ({ document: row.document.name.split('/documents/')[1], field: row.fieldPath, financialSpaceId: row.value.financialSpaceId || null })),
    writes: writes.length,
  };
  if (!execute) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  await request(`${API}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
  const [removed, after, audit] = await Promise.all([
    readDocument(DUPLICATE.homeSpaceId, 'financialAccounts', DUPLICATE.accountId, true),
    readDocument(CANONICAL.homeSpaceId, 'financialAccounts', CANONICAL.accountId),
    request(`${API}/documents/financialMigrations/${MIGRATION_ID}`),
  ]);
  if (removed || after.value.accessMode !== 'all_spaces' || Number(decodeFields(audit.fields || {}).referencesMoved) !== references.length) throw new Error('A verificação posterior da migração falhou.');
  console.log(JSON.stringify({ ...report, status: 'applied-and-verified', canonicalAfter: { name: after.value.name, institution: after.value.institution, accessMode: after.value.accessMode, balanceCents: after.value.currentBalanceCents } }, null, 2));
}

main().catch((error) => { console.error(JSON.stringify({ status: 'failed', message: error.message }, null, 2)); process.exitCode = 1; });
