'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

const PREPARATION_LEASE_MS = 60_000;
const BLOCKING_ATTEMPTS = [
  'processing', 'pending', 'pending_payment', 'payment_pending', 'payment_challenge',
  'failed', 'payment_review_required', 'provider_not_found', 'payment_rejected', 'rejected',
];
const BLOCKING_INDEXES = [
  'pending', 'pending_payment', 'payment_pending', 'payment_challenge', 'authorized',
  'active', 'payment_review_required', 'provider_not_found', 'rejected', 'payment_rejected',
];
const REVIEW = 'checkout_review_required';
const stopped = (message, billingCode = REVIEW) => new HttpsError('failed-precondition', message, { billingCode });
const wait = () => stopped('Já existe uma contratação desta empresa. Retome o pagamento ou aguarde a conferência antes de iniciar outro.', 'checkout_in_progress');

const providerKey = (businessId, operationId) => createHash('sha256').update(JSON.stringify([businessId, operationId])).digest('hex');
const scope = s => JSON.stringify([
  s.pendingCheckoutAttemptId, s.mercadoPago?.pendingOrderId, s.mercadoPago?.subscriptionId,
  s.mercadoPago?.preapprovalId, s.lastPaymentProviderId, s.lastPaymentStatus, s.currentPeriodEnd,
  s.expiresAt, s.hasPaidSubscription, s.legacyMigration?.operationId, s.legacyMigration?.status,
]);
const contractId = s => String(s.mercadoPago?.subscriptionId || s.mercadoPago?.preapprovalId || '');
const noResource = row => row.creationOutcome === 'rejected_before_creation';
const operation = row => row.operationId || row.internalSubscriptionId;
const validOperation = op => /^[a-zA-Z0-9_-]{16,100}$/.test(op || '');
const closedContract = (proof, providerId) => proof?.outcome === 'provider_closed' && proof.providerId === providerId;
const ownerAccess = (account, user, membership, businessId) => account?.active === true && Boolean(user) &&
  (membership ? membership.status === 'active' && membership.role === 'owner' :
    account.legacyAccessDisabled !== true && user.active === true && user.role === 'owner' && user.businessId === businessId);

function billingCheckoutReservation(db, businessId) {
  const ref = db.doc(`billingCheckoutReservations/${businessId}`);
  const businessRef = db.doc(`businesses/${businessId}`);
  const attempts = businessRef.collection('billingCheckoutAttempts');
  const retired = businessRef.collection('billingCheckoutClosures');
  const contractsQuery = db.collection('subscriptionIndex').where('businessId', '==', businessId).limit(101);

  async function verifyHistoricalContracts({ excludedId, verify }) {
    const lock = (await ref.get()).data();
    if (lock && lock.stage !== 'closed') return new Map();
    const contracts = await contractsQuery.get();
    if (contracts.size >= 101) return new Map();
    const candidates = await Promise.all(contracts.docs.map(async doc => {
      const row = doc.data(), op = operation(row);
      if (doc.id === excludedId || row.status === 'payment_review_required'
        || !row.expectedExternalReference || !validOperation(op) || row.internalSubscriptionId !== op) return null;
      return closedContract((await retired.doc(op).get()).data(), doc.id) ? null : doc;
    }));
    const pending = candidates.filter(Boolean);
    if (pending.length > 10) return new Map();
    const results = await Promise.allSettled(pending.map(doc => verify(doc.id, doc.data())));
    const verified = pending.filter((_, i) => results[i].status === 'fulfilled' && results[i].value === true);
    return new Map(verified.map(doc => [doc.id, doc.updateTime]));
  }

  async function claim({ context, operationId, requestHash, terms, migrating, resumeOnly = false, checkedContractId = '', historicalContracts = new Map(), allowNewCheckout = true }) {
    return db.runTransaction(async tx => {
      const [lock, business, profile, member] = await Promise.all([
        tx.get(ref), tx.get(businessRef), tx.get(db.doc(`users/${context.uid}`)),
        tx.get(businessRef.collection('members').doc(context.uid)),
      ]);
      const current = lock.data(), account = business.data(), membership = member.data(), user = profile.data();
      if (!ownerAccess(account,user,membership,businessId)) throw new HttpsError('permission-denied', 'Acesso à cobrança da empresa negado.');
      const subscription = account.subscription || {};
      if (current && ['dispatching', 'linked'].includes(current.stage)) {
        const sameRequest = current.requestHash === requestHash;
        if (current.requestedBy !== context.uid || (!resumeOnly && !sameRequest)) throw wait();
        return current;
      }
      if (resumeOnly) throw stopped('Nenhum pagamento em andamento foi encontrado.', 'checkout_not_found');
      if (current?.stage === 'preparing' && current.preparationUntil > Date.now()) throw wait();
      if (current && !['preparing', 'closed'].includes(current.stage)) throw stopped('A reserva precisa de revisão antes de uma nova cobrança.');
      const attemptRef = attempts.doc(operationId);
      const stored = (await tx.get(attemptRef)).data();
      if (stored && stored.requestHash !== requestHash) throw stopped('Esta tentativa de checkout não corresponde à solicitação atual.');
      if (stored && !(current?.stage === 'preparing' && current.operationId === operationId)) {
        if (stored.creationOutcome === 'rejected_before_creation' && !stored.reservationGeneration) {
          throw stopped('A tentativa anterior foi encerrada. Inicie outra contratação.', 'checkout_closed');
        }
        return { existingAttempt: stored };
      }
      if (!allowNewCheckout)
        throw stopped('Novas contratações com cartão automático estão indisponíveis. Escolha Pix ou cartão mensal.', 'automatic_checkout_unavailable');
      if (scope(subscription) !== scope(context.business.subscription || {})) throw wait();
      const periodEnd = Date.parse(subscription.currentPeriodEnd || subscription.expiresAt || '');
      if (!migrating && subscription.hasPaidSubscription && (!Number.isFinite(periodEnd) || periodEnd > Date.now()))
        throw stopped('O período pago ainda está vigente. Consulte a assinatura antes de iniciar outra cobrança.', 'paid_period_active');

      const [oldAttempts, orders, contracts] = await Promise.all([
        tx.get(attempts.where('status', 'in', BLOCKING_ATTEMPTS).limit(101)),
        tx.get(db.collection('billingOrderIndex').where('businessId', '==', businessId).limit(101)),
        tx.get(contractsQuery),
      ]);
      if ([oldAttempts, orders, contracts].some(rows => rows.size >= 101))
        throw stopped('Há tentativas anteriores que precisam de conferência.');
      const prepared = current?.stage === 'preparing' ? current.operationId : null;
      const oldUnverified = oldAttempts.docs.map(row => ({ id: row.id, ...row.data() })).filter(row =>
        row.id !== prepared && !noResource(row) && !row.reservationGeneration);
      const historicalProofs = await Promise.all(oldUnverified.map(row =>
        /^[a-f0-9]{64}$/.test(row.reservationRecoveryId || '') ? tx.get(db.doc(`billingMigrationReservationHistory/${row.reservationRecoveryId}`)) : null));
      const suspectOrder = orders.docs.some(doc => BLOCKING_INDEXES.includes(doc.data().status));
      const otherContracts = contracts.docs.filter(doc => !(migrating && doc.id === contractId(subscription)));
      const contractProofs = await Promise.all(otherContracts.map(doc => {
        const op = operation(doc.data());
        return validOperation(op) ? tx.get(retired.doc(op)) : null;
      }));
      const newClosures = [], closedAttempts = new Map();
      const suspectContract = otherContracts.some((doc, i) => {
        const row = doc.data(), op = operation(row), proof = contractProofs[i]?.data();
        if (row.status === 'payment_review_required') return true;
        if (closedContract(proof, doc.id)) {
          if (proof.historicalContract === true) closedAttempts.set(op, doc.id);
          return false;
        }
        if (!proof && historicalContracts.get(doc.id)?.isEqual(doc.updateTime)) {
          newClosures.push({ op, providerId: doc.id, indexVersion: doc.updateTime });
          closedAttempts.set(op, doc.id);
          return false;
        }
        return doc.id !== checkedContractId;
      });
      const suspect = oldUnverified.some((row, i) => {
        if (row.businessId === businessId && row.subscriptionId && closedAttempts.get(row.id) === row.subscriptionId) return false;
        const proof = historicalProofs[i]?.data();
        return proof?.closed !== true || proof?.businessId !== businessId || proof?.operationId !== row.id
          || proof?.requestHash !== row.requestHash;
      });
      const closedProviderIds = [...closedAttempts.values()];
      const currentContract = contractId(subscription);
      if (!migrating && currentContract && currentContract !== checkedContractId && !closedProviderIds.includes(currentContract))
        throw stopped('Já existe uma recorrência. Confira ou encerre o contrato no Mercado Pago antes de contratar outro.', 'recurring_contract_exists');
      if (suspect || suspectOrder || suspectContract || (subscription.pendingCheckoutAttemptId && subscription.pendingCheckoutAttemptId !== current?.operationId))
        throw stopped('Uma cobrança anterior precisa ser conferida antes de iniciar outra.');

      const generation = randomUUID();
      const state = {
        businessId, operationId, requestHash, requestedBy: context.uid, terms, generation,
        stage: 'preparing', preparationUntil: Date.now() + PREPARATION_LEASE_MS, subscriptionScope: scope(subscription),
        ...(closedProviderIds.length ? { closedProviderIds } : {}),
      };
      if (prepared && prepared !== operationId)
        tx.set(attempts.doc(prepared), { status: 'failed', creationOutcome: 'rejected_before_creation', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      for (const { op, providerId, indexVersion } of newClosures)
        tx.create(retired.doc(op), { businessId, operationId: op, providerId, outcome: 'provider_closed',
          historicalContract: true, indexVersion, verifiedAt: FieldValue.serverTimestamp() });
      tx.set(ref, { ...state, updatedAt: FieldValue.serverTimestamp() });
      tx.set(attemptRef, {
        businessId, operationId, requestHash, requestedBy: context.uid, planId: terms.planId,
        billingCycle: terms.billingCycle, paymentMethodType: terms.paymentMethodType,
        ...(stored ? {} : { createdAt: FieldValue.serverTimestamp() }), status: 'processing',
        reservationGeneration: generation, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return state;
    });
  }

  async function dispatch(claim, dispatchTerms) {
    await db.runTransaction(async tx => {
      const [lock, business, profile, member] = await Promise.all([
        tx.get(ref), tx.get(businessRef), tx.get(db.doc(`users/${claim.requestedBy}`)),
        tx.get(businessRef.collection('members').doc(claim.requestedBy)),
      ]);
      const row = lock.data();
      const user = profile.data(), membership = member.data(), account = business.data();
      if (!ownerAccess(account,user,membership,businessId))
        throw new HttpsError('permission-denied', 'O acesso à cobrança mudou durante a contratação.');
      if (row?.generation !== claim.generation || row.stage !== 'preparing' || row.preparationUntil <= Date.now()
        || scope(business.data()?.subscription || {}) !== claim.subscriptionScope) throw wait();
      if (row.closedProviderIds?.length) {
        const contracts = await tx.getAll(...row.closedProviderIds.map(id => db.doc(`subscriptionIndex/${id}`)));
        if (contracts.some(doc => doc.data()?.businessId !== businessId || doc.data().status === 'payment_review_required'))
          throw stopped('Uma cobrança anterior precisa ser conferida antes de iniciar outra.');
      }
      tx.update(ref, { stage: 'dispatching', dispatchTerms, dispatchedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
  }

  async function link(claim, providerId, build) {
    return db.runTransaction(async tx => {
      const [lock, business] = await Promise.all([tx.get(ref), tx.get(businessRef)]);
      const row = lock.data();
      if (row?.generation === claim.generation && row.stage === 'linked' && row.providerId === providerId) return false;
      if (row?.generation !== claim.generation || row.stage !== 'dispatching') throw wait();
      const index = claim.terms.paymentMethodType === 'card' ? 'subscriptionIndex' : 'billingOrderIndex';
      const existing = await tx.get(db.doc(`${index}/${providerId}`));
      if (existing.exists) throw stopped('O comprovante do Mercado Pago já está vinculado e precisa de conferência.');
      if (scope(business.data()?.subscription || {}) !== claim.subscriptionScope)
        throw stopped('A assinatura mudou durante a contratação. Confira o pagamento original antes de prosseguir.');
      await build(tx, business.data());
      tx.update(ref, { stage: 'linked', providerId, linkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
  }

  async function close(claim, { outcome, providerId = null, errorCode = null, legacyProof = null }) {
    return db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (row?.generation !== claim.generation || row.stage === 'closed') return false;
      const noDispatch = outcome === 'not_dispatched';
      const rejected = outcome === 'rejected_before_creation';
      const verifiedAbsence = outcome === 'provider_confirmed_no_resource';
      if (noDispatch && row.stage !== 'preparing' || (rejected || verifiedAbsence) && row.stage !== 'dispatching' ||
          !noDispatch && !rejected && !verifiedAbsence && (outcome !== 'provider_closed' || row.stage !== 'linked' || row.providerId !== providerId)) return false;
      let legacy;
      const attemptRef = attempts.doc(claim.operationId);
      let evidence;
      if (verifiedAbsence) {
        const reference = row.dispatchTerms.externalReference;
        const [receipt, orders, contracts] = await Promise.all([
          tx.get(db.doc(`billingCheckoutProviderResolutions/${reference}`)),
          tx.get(db.collection('billingOrderIndex').where('expectedExternalReference', '==', reference).limit(1)),
          tx.get(db.collection('subscriptionIndex').where('expectedExternalReference', '==', reference).limit(1)),
        ]);
        evidence = receipt.data();
        const verifiedAt = evidence?.verifiedAt?.toMillis?.(), expiresAt = evidence?.expiresAt?.toMillis?.();
        if (!orders.empty || !contracts.empty || evidence?.outcome !== 'provider_confirmed_no_resource'
          || evidence.authority !== 'platform_admin' || evidence.businessId !== businessId
          || evidence.operationId !== row.operationId || evidence.generation !== row.generation
          || evidence.externalReference !== reference || evidence.requestHash !== row.requestHash
          || typeof evidence.providerSupportCaseId !== 'string' || evidence.providerSupportCaseId.trim().length < 6
          || !/^[a-f0-9]{64}$/.test(evidence.providerEvidenceSha256 || '')
          || !Number.isFinite(verifiedAt) || verifiedAt < row.dispatchedAt.toMillis() + 10 * 60_000
          || verifiedAt > Date.now() || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
          || expiresAt - verifiedAt > 60 * 60_000) return false;
        if (row.terms.legacyMigration) {
          const [job, business] = await Promise.all([
            tx.get(db.doc(`legacyPlanTransitions/${businessId}`)), tx.get(businessRef),
          ]);
          const source = job.data();
          if (source?.status !== 'creating' || source.operationId !== row.operationId || source.requestHash !== row.requestHash ||
            source.actorUid !== row.requestedBy || source.replacementId || source.approvedPaymentId || source.activatedAt ||
            legacyProof?.contractStatus === 'authorized') return false;
          require('./legacy-source-billing-guard').assertSourceBillingCheck({
            check: legacyProof, business: business.data(), businessId, actorUid: row.requestedBy,
            expectedSubscriptionId: source.subscriptionId,
          });
          legacy = job;
        }
      } else if (!noDispatch && !rejected) {
        const old = (await tx.get(attemptRef)).data();
        if (!['cancelled','canceled','expired','failed','rejected','abandoned','approved'].includes(old?.status)) return false;
      } else if (noDispatch && row.terms.legacyMigration) {
        legacy = await tx.get(db.doc(`legacyPlanTransitions/${businessId}`));
      }
      tx.update(ref, { stage: 'closed', outcome, updatedAt: FieldValue.serverTimestamp() });
      if (noDispatch || rejected || verifiedAbsence) {
        tx.set(attemptRef, {
          status: 'failed', creationOutcome: 'rejected_before_creation', errorCode,
          ...(rejected ? { providerCreateHttpStatus: 400 } : {}), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        if (legacy?.data()?.operationId === claim.operationId && legacy.data().status === 'creating') {
          tx.update(legacy.ref, { status: 'attempt_closed', closedAt: new Date().toISOString(), nextAttemptAt: null });
        }
        if (verifiedAbsence) tx.create(retired.doc(claim.operationId), {
          generation: claim.generation, outcome, resolutionReference: evidence.externalReference,
          providerEvidenceSha256: evidence.providerEvidenceSha256, closedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.create(retired.doc(claim.operationId), { generation: claim.generation, providerId, outcome, closedAt: FieldValue.serverTimestamp() });
      }
      return true;
    });
  }

  return { verifyHistoricalContracts, claim, dispatch, link, close };
}

module.exports = { billingCheckoutReservation, providerKey, contractId, stopped, wait };
