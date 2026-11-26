'use strict';
// Etapa 5 — itens em aberto da conta por Espaço, mantidos evento a evento na mesma transação
// de cada operação financeira, com as mesmas regras da reconstrução por Espaço
// (fiado-history-account.project com scoped=true), sem reler o histórico:
//   items  dívidas sem parcelamento (abertura, venda Fiado, ajuste), com o restante de cada uma
//   plans  vendas parceladas: o calendário e quanto já foi pago; as parcelas saem dele no dia
// Qualquer evento que a reconstrução recusaria também é recusado aqui (lança erro); quem chama
// deixa a conta como estava e a conferência completa decide.
const Plan = require('./installment-plan'), FiadoAccount = require('./fiado-account');
const LEDGER_VERSION = 1;
const order = (a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt) ||
  String(a.historyEventId || a.saleId).localeCompare(String(b.historyEventId || b.saleId)) || (a.number ?? -1) - (b.number ?? -1);
const origin = row => row?.spaceId || row?.financialSpaceId || null;
const active = s => s.active !== false && !s.deletedAt && !s.cancelledAt && !s.desfeita;
const cents = v => Plan.cents(Math.abs(Number(v)));
const text = v => v?.toDate ? v.toDate().toISOString() : String(v || '');
const fail = message => { throw Error(message); };

// Baseline from a proven scoped projection and the history it came from.
function fromProjection(projection, input) {
  const items = projection.entries.filter(e => !Number.isInteger(e.number)).map(e => ({saleId: e.saleId || null, number: null, historyEventId: e.historyEventId || null,
    dueDate: e.dueDate, createdAt: text(e.createdAt), remainingCents: e.remainingCents, spaceId: e.spaceId || null}));
  const plans = {};
  for (const s of input.collections.sales || []) if (s.installmentPlan && active(s))
    plans[s.id] = {saleId: s.id, spaceId: origin(s), createdAt: text(s.data), installmentPlan: s.installmentPlan, paidCents: Plan.cents(s.creditPaidAmount || 0), active: true};
  return {version: LEDGER_VERSION, items: items.sort(order), plans};
}
function planRows(plan, day) {
  if (!plan.active) return [];
  return Plan.rows({installmentPlan: plan.installmentPlan, creditPaidAmount: plan.paidCents / 100}, day).filter(r => r.remainingCents)
    .map(r => ({saleId: plan.saleId, number: r.number, dueDate: r.dueDate, createdAt: plan.createdAt, remainingCents: r.remainingCents, spaceId: plan.spaceId}));
}
// Open items on a day, in the order the history consumes them (same as the reconstruction).
function entries(ledger, day) {
  return [...ledger.items.filter(e => e.remainingCents > 0).map(e => ({...e})), ...Object.values(ledger.plans).flatMap(p => planRows(p, day))].sort(order);
}
function consume(items, amount, spaceId) {
  items.sort(order);
  for (const item of items) { if (!amount) break; if (item.spaceId !== spaceId) continue; const n = Math.min(amount, item.remainingCents); item.remainingCents -= n; amount -= n; }
  if (amount) fail('Recebimento/ajuste excede as obrigações comprovadas.');
}
// One confirmed event. `source` is the sale, payment or adjustment after the operation;
// `allocations` are the payment's allocations; `day` is the business day of the operation.
function applyEvent(ledger, {event, source, allocations = [], day}) {
  const next = {version: LEDGER_VERSION, items: ledger.items.map(e => ({...e})), plans: Object.fromEntries(Object.entries(ledger.plans).map(([k, v]) => [k, {...v}]))};
  const delta = Math.round(Number(event.balanceDelta) * 100); // < 0 owes more, > 0 owes less
  if (!source) fail('Origem do evento indisponível.');
  if (!Number.isSafeInteger(delta) || !delta) fail('Evento sem efeito em centavos.');
  const spaceId = origin(source);
  if (!spaceId) fail('Evento sem Espaço.');
  if (event.type === 'credit_sale' || event.type === 'credit_sale_reversal') {
    if (event.sourceCollection !== 'sales') fail('Evento de venda sem venda.');
    if (source.installmentPlan) {
      if (event.type === 'credit_sale') { if (delta > 0) fail('Venda parcelada sem dívida.'); next.plans[source.id] = {saleId: source.id, spaceId, createdAt: text(source.data), installmentPlan: source.installmentPlan, paidCents: Plan.cents(source.creditPaidAmount || 0), active: true}; }
      else { const p = next.plans[source.id]; if (!p) fail('Parcelamento não encontrado.'); p.active = false; }
      return next;
    }
    if (delta > 0) {
      const original = next.items.find(e => e.historyEventId === 'credit_sale:' + source.id);
      if (!original || original.remainingCents < delta) fail('Reversão de dívida histórica já recebida exige revisão.');
      original.remainingCents -= delta; next.items = next.items.filter(e => e.remainingCents > 0); return next;
    }
  }
  if (delta < 0) {
    const dueDate = FiadoAccount.commercialDay(source);
    if (dueDate > day) fail('Obrigação histórica com data futura exige revisão.');
    next.items.push({saleId: event.sourceCollection === 'sales' ? source.id : null, number: null, historyEventId: event.id, dueDate,
      createdAt: text(source.data || source.financialAppliedAt), remainingCents: -delta, spaceId});
    next.items.sort(order); return next;
  }
  let amount = delta;
  if (event.sourceCollection === 'payments') for (const a of allocations) {
    const allocated = cents(a.amount); amount -= allocated;
    if (origin(a) && origin(a) !== spaceId) fail('Alocação entre espaços exige revisão.');
    const plan = next.plans[a.saleId];
    if (plan) { if (plan.spaceId !== spaceId) fail('Alocação entre espaços exige revisão.'); plan.paidCents += allocated; continue; }
    const entry = next.items.find(e => e.historyEventId === 'credit_sale:' + a.saleId);
    if (!entry || entry.spaceId !== spaceId || entry.remainingCents < allocated) fail('Alocação sem obrigação comprovada.');
    entry.remainingCents -= allocated;
  }
  if (amount < 0) fail('Alocação excede o recebimento confirmado.');
  if (amount) consume(next.items, amount, spaceId);
  // A fully paid item leaves; reversing a received sale is refused either way, as in the reconstruction.
  next.items = next.items.filter(e => e.remainingCents > 0);
  return next;
}
const same = (a, b) => JSON.stringify(a.map(e => [e.spaceId, e.saleId, e.number, e.historyEventId || null, e.dueDate, e.remainingCents])) ===
  JSON.stringify(b.map(e => [e.spaceId, e.saleId, e.number, e.historyEventId || null, e.dueDate, e.remainingCents]));
module.exports = {LEDGER_VERSION, fromProjection, entries, applyEvent, planRows, same, order};
