'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const PROJECT_ID = 'adi-festa-controle';
const MIGRATION_ID = 'global_spaces_v1_v139_2026_09';
const MIGRATION_VERSION = 'v139';
const GLOBAL_SPACE_SCHEMA_VERSION = 1;
const API = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const execute = process.argv.includes('--execute');
const validLegacyTypes = new Set(['business', 'personal', 'other']);
const validOperationalTypes = new Set(['unit', 'operation', 'personal', 'other']);
const validStatuses = new Set(['active', 'archived']);
const reservedSpaceIds = new Set(['all', 'all_spaces']);
const capabilityFields = ['finance', 'sales', 'products', 'inventory', 'goals'];

async function credential() {
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const config = JSON.parse(fs.readFileSync(candidate, 'utf8')),
      tokens = config.tokens || config.user?.tokens || {}, refreshToken = tokens.refresh_token;
    if (refreshToken) {
      const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
        grant_type: 'refresh_token',
      }), response = await fetch('https://www.googleapis.com/oauth2/v3/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      if (response.ok) {
        const refreshed = await response.json();
        if (refreshed.access_token) return refreshed.access_token;
      }
    }
    if (tokens.access_token) return tokens.access_token;
  }
  throw new Error('Credencial do Firebase CLI não encontrada. Execute firebase login e tente novamente.');
}

let tokenPromise;
async function request(url, options = {}) {
  const token = await (tokenPromise ||= credential()), response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${body.slice(0, 800)}`);
  }
  return response.status === 204 ? null : response.json();
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
const decodeFields = (input = {}) => Object.fromEntries(Object.entries(input).map(([key, value]) => [key, decode(value)]));
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'object')
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
  return { stringValue: String(value) };
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

async function optionalDocument(relativePath) {
  try { return await request(`${API}/documents/${relativePath}`); }
  catch (error) {
    if (/Firestore REST 404:/.test(error.message)) return null;
    throw error;
  }
}

const idOf = (document) => document.name.split('/').at(-1);
const same = (left, right) => isDeepStrictEqual(left, right);
const fullName = (relativePath) => `projects/${PROJECT_ID}/databases/(default)/documents/${relativePath}`;
function patchWrite(document, patch) {
  const fields = Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    if (key !== 'capabilities' || !document.fields?.capabilities?.mapValue?.fields)
      return [key, encode(value)];
    const canonicalFields = Object.fromEntries(capabilityFields.map((field) => [field, encode(value[field])])),
      existingFields = document.fields.capabilities.mapValue.fields;
    return [key, { mapValue: { fields: { ...existingFields, ...canonicalFields } } }];
  }));
  return {
    update: { name: document.name, fields },
    updateMask: { fieldPaths: Object.keys(patch) },
    currentDocument: { updateTime: document.updateTime },
  };
}
function createWrite(relativePath, value) {
  return {
    update: { name: fullName(relativePath), fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) },
    currentDocument: { exists: false },
  };
}
async function commit(writes) {
  for (let index = 0; index < writes.length; index += 400)
    await request(`${API}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(index, index + 400) }) });
}

function defaultCapabilities(legacyType, source = {}) {
  const operational = legacyType === 'business', current = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    ...current,
    finance: current.finance !== undefined ? current.finance === true : true,
    sales: current.sales !== undefined ? current.sales === true : operational,
    products: current.products !== undefined ? current.products === true : operational,
    inventory: current.inventory !== undefined ? current.inventory === true : operational,
    goals: current.goals !== undefined ? current.goals === true : operational,
  };
}

function explicitGlobalFieldIssues(source = {}) {
  const issues = [];
  if (source.operationalType !== undefined && !validOperationalTypes.has(source.operationalType))
    issues.push({ reason: 'invalid-operational-type', field: 'operationalType', value: source.operationalType });
  if (source.status !== undefined && !validStatuses.has(source.status))
    issues.push({ reason: 'invalid-global-status', field: 'status', value: source.status });
  if (source.isDefault !== undefined && typeof source.isDefault !== 'boolean')
    issues.push({ reason: 'invalid-default-flag', field: 'isDefault', value: source.isDefault });
  if (source.globalSpaceSchemaVersion !== undefined
    && (!Number.isInteger(source.globalSpaceSchemaVersion) || source.globalSpaceSchemaVersion < 0))
    issues.push({ reason: 'invalid-global-schema-version', field: 'globalSpaceSchemaVersion', value: source.globalSpaceSchemaVersion });
  if (source.capabilities !== undefined) {
    if (!source.capabilities || typeof source.capabilities !== 'object' || Array.isArray(source.capabilities))
      issues.push({ reason: 'invalid-capabilities-map', field: 'capabilities', value: source.capabilities });
    else for (const field of capabilityFields)
      if (Object.hasOwn(source.capabilities, field) && typeof source.capabilities[field] !== 'boolean')
        issues.push({ reason: 'invalid-capability-flag', field: `capabilities.${field}`, value: source.capabilities[field] });
  }
  return issues;
}

function normalizedGlobalFields(space) {
  const raw = space.value, legacyType = String(raw.type || 'other'),
    explicitBusinessId = String(raw.businessId || '').trim(), linkedBusinessId = String(raw.linkedBusinessId || '').trim(),
    businessId = explicitBusinessId || linkedBusinessId || null,
    operationalType = validOperationalTypes.has(String(raw.operationalType || ''))
      ? String(raw.operationalType)
      : legacyType === 'business' ? 'unit' : legacyType === 'personal' ? 'personal' : 'other',
    status = raw.status === 'archived' || raw.active === false ? 'archived' : 'active',
    schemaVersion = Number(raw.globalSpaceSchemaVersion || 0);
  return {
    businessId,
    operationalType,
    status,
    capabilities: defaultCapabilities(legacyType, raw.capabilities),
    isDefault: raw.isDefault === true || (legacyType === 'business' && Boolean(businessId) && space.id === `business_${businessId}`),
    globalSpaceSchemaVersion: Number.isFinite(schemaVersion) ? Math.max(GLOBAL_SPACE_SCHEMA_VERSION, schemaVersion) : GLOBAL_SPACE_SCHEMA_VERSION,
  };
}

function globalPatch(space) {
  const fields = normalizedGlobalFields(space), patch = {};
  for (const [field, value] of Object.entries(fields))
    if (!same(space.value[field], value)) patch[field] = value;
  return { fields, patch };
}

function buildDefaultSpace(business, changedAt) {
  const id = `business_${business.id}`, name = String(business.value.name || business.value.legalName || 'Meu negócio').trim().slice(0, 80);
  return {
    id,
    ownerUid: business.value.ownerId,
    createdBy: business.value.ownerId,
    name: name || 'Meu negócio',
    type: 'business',
    linkedBusinessId: business.id,
    businessId: business.id,
    operationalType: 'unit',
    active: true,
    status: 'active',
    capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true },
    isDefault: true,
    globalSpaceSchemaVersion: GLOBAL_SPACE_SCHEMA_VERSION,
    automation: {
      enabled: true,
      linkedBusinessId: business.id,
      activatedAt: changedAt,
      autoIncome: { sales: true, customerPayments: true, onlineOrders: true },
    },
    autoIncomeSince: changedAt,
    autoEntryFromPaymentsSince: changedAt,
    autoEntryFromSalesSince: changedAt,
    currency: 'BRL',
    createdAt: changedAt,
    updatedAt: changedAt,
    schemaVersion: 1,
  };
}

function inventoryByType(spaces) {
  return Object.fromEntries([...new Set(spaces.map((space) => String(space.value.type || 'missing')))].sort()
    .map((type) => [type, spaces.filter((space) => String(space.value.type || 'missing') === type).length]));
}

function verifyResult(beforeSpaces, desiredRows, defaults, afterDocuments) {
  const after = new Map(afterDocuments.map((document) => [idOf(document), { document, value: decodeFields(document.fields || {}) }]));
  for (const before of beforeSpaces) {
    const current = after.get(before.id);
    if (!current) throw new Error(`Verificação falhou: o espaço original ${before.id} desapareceu.`);
    if (!same(current.value.type, before.value.type)) throw new Error(`Verificação falhou: o type legado de ${before.id} mudou.`);
  }
  for (const row of desiredRows) {
    const current = after.get(row.space.id);
    for (const [field, expected] of Object.entries(row.fields))
      if (!same(current?.value?.[field], expected)) throw new Error(`Verificação falhou em ${row.space.id}.${field}.`);
  }
  for (const item of defaults) {
    const current = after.get(item.id);
    if (!current || current.value.linkedBusinessId !== item.value.linkedBusinessId || current.value.capabilities?.sales !== true)
      throw new Error(`Verificação falhou ao criar o espaço padrão ${item.id}.`);
  }
  if (after.size !== beforeSpaces.length + defaults.length)
    throw new Error(`Verificação falhou: esperado ${beforeSpaces.length + defaults.length} espaços, encontrado ${after.size}.`);
  return after;
}

async function main() {
  const [spaceDocuments, businessDocuments, existingAuditDocument] = await Promise.all([
    listDocuments('financialSpaces'),
    listDocuments('businesses'),
    optionalDocument(`spaceMigrations/${MIGRATION_ID}`),
  ]), changedAt = new Date().toISOString(),
    spaces = spaceDocuments.map((document) => ({ document, id: idOf(document), value: decodeFields(document.fields || {}) })),
    businesses = businessDocuments.map((document) => ({ document, id: idOf(document), value: decodeFields(document.fields || {}) })),
    spaceIds = new Set(spaces.map((space) => space.id)), businessIds = new Set(businesses.map((business) => business.id)), manualReview = [], desiredRows = [];

  for (const space of spaces) {
    const rawBusinessId = String(space.value.businessId || '').trim(), linkedBusinessId = String(space.value.linkedBusinessId || '').trim();
    if (reservedSpaceIds.has(space.id))
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'reserved-aggregate-id' });
    if (String(space.value.id || '').trim() !== space.id)
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'document-id-field-mismatch', value: space.value.id || null });
    if (!String(space.value.ownerUid || '').trim())
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'missing-owner' });
    if (typeof space.value.active !== 'boolean')
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'missing-or-invalid-active-flag', value: space.value.active ?? null });
    if (!validLegacyTypes.has(String(space.value.type || '')))
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'unsupported-legacy-type', value: space.value.type || null });
    for (const issue of explicitGlobalFieldIssues(space.value))
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, ...issue });
    if (rawBusinessId && linkedBusinessId && rawBusinessId !== linkedBusinessId)
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'business-link-conflict', businessId: rawBusinessId, linkedBusinessId });
    const { fields, patch } = globalPatch(space);
    if (space.value.type === 'business' && !linkedBusinessId)
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'business-space-without-linked-business' });
    if (space.value.type !== 'business' && linkedBusinessId)
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'nonbusiness-space-with-linked-business', linkedBusinessId });
    if (fields.businessId && !businessIds.has(fields.businessId))
      manualReview.push({ severity: 'block', entity: 'space', id: space.id, reason: 'unknown-business', businessId: fields.businessId });
    desiredRows.push({ space, fields, patch });
  }

  const normalizedExisting = desiredRows.map((row) => ({ ...row.space, global: row.fields })), defaults = [], businessActions = [];
  for (const business of businesses.filter((item) => item.value.active !== false)) {
    const activeSales = normalizedExisting.filter((space) => space.global.businessId === business.id
      && space.global.status === 'active' && space.global.capabilities.sales === true);
    if (activeSales.length) {
      businessActions.push({ businessId: business.id, action: 'preserved-existing-sales-space', spaceIds: activeSales.map((space) => space.id) });
      continue;
    }
    const defaultId = `business_${business.id}`, conflict = spaces.find((space) => space.id === defaultId);
    if (conflict) {
      manualReview.push({
        severity: 'block', entity: 'business', id: business.id, reason: 'deterministic-default-id-conflict',
        spaceId: defaultId, legacyType: conflict.value.type || null, linkedBusinessId: conflict.value.linkedBusinessId || null,
      });
      businessActions.push({ businessId: business.id, action: 'blocked-existing-default-id', spaceId: defaultId });
      continue;
    }
    if (!String(business.value.ownerId || '').trim()) {
      manualReview.push({ severity: 'block', entity: 'business', id: business.id, reason: 'missing-owner-for-default' });
      businessActions.push({ businessId: business.id, action: 'blocked-missing-owner' });
      continue;
    }
    const value = buildDefaultSpace(business, changedAt);
    if (spaceIds.has(value.id)) throw new Error(`Colisão inesperada no espaço ${value.id}.`);
    defaults.push({ id: value.id, businessId: business.id, value });
    businessActions.push({ businessId: business.id, action: 'create-deterministic-default', spaceId: value.id });
  }

  const patches = desiredRows.filter((row) => Object.keys(row.patch).length > 0), dataWrites = [
    ...patches.map((row) => patchWrite(row.space.document, row.patch)),
    ...defaults.map((item) => createWrite(`financialSpaces/${item.id}`, item.value)),
  ], afterPreview = [
    ...desiredRows.map((row) => ({ id: row.space.id, value: { ...row.space.value, ...row.fields } })),
    ...defaults.map((item) => ({ id: item.id, value: item.value })),
  ], report = {
    mode: execute ? 'execute' : 'dry-run',
    projectId: PROJECT_ID,
    migrationId: MIGRATION_ID,
    migrationVersion: MIGRATION_VERSION,
    before: {
      spaces: spaces.length,
      activeBusinesses: businesses.filter((business) => business.value.active !== false).length,
      spacesByLegacyType: inventoryByType(spaces),
      ids: spaces.map((space) => space.id).sort(),
    },
    after: {
      spaces: afterPreview.length,
      spacesByLegacyType: inventoryByType(afterPreview),
      ids: afterPreview.map((space) => space.id).sort(),
    },
    spacesPatched: patches.length,
    fieldsPatched: patches.reduce((sum, row) => sum + Object.keys(row.patch).length, 0),
    defaultsCreated: defaults.length,
    changes: patches.map((row) => ({ id: row.space.id, fields: Object.keys(row.patch).sort() })),
    businessActions,
    manualReview,
    invariants: {
      originalIdsPreserved: true,
      legacyTypesPreserved: true,
      parentDocumentsMoved: 0,
      childCollectionsMoved: 0,
      childCollectionsWritten: 0,
      salesDocumentsScanned: 0,
      salesDocumentsWritten: 0,
      productsDocumentsScanned: 0,
      productsDocumentsWritten: 0,
      saleSpaceIdsBackfilled: 0,
    },
    dataWrites: dataWrites.length,
  };

  if (!execute) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const blockers = manualReview.filter((item) => item.severity === 'block');
  if (blockers.length)
    throw new Error(`Migração bloqueada por ${blockers.length} inconsistência(s). Rode sem --execute e revise manualReview.`);

  if (dataWrites.length) await commit(dataWrites);
  const afterDocuments = await listDocuments('financialSpaces');
  verifyResult(spaces, desiredRows, defaults, afterDocuments);

  const existingAudit = existingAuditDocument
      ? { document: existingAuditDocument, value: decodeFields(existingAuditDocument.fields || {}) }
      : null,
    auditValue = {
      migrationVersion: MIGRATION_VERSION,
      globalSpaceSchemaVersion: GLOBAL_SPACE_SCHEMA_VERSION,
      status: 'applied-and-verified',
      projectId: PROJECT_ID,
      spacesBefore: spaces.length,
      spacesAfter: afterDocuments.length,
      spacesPatched: patches.length,
      defaultsCreated: defaults.length,
      activeBusinessesAudited: businesses.filter((business) => business.value.active !== false).length,
      firstMigratedAt: existingAudit?.value.firstMigratedAt || changedAt,
      lastVerifiedAt: changedAt,
      runCount: Number(existingAudit?.value.runCount || 0) + 1,
      invariants: report.invariants,
    }, shouldWriteAudit = dataWrites.length > 0 || !existingAudit;
  if (shouldWriteAudit) {
    const auditWrite = existingAudit
      ? patchWrite(existingAudit.document, auditValue)
      : createWrite(`spaceMigrations/${MIGRATION_ID}`, auditValue);
    await commit([auditWrite]);
  }
  const verifiedAudit = await optionalDocument(`spaceMigrations/${MIGRATION_ID}`);
  if (!verifiedAudit) throw new Error('O registro de auditoria da migração não foi encontrado após a execução.');
  const verifiedAuditValue = decodeFields(verifiedAudit.fields || {});
  if (verifiedAuditValue.migrationVersion !== MIGRATION_VERSION || verifiedAuditValue.status !== 'applied-and-verified')
    throw new Error('O registro de auditoria existe, mas não corresponde à migração verificada.');
  console.log(JSON.stringify({
    ...report,
    status: dataWrites.length ? 'applied-and-verified' : 'already-applied-and-verified',
    auditWritten: shouldWriteAudit,
    auditPath: `spaceMigrations/${MIGRATION_ID}`,
  }, null, 2));
}

if (require.main === module)
  main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = {
  buildDefaultSpace,
  defaultCapabilities,
  explicitGlobalFieldIssues,
  globalPatch,
  normalizedGlobalFields,
  patchWrite,
  same,
};
