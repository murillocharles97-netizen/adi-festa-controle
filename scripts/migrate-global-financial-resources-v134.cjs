'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ID = 'adi-festa-controle';
const MIGRATION_ID = 'global_financial_resources_v134_2026_09';
const API = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const execute = process.argv.includes('--execute');
const validModes = new Set(['all_spaces', 'selected_spaces', 'single_space']);

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
  throw new Error('Credencial do Firebase CLI não encontrada.');
}

const tokenPromise = credential();
async function request(url, options = {}) {
  const token = await tokenPromise, response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firestore REST ${response.status}: ${body.slice(0, 500)}`);
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
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
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
const uniqueIds = (values = []) => [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
function patchWrite(document, patch) {
  return {
    update: { name: document.name, fields: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, encode(value)])) },
    updateMask: { fieldPaths: Object.keys(patch) },
    currentDocument: { updateTime: document.updateTime },
  };
}

async function commit(writes) {
  for (let index = 0; index < writes.length; index += 400) {
    await request(`${API}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes: writes.slice(index, index + 400) }) });
  }
}

async function main() {
  const spaceDocuments = await listDocuments('financialSpaces'), spaces = spaceDocuments.map((document) => ({
    document, id: idOf(document), value: decodeFields(document.fields || {}),
  })), spacesByOwner = new Map(), accounts = [];
  for (const space of spaces) {
    if (!spacesByOwner.has(space.value.ownerUid)) spacesByOwner.set(space.value.ownerUid, new Set());
    spacesByOwner.get(space.value.ownerUid).add(space.id);
    for (const document of await listDocuments(`financialSpaces/${space.id}/financialAccounts`)) {
      const value = decodeFields(document.fields || {});
      accounts.push({ document, id: idOf(document), homeSpaceId: space.id, value });
    }
  }

  const changedAt = new Date().toISOString(), inventory = [], patches = [];
  for (const account of accounts) {
    const ownerSpaces = spacesByOwner.get(account.value.ownerUid) || new Set(), explicitMode = validModes.has(account.value.accessMode),
      accessMode = explicitMode ? account.value.accessMode : 'all_spaces', defaultFinancialSpaceId = String(account.value.defaultFinancialSpaceId || account.homeSpaceId),
      rawAllowed = uniqueIds(Array.isArray(account.value.allowedFinancialSpaceIds) ? account.value.allowedFinancialSpaceIds : []),
      allowedFinancialSpaceIds = accessMode === 'all_spaces' ? [] : accessMode === 'single_space' ? [defaultFinancialSpaceId] : rawAllowed,
      invalidAllowedIds = allowedFinancialSpaceIds.filter((id) => !ownerSpaces.has(id)),
      safeToPatch = account.value.ownerUid && ownerSpaces.has(account.homeSpaceId) && !invalidAllowedIds.length
        && (accessMode !== 'selected_spaces' || allowedFinancialSpaceIds.length > 0),
      patch = {
        accountHomeSpaceId: account.homeSpaceId,
        accessMode,
        allowedFinancialSpaceIds,
        defaultFinancialSpaceId,
        resourceScopeVersion: 1,
        schemaVersion: Math.max(5, Number(account.value.schemaVersion || 0)),
      }, changed = safeToPatch && Object.entries(patch).some(([key, value]) => JSON.stringify(account.value[key]) !== JSON.stringify(value));
    inventory.push({
      id: account.id,
      name: account.value.name || null,
      type: account.value.type || 'bank_account',
      ownerUid: account.value.ownerUid || null,
      storageAnchor: account.homeSpaceId,
      previousAccessMode: account.value.accessMode || 'legacy_without_scope',
      resultingAccessMode: accessMode,
      explicitScopePreserved: explicitMode,
      invalidAllowedIds,
      status: !safeToPatch ? 'manual_review' : changed ? 'ready' : 'already_normalized',
    });
    if (changed) patches.push({ account, patch: { ...patch, scopeMigratedAt: changedAt, updatedAt: changedAt } });
  }

  const existingAudit = await optionalDocument(`financialMigrations/${MIGRATION_ID}`), writes = patches.map(({ account, patch }) => patchWrite(account.document, patch));
  if (!existingAudit) writes.push({
    update: {
      name: `projects/${PROJECT_ID}/databases/(default)/documents/financialMigrations/${MIGRATION_ID}`,
      fields: Object.fromEntries(Object.entries({
        migrationVersion: 'v134', status: 'applied', resourcesAudited: accounts.length, resourcesNormalized: patches.length,
        legacyResourcesPromotedToAllSpaces: inventory.filter((item) => item.previousAccessMode === 'legacy_without_scope' && item.status !== 'manual_review').length,
        explicitScopesPreserved: inventory.filter((item) => item.explicitScopePreserved).length,
        manualReview: inventory.filter((item) => item.status === 'manual_review').length,
        migrationAt: changedAt, noBalancesChanged: true, noTransactionsCreated: true, noResourcesMerged: true,
      }).map(([key, value]) => [key, encode(value)])),
    },
    currentDocument: { exists: false },
  });
  const report = {
    mode: execute ? 'execute' : 'dry-run', projectId: PROJECT_ID, migrationId: MIGRATION_ID,
    spacesAudited: spaces.length, resourcesAudited: accounts.length,
    resourcesByType: Object.fromEntries([...new Set(inventory.map((item) => item.type))].sort().map((type) => [type, inventory.filter((item) => item.type === type).length])),
    legacyPromotedToAllSpaces: inventory.filter((item) => item.previousAccessMode === 'legacy_without_scope' && item.status !== 'manual_review').length,
    explicitScopesPreserved: inventory.filter((item) => item.explicitScopePreserved).length,
    manualReview: inventory.filter((item) => item.status === 'manual_review'),
    resources: inventory,
    writes: writes.length,
  };
  if (!execute) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (writes.length) await commit(writes);
  const audit = await optionalDocument(`financialMigrations/${MIGRATION_ID}`);
  if (!audit) throw new Error('Registro de auditoria da migração não foi criado.');
  console.log(JSON.stringify({ ...report, status: existingAudit && !patches.length ? 'already-applied-and-verified' : 'applied-and-verified' }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
