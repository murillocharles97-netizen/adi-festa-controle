'use strict';
// Conta por Espaço — Fase 1, modo sombra.
// Quanto o cliente deve em cada Espaço, mantido evento a evento a partir do razão
// (balanceEvents). Nesta fase nada lê esta conta para exibir ou autorizar: ela é
// comparada com a reconstrução completa do histórico (fiado-history-account) e com o
// saldo cadastral, para provar o modelo antes de qualquer uso.
// debtCents > 0: o cliente deve; < 0: crédito.
const SCHEMA_VERSION = 1;
const cents = value => { const n = Number(value); if (!Number.isFinite(n)) throw Error('valor-invalido'); return Math.round(n * 100); };
const clientOf = event => String(event?.customerId || event?.clientId || event?.clienteId || '');
const spaceOf = row => row?.spaceId || row?.financialSpaceId || null;
// The commit writes appliedAt as a Timestamp; the history reads it as an ISO string. Both
// must give the same key, or an event already inside the baseline is applied again.
const instant = v => v?.toDate ? v.toDate().toISOString() : v && typeof v === 'object' && Number.isFinite(v.seconds ?? v._seconds)
  ? new Date((v.seconds ?? v._seconds) * 1000 + Math.floor((v.nanoseconds ?? v._nanoseconds ?? 0) / 1e6)).toISOString() : String(v || '');
const keyOf = event => [instant(event?.appliedAt), String(event?.id || '')];
const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const clean = spaces => Object.fromEntries(Object.entries(spaces).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)));

// Same confirmation rule as the account proof: applied, same company and generation.
function applicable(event, {businessId, generation}) {
  return Boolean(event && event.status === 'applied' && (!event.businessId || event.businessId === businessId) &&
    (event.workspaceGeneration ?? 0) === generation && clientOf(event) && Number.isFinite(Number(event.balanceDelta)));
}
function empty({businessId, generation, clientId}) {
  return {schemaVersion: SCHEMA_VERSION, mode: 'shadow', businessId, workspaceGeneration: generation, clientId,
    debtCents: 0, spaces: {}, unattributedCents: 0, eventCount: 0, lastEvent: null, baseline: null};
}
// One confirmed event: what it adds to the debt of its Space (or to the unattributed part).
function apply(account, event) {
  const owed = -cents(event.balanceDelta), space = spaceOf(event), spaces = {...account.spaces};
  if (space) spaces[space] = (spaces[space] || 0) + owed;
  const key = keyOf(event), last = account.lastEvent ? [account.lastEvent.appliedAt, account.lastEvent.id] : null;
  return {...account, debtCents: account.debtCents + owed, spaces: clean(spaces),
    unattributedCents: account.unattributedCents + (space ? 0 : owed), eventCount: account.eventCount + 1,
    lastEvent: !last || newer(key, last) ? {appliedAt: key[0], id: key[1]} : account.lastEvent};
}
// An event at or before the baseline cut is already inside the baseline.
function includedInBaseline(account, event) {
  const cut = account?.baseline?.cut;
  return Boolean(cut) && !newer(keyOf(event), [cut.appliedAt, cut.id]);
}
function cutOf(events) {
  let cut = null;
  for (const e of events) { const k = keyOf(e); if (!cut || newer(k, cut)) cut = k; }
  return cut ? {appliedAt: cut[0], id: cut[1]} : null;
}
// Baseline from the proved projection: the debt of each Space as the server proves it today.
function fromProjection(projection, {businessId, generation, clientId, events, at}) {
  const spaces = {}; let unattributed = 0;
  for (const e of projection.entries || []) { if (e.spaceId) spaces[e.spaceId] = (spaces[e.spaceId] || 0) + e.remainingCents; else unattributed += e.remainingCents; }
  const confirmed = events.filter(e => e.status === 'applied');
  return {...empty({businessId, generation, clientId}), debtCents: projection.totalCents - (projection.creditCents || 0), spaces: clean(spaces),
    unattributedCents: unattributed, eventCount: confirmed.length, lastEvent: cutOf(confirmed),
    baseline: {source: 'history_projection', at, cut: cutOf(confirmed), eventCount: confirmed.length}};
}
// Baseline when the history does not prove: the sum of the confirmed events, and how much
// of the registered balance they do not explain (legacy balance without events).
function fromEvents(events, {businessId, generation, clientId, client, at, reason}) {
  let account = empty({businessId, generation, clientId});
  const confirmed = events.filter(e => applicable(e, {businessId, generation}) && clientOf(e) === clientId);
  for (const e of confirmed) account = apply(account, e);
  const unexplainedCents = -cents(client?.saldo || 0) - account.debtCents;
  return {...account, baseline: {source: 'event_sum', at, cut: cutOf(confirmed), eventCount: confirmed.length, unexplainedCents, unprovableReason: reason || null}};
}
// Verification: the maintained account against the registered balance and, when the
// history proves, against the projection. Per-Space values are compared only for
// Space-scoped projections; elsewhere the split is reported as attribution, not error.
function compare(account, {client, projection, scoped, unexplainedCents = account?.baseline?.unexplainedCents || 0}) {
  const differences = [], expectedBook = -cents(client?.saldo || 0);
  if (account.debtCents + unexplainedCents !== expectedBook)
    differences.push({kind: 'balance', account: account.debtCents + unexplainedCents, expected: expectedBook});
  if (projection) {
    const total = projection.totalCents - (projection.creditCents || 0);
    if (account.debtCents !== total) differences.push({kind: 'projection_total', account: account.debtCents, expected: total});
    const proved = {}; let provedUnattributed = 0;
    for (const e of projection.entries || []) { if (e.spaceId) proved[e.spaceId] = (proved[e.spaceId] || 0) + e.remainingCents; else provedUnattributed += e.remainingCents; }
    const kind = scoped ? 'space' : 'attribution';
    for (const space of [...new Set([...Object.keys(account.spaces), ...Object.keys(proved)])].sort())
      if ((account.spaces[space] || 0) !== (proved[space] || 0)) differences.push({kind, spaceId: space, account: account.spaces[space] || 0, expected: proved[space] || 0});
    if (account.unattributedCents !== provedUnattributed) differences.push({kind, spaceId: null, account: account.unattributedCents, expected: provedUnattributed});
  }
  const errors = differences.filter(d => d.kind !== 'attribution');
  return {status: errors.length ? 'mismatch' : projection ? 'match' : 'balance_only', differences};
}
// Fase 4: one document per customer and Space that devices may read (the Rules scope it by
// Space). Only accounts classified as ready are published. A Space that left the account is
// written as zero, and an account that is no longer ready has its documents removed, so a
// device never keeps a debt the server no longer holds.
const SPACE_COLLECTION = 'customerSpaceAccounts', UNATTRIBUTED_ID = 'sem-espaco';
const PUBLISHED = new Set(['ready', 'ready_by_rule']);
const spaceDocId = (clientId, spaceId) => `${clientId}__${spaceId || UNATTRIBUTED_ID}`;
function spaceWrites(before, after, {at, financialVersion = after.clientFinancialVersion ?? null}) {
  const published = account => Boolean(account && PUBLISHED.has(account.status) && account.baseline);
  const ids = account => published(account) ? [...Object.keys(account.spaces || {}), ...(account.unattributedCents ? [null] : [])] : [];
  const previous = ids(before), next = ids(after), writes = {set: [], remove: []};
  if (!published(after)) { writes.remove = previous.map(space => spaceDocId(before.clientId, space)); return writes; }
  const value = space => space ? after.spaces[space] || 0 : after.unattributedCents || 0;
  for (const space of [...new Set([...previous, ...next])].sort((a, b) => String(a).localeCompare(String(b))))
    writes.set.push({id: spaceDocId(after.clientId, space), data: {schemaVersion: SCHEMA_VERSION, businessId: after.businessId, workspaceGeneration: after.workspaceGeneration,
      clientId: after.clientId, spaceId: space, debtCents: value(space), status: after.status, financialVersion, accountEventCount: after.eventCount, accountUpdatedAt: at}});
  return writes;
}
function writeSpaceDocs(tx, ref, businessId, before, after, at, financialVersion) {
  const writes = spaceWrites(before, after, {at, financialVersion});
  for (const row of writes.set) tx.set(ref(businessId, SPACE_COLLECTION, row.id), row.data);
  for (const id of writes.remove) tx.delete(ref(businessId, SPACE_COLLECTION, id));
  return writes;
}
module.exports = {SCHEMA_VERSION, applicable, empty, apply, includedInBaseline, fromProjection, fromEvents, compare, clientOf, spaceOf, cents,
  SPACE_COLLECTION, PUBLISHED, spaceDocId, spaceWrites, writeSpaceDocs};
