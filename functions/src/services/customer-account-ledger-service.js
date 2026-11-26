'use strict';
// Etapa 5 — a conta por Espaço acompanha cada operação financeira na mesma transação.
// Quem grava um evento do razão (venda, recebimento, cancelamento, ajuste) chama prepare()
// antes da primeira gravação da transação, com os eventos e as origens já como ficarão. Se a
// conta estiver em dia com o cliente (mesma versão financeira) e os itens em aberto seguirem as
// regras da reconstrução por Espaço, devolve quem grava a conta nessa mesma transação, com o
// marcador de cada evento (o gatilho o reconhece e não reconstrói o histórico). Em qualquer
// outro caso devolve null: nada muda na operação, e o gatilho e a conferência completa decidem.
const Account = require('../shared/customer-account');
const Ledger = require('../shared/customer-account-ledger');
const Plan = require('../shared/installment-plan');
const TRANSACTIONAL_ENABLED = true; // false: accounts follow operations only through the trigger, as before.
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : v?.toDate ? v.toDate().toISOString() : null;

// `create`: a customer opened natively in this very transaction (Etapa 1) starts an empty account here.
async function prepare({tx, ref, businessId, generation, clientId, versionBefore, versionAfter, changes, at, create = false, enabled = TRANSACTIONAL_ENABLED}) {
  if (!enabled || !clientId || !changes?.length) return null;
  const accountRef = ref(businessId, 'customerAccounts', clientId), existing = (await tx.get(accountRef)).data();
  const stored = existing || (create && versionBefore === 0 ? {...Account.empty({businessId, generation, clientId}), status: 'ready',
    baseline: {source: 'native', at, cut: null, eventCount: 0}, ledger: {version: Ledger.LEDGER_VERSION, items: [], plans: {}}, ledgerVersion: Ledger.LEDGER_VERSION, clientFinancialVersion: 0} : null);
  if (!stored || stored.schemaVersion !== Account.SCHEMA_VERSION || stored.workspaceGeneration !== generation || stored.clientId !== clientId ||
      !Account.PUBLISHED.has(stored.status) || !stored.baseline || stored.ledgerVersion !== Ledger.LEDGER_VERSION || !stored.ledger ||
      !Number.isSafeInteger(versionBefore) || stored.clientFinancialVersion !== versionBefore || !Number.isSafeInteger(versionAfter) || versionAfter <= versionBefore) return null;
  const day = Plan.today(new Date(at));
  let account = stored, ledger = stored.ledger;
  const events = [];
  try {
    for (const {event, source, allocations} of changes) {
      const ev = {...event, appliedAt: iso(event.appliedAt) || at};
      if (!Account.applicable(ev, {businessId, generation}) || Account.clientOf(ev) !== clientId) return null;
      ledger = Ledger.applyEvent(ledger, {event: ev, source, allocations, day});
      account = Account.apply(account, ev);
      events.push(ev);
    }
  } catch { return null; }
  // The open items must add up to the account of each Space; otherwise the full check decides.
  const sums = {};
  for (const e of Ledger.entries(ledger, day)) sums[e.spaceId] = (sums[e.spaceId] || 0) + e.remainingCents;
  const spaces = account.spaces || {};
  if (account.unattributedCents || [...new Set([...Object.keys(sums), ...Object.keys(spaces)])].some(s => (sums[s] || 0) !== (spaces[s] || 0))) return null;
  const next = {...account, ledger, ledgerVersion: Ledger.LEDGER_VERSION, clientFinancialVersion: versionAfter, updatedAt: at, ledgerUpdatedAt: at};
  return writer => {
    writer.set(accountRef, next);
    Account.writeSpaceDocs(writer, ref, businessId, existing, next, at);
    for (const ev of events) writer.set(accountRef.collection('appliedEvents').doc(ev.id), {eventId: ev.id, at, inBaseline: false, source: 'transactional',
      owedCents: -Account.cents(ev.balanceDelta), spaceId: Account.spaceOf(ev)});
  };
}
module.exports = {prepare, TRANSACTIONAL_ENABLED};
