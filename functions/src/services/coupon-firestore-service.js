"use strict";

const crypto = require("node:crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  CouponError,
  normalizeCouponCode,
  couponCodeKey,
  deriveCouponStatus,
  normalizeCouponDefinition,
  validateCouponUse,
  durationLabel,
  discountSnapshot,
  toDate,
} = require("./coupon-service");

const INTERNAL_BUSINESS_ID = "adi-festa";
const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const counterId = (couponId, subject) =>
  `${couponId}_${crypto.createHash("sha256").update(String(subject)).digest("hex").slice(0, 32)}`;
const safeCoupon = (coupon) => ({
  id: coupon.id,
  code: coupon.code,
  name: coupon.name,
  campaign: coupon.campaign || "",
  category: coupon.category,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  durationType: coupon.durationType,
  billingCycles: coupon.billingCycles || null,
  allowedPlanIds: coupon.allowedPlanIds,
  allowedBillingCycles: coupon.allowedBillingCycles,
  validFrom: coupon.validFrom || null,
  validUntil: coupon.validUntil || null,
  maxRedemptions: coupon.maxRedemptions ?? null,
  redemptionCount: Number(coupon.redemptionCount || 0),
  reservedCount: Number(coupon.reservedCount || 0),
  activeSubscriptions: Number(coupon.activeSubscriptions || 0),
  discountGrantedTotal: Number(coupon.discountGrantedTotal || 0),
  status: deriveCouponStatus(coupon),
  version: Number(coupon.version || 1),
  createdAt: coupon.createdAt || null,
  updatedAt: coupon.updatedAt || null,
});

function couponFirestoreService(db) {
  function assertInternal(context) {
    const trustedInternal =
      context?.business?.id === INTERNAL_BUSINESS_ID &&
      context.business?.subscription?.planId === "internal" &&
      ["active", "internal"].includes(context.business?.subscription?.status);
    if (
      !trustedInternal ||
      context.profile?.role !== "owner" ||
      context.business?.ownerId !== context.uid
    )
      throw new CouponError(
        "permission_denied",
        "Somente a conta interna autorizada pode administrar cupons.",
      );
  }
  function audit(transaction, { actorUid, action, couponId, diff = {} }) {
    const ref = db.doc(`couponAuditLogs/${id()}`),
      safeDiff = Object.fromEntries(
        Object.entries(diff).filter(
          ([key]) => !["authorizedEmails", "authorizedUids"].includes(key),
        ),
      );
    transaction.create(ref, {
      actorUid,
      action,
      couponId,
      timestamp: FieldValue.serverTimestamp(),
      diff: safeDiff,
      build: "subscription-coupons-v1",
    });
  }
  async function saveCoupon({ context, input, couponId }) {
    assertInternal(context);
    const ref = couponId
        ? db.doc(`adminCoupons/${couponId}`)
        : db.doc(`adminCoupons/${id()}`),
      now = iso();
    return db.runTransaction(async (transaction) => {
      const priorSnapshot = await transaction.get(ref),
        prior = priorSnapshot.exists
          ? { id: ref.id, ...priorSnapshot.data() }
          : {};
      const normalized = normalizeCouponDefinition(input, prior),
        codeRef = db.doc(`adminCouponCodes/${couponCodeKey(normalized.code)}`),
        codeSnapshot = await transaction.get(codeRef),
        owner = codeSnapshot.data()?.couponId;
      if (prior.status === "ended" || prior.endedAt) {
        normalized.status = "ended";
        normalized.endedAt = prior.endedAt;
      }
      if (owner && owner !== ref.id)
        throw new CouponError(
          "duplicate_code",
          "Já existe um cupom com este código.",
        );
      if (prior.code && prior.code !== normalized.code) {
        const oldCodeRef = db.doc(
            `adminCouponCodes/${couponCodeKey(prior.code)}`,
          ),
          oldCode = await transaction.get(oldCodeRef);
        if (oldCode.data()?.couponId === ref.id) transaction.delete(oldCodeRef);
      }
      const critical = [
        "discountType",
        "discountValue",
        "durationType",
        "billingCycles",
        "discountEndsAt",
        "allowedPlanIds",
        "allowedBillingCycles",
        "maxRedemptions",
        "maxUsesPerBusiness",
        "maxUsesPerUser",
        "authorizedEmails",
        "authorizedUids",
        "authorizedBusinessIds",
        "authorizedEmailDomains",
        "newSubscribersOnly",
        "inactiveSubscriptionsOnly",
        "allowUpgrade",
        "allowDowngrade",
        "firstPaidSubscriptionOnly",
        "businessCreatedAfter",
      ];
      const changed =
          priorSnapshot.exists &&
          critical.some(
            (key) =>
              JSON.stringify(prior[key] ?? null) !==
              JSON.stringify(normalized[key] ?? null),
          ),
        version = priorSnapshot.exists
          ? Number(prior.version || 1) + (changed ? 1 : 0)
          : 1,
        coupon = {
          ...normalized,
          id: ref.id,
          version,
          redemptionCount: Number(prior.redemptionCount || 0),
          reservedCount: Number(prior.reservedCount || 0),
          activeSubscriptions: Number(prior.activeSubscriptions || 0),
          discountGrantedTotal: Number(prior.discountGrantedTotal || 0),
          createdBy: prior.createdBy || context.uid,
          createdAt: prior.createdAt || now,
          updatedBy: context.uid,
          updatedAt: now,
          schemaVersion: 1,
        };
      transaction.set(ref, coupon);
      transaction.set(codeRef, {
        couponId: ref.id,
        code: normalized.code,
        updatedAt: FieldValue.serverTimestamp(),
      });
      audit(transaction, {
        actorUid: context.uid,
        action: priorSnapshot.exists ? "updated" : "created",
        couponId: ref.id,
        diff: { version, status: coupon.status, criticalChanged: changed },
      });
      return safeCoupon(coupon);
    });
  }
  async function listCoupons({ context, limit = 30, cursor = null }) {
    assertInternal(context);
    let query = db
      .collection("adminCoupons")
      .orderBy("createdAt", "desc")
      .limit(Math.min(50, Math.max(1, Number(limit) || 30)));
    if (cursor) {
      const snap = await db.doc(`adminCoupons/${cursor}`).get();
      if (snap.exists) query = query.startAfter(snap);
    }
    const snapshot = await query.get(),
      items = snapshot.docs.map((doc) =>
        safeCoupon({ id: doc.id, ...doc.data() }),
      );
    return {
      items,
      nextCursor:
        snapshot.size === Math.min(50, Math.max(1, Number(limit) || 30))
          ? snapshot.docs.at(-1).id
          : null,
      summary: items.reduce(
        (out, item) => {
          out[item.status] = (out[item.status] || 0) + 1;
          out.redemptions += item.redemptionCount;
          return out;
        },
        {
          active: 0,
          scheduled: 0,
          expired: 0,
          ended: 0,
          paused: 0,
          draft: 0,
          redemptions: 0,
        },
      ),
    };
  }
  async function couponDetails({ context, couponId }) {
    assertInternal(context);
    const [couponSnapshot, redemptions] = await Promise.all([
      db.doc(`adminCoupons/${couponId}`).get(),
      db
        .collection("couponRedemptions")
        .where("couponId", "==", couponId)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get(),
    ]);
    if (!couponSnapshot.exists) throw new CouponError("not_found");
    const coupon = { id: couponSnapshot.id, ...couponSnapshot.data() },
      uses = redemptions.docs.map((doc) => {
        const row = doc.data();
        return {
          id: doc.id,
          businessId: row.businessId,
          planId: row.planId,
          billingCycle: row.billingCycle,
          originalPrice: row.originalPrice,
          discountedPrice: row.discountedPrice,
          status: row.status,
          createdAt: row.createdAt,
        };
      });
    return {
      coupon: {
        ...coupon,
        status: deriveCouponStatus(coupon),
        authorizedEmailsCount: coupon.authorizedEmails?.length || 0,
        authorizedUidsCount: coupon.authorizedUids?.length || 0,
      },
      uses,
    };
  }
  async function actionCoupon({ context, couponId, action }) {
    assertInternal(context);
    if (!["pause", "reactivate", "end"].includes(action))
      throw new CouponError("invalid");
    const ref = db.doc(`adminCoupons/${couponId}`),
      now = iso();
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new CouponError("not_found");
      const coupon = { id: ref.id, ...snapshot.data() },
        patch =
          action === "pause"
            ? { status: "paused", pausedAt: now }
            : action === "reactivate"
              ? { status: "active", pausedAt: null, endedAt: null }
              : { status: "ended", endedAt: now };
      if ((coupon.status === "ended" || coupon.endedAt) && action !== "end")
        throw new CouponError("ended");
      transaction.update(ref, {
        ...patch,
        updatedBy: context.uid,
        updatedAt: now,
      });
      audit(transaction, {
        actorUid: context.uid,
        action,
        couponId,
        diff: patch,
      });
      return {
        ...safeCoupon({ ...coupon, ...patch }),
        status: deriveCouponStatus({ ...coupon, ...patch }),
      };
    });
  }
  async function duplicateCoupon({ context, couponId, code }) {
    assertInternal(context);
    const snapshot = await db.doc(`adminCoupons/${couponId}`).get();
    if (!snapshot.exists) throw new CouponError("not_found");
    const source = snapshot.data(),
      copy = {
        ...source,
        id: undefined,
        code: normalizeCouponCode(code),
        name: `${source.name} — cópia`,
        status: "draft",
        redemptionCount: 0,
        reservedCount: 0,
        createdAt: undefined,
        createdBy: undefined,
        updatedAt: undefined,
        updatedBy: undefined,
        version: 1,
      };
    const result = await saveCoupon({ context, input: copy });
    await db.collection("couponAuditLogs").add({
      actorUid: context.uid,
      action: "duplicated",
      couponId: result.id,
      sourceCouponId: couponId,
      timestamp: FieldValue.serverTimestamp(),
      diff: { sourceCouponId: couponId },
      build: "subscription-coupons-v1",
    });
    return result;
  }
  async function loadCouponByCode(code) {
    const normalized = normalizeCouponCode(code);
    if (!normalized) return null;
    const index = await db
      .doc(`adminCouponCodes/${couponCodeKey(normalized)}`)
      .get();
    if (!index.exists) return null;
    const snapshot = await db
      .doc(`adminCoupons/${index.data().couponId}`)
      .get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  }
  function refs(couponId, businessId, uid) {
    return {
      businessCounter: db.doc(
        `couponUsageCounters/${counterId(couponId, `business:${businessId}`)}`,
      ),
      userCounter: db.doc(
        `couponUsageCounters/${counterId(couponId, `user:${uid}`)}`,
      ),
    };
  }
  async function validateAndQuote({ context, code, planId, billingCycle }) {
    if (context.business.subscription?.planId === "internal")
      throw new CouponError(
        "plan_incompatible",
        "A conta interna não utiliza cupons.",
      );
    const coupon = await loadCouponByCode(code);
    if (!coupon) throw new CouponError("not_found");
    const { businessCounter, userCounter } = refs(
        coupon.id,
        context.business.id,
        context.uid,
      ),
      [businessCount, userCount] = await Promise.all([
        businessCounter.get(),
        userCounter.get(),
      ]);
    const current = coupon,
      validated = validateCouponUse({
        coupon: current,
        planId,
        billingCycle,
        business: context.business,
        uid: context.uid,
        email: context.email,
        globalCounts: {
          confirmed: current.redemptionCount,
          reserved: current.reservedCount,
        },
        businessCounts: businessCount.data() || {},
        userCounts: userCount.data() || {},
      }),
      quoteId = id(),
      expiresAt = new Date(Date.now() + 15 * 60 * 1000),
      snapshot = discountSnapshot(current, validated.billing),
      quote = {
        id: quoteId,
        couponId: current.id,
        couponVersion: Number(current.version || 1),
        businessId: context.business.id,
        userId: context.uid,
        planId: validated.plan.id,
        billingCycle,
        originalPrice: validated.billing.originalPrice,
        discountedPrice: validated.billing.discountedPrice,
        savings: validated.billing.savings,
        discountSnapshot: snapshot,
        expiresAt: Timestamp.fromDate(expiresAt),
        usedAt: null,
        status: "valid",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
    await db.doc(`couponQuotes/${quoteId}`).create(quote);
    return {
      valid: true,
      couponPublicId: current.id,
      code: current.code,
      discountType: current.discountType,
      durationLabel: durationLabel(current),
      originalPrice: quote.originalPrice,
      discountedPrice: quote.discountedPrice,
      savings: quote.savings,
      planId: quote.planId,
      billingCycle,
      quoteId,
      expiresAt: expiresAt.toISOString(),
    };
  }
  async function reserveQuote({ quoteId, context, planId, billingCycle }) {
    if (!quoteId) return null;
    const quoteRef = db.doc(`couponQuotes/${quoteId}`),
      redemptionRef = db.doc(`couponRedemptions/${quoteId}`),
      now = Timestamp.now();
    return db.runTransaction(async (transaction) => {
      const quoteSnapshot = await transaction.get(quoteRef);
      if (!quoteSnapshot.exists) throw new CouponError("quote_expired");
      const quote = quoteSnapshot.data();
      if (
        quote.businessId !== context.business.id ||
        quote.userId !== context.uid ||
        quote.planId !== planId ||
        quote.billingCycle !== billingCycle
      )
        throw new CouponError("quote_expired");
      if (quote.expiresAt.toMillis() <= now.toMillis())
        throw new CouponError("quote_expired");
      const existing = await transaction.get(redemptionRef);
      if (
        existing.exists &&
        ["reserved", "pending_payment", "active"].includes(
          existing.data().status,
        )
      )
        return { id: redemptionRef.id, ...existing.data(), idempotent: true };
      if (quote.status !== "valid") throw new CouponError("quote_expired");
      const couponRef = db.doc(`adminCoupons/${quote.couponId}`),
        couponSnapshot = await transaction.get(couponRef);
      if (!couponSnapshot.exists) throw new CouponError("not_found");
      const coupon = { id: couponSnapshot.id, ...couponSnapshot.data() },
        { businessCounter, userCounter } = refs(
          coupon.id,
          context.business.id,
          context.uid,
        ),
        businessSnapshot = await transaction.get(businessCounter),
        userSnapshot = await transaction.get(userCounter);
      validateCouponUse({
        coupon,
        planId,
        billingCycle,
        business: context.business,
        uid: context.uid,
        email: context.email,
        globalCounts: {
          confirmed: coupon.redemptionCount,
          reserved: coupon.reservedCount,
        },
        businessCounts: businessSnapshot.data() || {},
        userCounts: userSnapshot.data() || {},
      });
      if (Number(coupon.version || 1) !== Number(quote.couponVersion))
        throw new CouponError("quote_expired");
      const redemption = {
        id: redemptionRef.id,
        couponId: coupon.id,
        couponCodeSnapshot: coupon.code,
        couponVersion: Number(coupon.version || 1),
        businessId: context.business.id,
        userId: context.uid,
        planId,
        billingCycle,
        originalPrice: quote.originalPrice,
        discountedPrice: quote.discountedPrice,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        durationType: coupon.durationType,
        billingCycles: coupon.billingCycles || null,
        validWhileSubscriptionActive:
          coupon.durationType === "while_subscription_active",
        discountSnapshot: quote.discountSnapshot,
        status: "reserved",
        reservedAt: now,
        redeemedAt: null,
        canceledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      transaction.create(redemptionRef, redemption);
      transaction.update(couponRef, {
        reservedCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        businessCounter,
        {
          couponId: coupon.id,
          subjectType: "business",
          subjectId: context.business.id,
          reserved: FieldValue.increment(1),
          confirmed: FieldValue.increment(0),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        userCounter,
        {
          couponId: coupon.id,
          subjectType: "user",
          subjectId: context.uid,
          reserved: FieldValue.increment(1),
          confirmed: FieldValue.increment(0),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.update(quoteRef, {
        status: "reserved",
        usedAt: now,
        updatedAt: now,
      });
      return redemption;
    });
  }
  async function markCheckout({
    redemptionId,
    subscriptionId,
    internalSubscriptionId,
    providerPlanId,
  }) {
    if (!redemptionId) return;
    await db.doc(`couponRedemptions/${redemptionId}`).set(
      {
        status: "pending_payment",
        mercadoPagoSubscriptionId: subscriptionId,
        mercadoPagoPlanId: providerPlanId || null,
        internalSubscriptionId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  async function releaseReservation(redemptionId, reason = "checkout_failed") {
    if (!redemptionId) return;
    const redemptionRef = db.doc(`couponRedemptions/${redemptionId}`);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(redemptionRef);
      if (
        !snapshot.exists ||
        !["reserved", "pending_payment"].includes(snapshot.data().status)
      )
        return;
      const row = snapshot.data(),
        couponRef = db.doc(`adminCoupons/${row.couponId}`),
        { businessCounter, userCounter } = refs(
          row.couponId,
          row.businessId,
          row.userId,
        );
      transaction.update(redemptionRef, {
        status: "failed",
        failureReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(couponRef, {
        reservedCount: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        businessCounter,
        {
          reserved: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        userCounter,
        {
          reserved: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }
  return {
    assertInternal,
    saveCoupon,
    listCoupons,
    couponDetails,
    actionCoupon,
    duplicateCoupon,
    loadCouponByCode,
    validateAndQuote,
    reserveQuote,
    markCheckout,
    releaseReservation,
    refs,
    safeCoupon,
  };
}

module.exports = {
  couponFirestoreService,
  INTERNAL_BUSINESS_ID,
  counterId,
  safeCoupon,
};
