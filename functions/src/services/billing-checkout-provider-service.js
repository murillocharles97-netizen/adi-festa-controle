'use strict';

const { validateOrder } = require('./pix-billing-service');
const { stopped } = require('./billing-checkout-reservation-service');

const id = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ''));
const state = value => String(value || '').toLowerCase();
const unresolved = () => stopped('O Mercado Pago ainda não confirmou o resultado da contratação. Confira esta tentativa antes de pagar novamente.');
const terminated = new Set(['cancelled', 'canceled', 'expired']);
const noDebit = new Set(['cancelled', 'canceled', 'expired', 'rejected', 'failed']);
// Mercado Pago documents a ten-day default retry window, which can be adjusted
// by the invoice due date. Require a full month past every observed retry date.
const HISTORICAL_RETRY_AGE_MS = 31 * 86400_000;

function historicalRetry(invoice, cutoff) {
  const dates = [invoice.debit_date, invoice.last_modified];
  for (const key of ['next_retry_date', 'expiration_date', 'date_of_expiration', 'due_date'])
    if (invoice[key]) dates.push(invoice[key]);
  return ['recycling', 'cancelled', 'canceled'].includes(state(invoice.status))
    && dates.every(value => Date.parse(value) < cutoff);
}

async function verifyPaymentReferences(mp, externalReference, verified) {
  const seen = new Set();
  let total;
  for (let offset = 0; offset < 100; offset += 50) {
    const { paging, results } = await mp.searchPaymentsByExternalReference(externalReference, { limit: 50, offset });
    const count = Number(paging?.total);
    if (!Array.isArray(results) || !Number.isInteger(count) || count < 0 || count > 100
      || Number(paging?.offset) !== offset || Number(paging?.limit) !== 50
      || total != null && count !== total || results.length !== Math.min(50, count - offset)) return false;
    total = count;
    for (const payment of results) {
      const key = String(payment.id || '');
      if (!id(key) || seen.has(key) || payment.external_reference !== externalReference
        || verified.get(key) !== state(payment.status)) return false;
      seen.add(key);
    }
    if (seen.size === total) return seen.size === verified.size;
  }
  return false;
}

async function recoverCheckoutProvider(mp, claim) {
  const { paymentMethodType, billingPayerEmail } = claim.terms;
  const { externalReference } = claim.dispatchTerms;
  const dispatchedAt = claim.dispatchedAt?.toMillis?.();
  if (!Number.isFinite(dispatchedAt)) throw unresolved();
  const matches = new Set();
  let expectedTotal;
  const recurring = paymentMethodType === 'card';
  for (let page = 1; page <= 5; page++) {
    const result = recurring
      ? await mp.searchSubscriptions(billingPayerEmail, (page - 1) * 20)
      : await mp.searchOrders({
        externalReference,
        beginDate: new Date(dispatchedAt - 300_000).toISOString(),
        endDate: new Date(Math.min(Date.now(), dispatchedAt + 86_400_000)).toISOString(),
        page,
      });
    const rows = recurring ? result.results : result.data ?? result.results;
    const total = Number(result.paging?.total ?? result.paging?.total_count);
    if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0 || total > 100 || expectedTotal != null && expectedTotal !== total
      || rows.length !== Math.max(0, Math.min(20, total - (page - 1) * 20))) throw unresolved();
    expectedTotal = total;
    for (const row of rows) if (row.external_reference === externalReference && id(row.id)) matches.add(String(row.id));
    if (total <= page * 20) break;
  }
  if (!matches.size) return null;
  if (matches.size !== 1) throw unresolved();
  const [providerId] = matches;
  const provider = recurring ? await mp.getSubscription(providerId) : await mp.getOrder(providerId);
  if (String(provider?.id) !== providerId) throw unresolved();
  return provider;
}

function validateCheckoutProvider(provider, terms, dispatchTerms) {
  if (!id(provider?.id) || provider?.external_reference !== dispatchTerms.externalReference) throw unresolved();
  if (terms.paymentMethodType !== 'card') {
    if (provider.transactions?.payments?.length !== 1) throw unresolved();
    validateOrder(provider, {
      chargedPrice: dispatchTerms.billing.amount, expectedExternalReference: dispatchTerms.externalReference,
      paymentMethodType: terms.paymentMethodType, paymentMethodId: dispatchTerms.paymentMethodId,
    });
    return;
  }
  const recurring = provider.auto_recurring;
  if (provider.payer_email && String(provider.payer_email).toLowerCase() !== terms.billingPayerEmail
    || recurring?.currency_id !== 'BRL' || Number(recurring.transaction_amount) !== dispatchTerms.billing.amount
    || Number(recurring.frequency) !== dispatchTerms.billing.frequency
    || recurring.frequency_type !== dispatchTerms.billing.frequencyType) throw unresolved();
}

async function verifyStoppedContract(mp, subscriptionId, expectedExternalReference, { paidThrough, recordedPayment, historical = false } = {}) {
  const verified = contract => String(contract?.id) === subscriptionId && Boolean(expectedExternalReference)
    && contract.external_reference === expectedExternalReference && terminated.has(state(contract.status));
  const contract = await mp.getSubscription(subscriptionId);
  if (!verified(contract) || historical && !Number.isFinite(Date.parse(contract.last_modified))) return false;
  const cutoff = Date.now() - HISTORICAL_RETRY_AGE_MS;
  const cancelled = historical && ['cancelled', 'canceled'].includes(state(contract.status));
  let total;
  const seen = new Set();
  const payments = new Map();
  for (let offset = 0; offset < 100; offset += 10) {
    const page = await mp.searchAuthorizedPayments(subscriptionId, { limit: 10, offset });
    const size = Number(page.paging?.total);
    if (!Array.isArray(page.results) || !Number.isSafeInteger(size) || size < 0 || size > 100
      || Number(page.paging?.offset) !== offset || Number(page.paging?.limit) !== 10
      || total != null && total !== size || page.results.length !== Math.min(10, size - offset)) return false;
    total = size;
    for (const invoice of page.results) {
      if (!id(invoice.id) || seen.has(String(invoice.id)) || String(invoice.preapproval_id) !== subscriptionId) return false;
      const residual = state(invoice.status) === 'recycling' || Boolean(invoice.next_retry_date);
      if (residual) {
        if (!cancelled || !historicalRetry(invoice, cutoff) || !id(invoice.payment?.id)) return false;
        const exact = await mp.getAuthorizedPayment(String(invoice.id));
        if (String(exact.id) !== String(invoice.id) || String(exact.preapproval_id) !== subscriptionId
          || exact.status !== invoice.status || exact.last_modified !== invoice.last_modified
          || String(exact.payment?.id) !== String(invoice.payment.id) || !historicalRetry(exact, cutoff)) return false;
      } else if (!['processed', 'cancelled', 'canceled'].includes(state(invoice.status))) return false;
      seen.add(String(invoice.id));
      if (invoice.payment?.id) {
        const payment = await mp.getPayment(String(invoice.payment.id));
        if (String(payment?.id) !== String(invoice.payment.id) || !noDebit.has(state(payment.status)) && state(payment.status) !== 'approved')
          return false;
        if (historical && (payment.external_reference !== expectedExternalReference || payments.has(String(payment.id)))) return false;
        if (residual && (state(payment.status) !== 'rejected' || payment.date_approved
          || !(Date.parse(payment.date_last_updated) < cutoff))) return false;
        payments.set(String(payment.id), state(payment.status));
        if (state(payment.status) === 'approved') {
          const approvedAt = Date.parse(payment.date_approved || '');
          const paidUntil = Date.parse(paidThrough || '');
          if (!Number.isFinite(approvedAt) || !Number.isFinite(paidUntil) || approvedAt >= paidUntil
            || !recordedPayment || !await recordedPayment(String(payment.id))) return false;
        }
      } else if (state(invoice.status) === 'processed') return false;
    }
    if (seen.size === total) break;
  }
  if (historical && !await verifyPaymentReferences(mp, expectedExternalReference, payments)) return false;
  const latest = await mp.getSubscription(subscriptionId);
  return verified(latest) && latest.last_modified === contract.last_modified;
}

module.exports = { recoverCheckoutProvider, validateCheckoutProvider, verifyStoppedContract, unresolved };
