"use strict";

const { FieldValue } = require("firebase-admin/firestore");
const { providerPatch } = require("./subscription-service");
const { getPlan } = require("./plan-service");
const { counterId } = require("./coupon-firestore-service");

function firestoreSubscriptionService(db) {
  const nowIso = () => new Date().toISOString();
  async function resolveIndex(subscriptionId) {
    const snapshot = await db.doc(`subscriptionIndex/${subscriptionId}`).get();
    return snapshot.exists ? snapshot.data() : null;
  }
  async function applyProviderSubscription(provider, { source, eventId } = {}) {
    const subscriptionId = String(provider?.id || "");
    if (!subscriptionId) throw Error("Assinatura sem identificador.");
    const indexRef = db.doc(`subscriptionIndex/${subscriptionId}`),
      now = nowIso();
    return db.runTransaction(async (transaction) => {
      const indexSnapshot = await transaction.get(indexRef),
        index = indexSnapshot.data();
      if (!indexSnapshot.exists || !index?.businessId)
        throw Object.assign(Error("Assinatura sem empresa vinculada."), {
          code: "subscription-index-not-found",
        });
      const businessRef = db.doc(`businesses/${index.businessId}`),
        businessSnapshot = await transaction.get(businessRef);
      if (!businessSnapshot.exists)
        throw Error("Empresa da assinatura não encontrada.");
      const redemptionRef = index.couponRedemptionId
          ? db.doc(`couponRedemptions/${index.couponRedemptionId}`)
          : null,
        redemptionSnapshot = redemptionRef
          ? await transaction.get(redemptionRef)
          : null,
        redemption = redemptionSnapshot?.data() || null,
        providerAmount = Number(provider.auto_recurring?.transaction_amount),
        active = String(provider.status) === "authorized",
        terminal = ["cancelled", "canceled", "expired"].includes(
          String(provider.status),
        );
      if (
        active &&
        redemption &&
        (!Number.isFinite(providerAmount) ||
          Math.abs(providerAmount - Number(redemption.discountedPrice)) > 0.009)
      )
        throw Object.assign(
          Error("Valor do provedor diverge da cotação segura."),
          { code: "coupon-price-mismatch" },
        );
      const discount =
          redemption?.discountSnapshot || index.discountSnapshot || null,
        business = businessSnapshot.data(),
        subscription = providerPatch(provider, {
          planId: index.planId,
          billingCycle: index.billingCycle,
          discount: active ? discount : null,
          now,
          existing: business.subscription || {},
        }),
        plan = getPlan(subscription.planId);
      if (eventId) subscription.mercadoPago.lastWebhookEventId = eventId;
      if (active) subscription.hasPaidSubscription = true;
      if (active && redemption && redemption.status !== "active") {
        const couponRef = db.doc(`adminCoupons/${redemption.couponId}`),
          businessCounter = db.doc(
            `couponUsageCounters/${counterId(redemption.couponId, `business:${redemption.businessId}`)}`,
          ),
          userCounter = db.doc(
            `couponUsageCounters/${counterId(redemption.couponId, `user:${redemption.userId}`)}`,
          );
        const discountGranted = Math.max(
          0,
          Number(redemption.originalPrice || 0) -
            Number(redemption.discountedPrice || 0),
        );
        transaction.update(couponRef, {
          reservedCount: FieldValue.increment(-1),
          redemptionCount: FieldValue.increment(1),
          activeSubscriptions: FieldValue.increment(1),
          discountGrantedTotal: FieldValue.increment(discountGranted),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(
          businessCounter,
          {
            reserved: FieldValue.increment(-1),
            confirmed: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        transaction.set(
          userCounter,
          {
            reserved: FieldValue.increment(-1),
            confirmed: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        transaction.update(redemptionRef, {
          status: "active",
          redeemedAt: FieldValue.serverTimestamp(),
          discountGranted,
          updatedAt: FieldValue.serverTimestamp(),
        });
        subscription.discount = { ...discount };
        delete subscription.pendingDiscount;
      } else if (
        terminal &&
        redemption &&
        ["reserved", "pending_payment"].includes(redemption.status)
      ) {
        const couponRef = db.doc(`adminCoupons/${redemption.couponId}`),
          businessCounter = db.doc(
            `couponUsageCounters/${counterId(redemption.couponId, `business:${redemption.businessId}`)}`,
          ),
          userCounter = db.doc(
            `couponUsageCounters/${counterId(redemption.couponId, `user:${redemption.userId}`)}`,
          );
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
        transaction.update(redemptionRef, {
          status: "canceled",
          canceledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else if (terminal && redemption?.status === "active") {
        if (redemption.discountStatus !== "completed")
          transaction.update(db.doc(`adminCoupons/${redemption.couponId}`), {
            activeSubscriptions: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        transaction.update(redemptionRef, {
          status: "canceled",
          canceledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(businessRef, {
        subscription,
        limits: plan?.limits || business.limits || {},
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(
        db.doc(
          `businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`,
        ),
        {
          status: subscription.status,
          providerStatus: String(provider.status || ""),
          updatedAt: now,
          lastSource: source || "provider",
        },
        { merge: true },
      );
      transaction.set(
        indexRef,
        {
          ...index,
          status: subscription.status,
          providerStatus: String(provider.status || ""),
          updatedAt: now,
        },
        { merge: true },
      );
      return {
        businessId: index.businessId,
        subscription,
        redemptionId: redemptionRef?.id || null,
      };
    });
  }
  async function recordDiscountPayment(subscriptionId, eventId) {
    const markerRef = db.doc(`couponBillingEvents/${eventId}`),
      indexRef = db.doc(`subscriptionIndex/${subscriptionId}`);
    return db.runTransaction(async (transaction) => {
      const marker = await transaction.get(markerRef);
      if (marker.exists) return marker.data();
      const index = await transaction.get(indexRef);
      if (!index.exists) return { processed: false };
      const businessRef = db.doc(`businesses/${index.data().businessId}`),
        business = await transaction.get(businessRef),
        discount = business.data()?.subscription?.discount;
      if (
        !discount ||
        !["first_payment", "billing_cycles"].includes(discount.durationType) ||
        Number(discount.remainingBillingCycles || 0) <= 0
      ) {
        transaction.create(markerRef, {
          eventId,
          subscriptionId,
          status: "ignored",
          createdAt: FieldValue.serverTimestamp(),
        });
        return { processed: false };
      }
      const remaining = Math.max(
          0,
          Number(discount.remainingBillingCycles) - 1,
        ),
        restoreAmount = remaining === 0 ? Number(discount.originalPrice) : null,
        status = restoreAmount ? "restore_pending" : "processed";
      transaction.update(businessRef, {
        "subscription.discount.remainingBillingCycles": remaining,
        "subscription.discount.lastPaymentEventId": eventId,
        "subscription.discount.updatedAt": FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(markerRef, {
        eventId,
        subscriptionId,
        businessId: index.data().businessId,
        status,
        restoreAmount,
        remainingBillingCycles: remaining,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        processed: true,
        status,
        restoreAmount,
        remainingBillingCycles: remaining,
        businessId: index.data().businessId,
      };
    });
  }
  async function completeDiscountRestoration(subscriptionId, eventId) {
    const markerRef = db.doc(`couponBillingEvents/${eventId}`),
      index = await resolveIndex(subscriptionId);
    if (!index?.businessId) return;
    const businessRef = db.doc(`businesses/${index.businessId}`);
    await db.runTransaction(async (transaction) => {
      const businessSnapshot = await transaction.get(businessRef),
        discount = businessSnapshot.data()?.subscription?.discount;
      if (discount?.status !== "completed" && discount?.couponId)
        transaction.update(db.doc(`adminCoupons/${discount.couponId}`), {
          activeSubscriptions: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      transaction.set(
        markerRef,
        {
          status: "processed",
          restoredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (index.couponRedemptionId)
        transaction.set(
          db.doc(`couponRedemptions/${index.couponRedemptionId}`),
          {
            discountStatus: "completed",
            discountCompletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      transaction.update(businessRef, {
        "subscription.discount.status": "completed",
        "subscription.discount.endsAt": discount?.endsAt || nowIso(),
        "subscription.discount.restoreDueAt": FieldValue.delete(),
        "subscription.discount.updatedAt": FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  return {
    resolveIndex,
    applyProviderSubscription,
    recordDiscountPayment,
    completeDiscountRestoration,
  };
}

module.exports = { firestoreSubscriptionService };
