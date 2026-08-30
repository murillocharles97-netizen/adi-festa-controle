"use strict";

const { FieldValue } = require("firebase-admin/firestore");
const { providerPatch } = require("./subscription-service");
const { getPlan } = require("./plan-service");
const { counterId } = require("./coupon-firestore-service");

function validateProviderSubscription(provider, index, business = {}) {
  const active = String(provider?.status || "").toLowerCase() === "authorized";
  const providerAmount = Number(provider?.auto_recurring?.transaction_amount);
  const expectedAmountRaw = index?.chargedPrice ?? index?.officialPrice;
  const expectedAmount = Number(expectedAmountRaw);
  const providerPlanId = String(provider?.preapproval_plan_id || "");
  const expectedPlanId = String(index?.providerPlanId || "");
  const externalReference = String(provider?.external_reference || "");
  const expectedExternalReference = String(index?.expectedExternalReference || "");
  const metadataBusinessId = String(provider?.metadata?.business_id || "");
  const expectedBusinessId = String(index?.businessId || "");
  const currentPayerId = String(
    business?.subscription?.mercadoPago?.customerId || "",
  );
  const providerPayerId = provider?.payer_id == null
    ? ""
    : String(provider.payer_id);

  if (providerPlanId && expectedPlanId && providerPlanId !== expectedPlanId)
    throw Object.assign(Error("Plano do provedor diverge do checkout seguro."), {
      code: "provider-plan-mismatch",
    });
  if (
    externalReference &&
    expectedExternalReference &&
    externalReference !== expectedExternalReference
  )
    throw Object.assign(
      Error("Referência externa do provedor diverge do checkout seguro."),
      { code: "provider-reference-mismatch" },
    );
  if (
    metadataBusinessId &&
    expectedBusinessId &&
    metadataBusinessId !== expectedBusinessId
  )
    throw Object.assign(Error("Empresa do provedor diverge do checkout seguro."), {
      code: "provider-business-mismatch",
    });
  if (active && currentPayerId && providerPayerId && currentPayerId !== providerPayerId)
    throw Object.assign(Error("Pagador diverge da assinatura existente."), {
      code: "provider-payer-mismatch",
    });
  if (
    active &&
    expectedAmountRaw != null &&
    (!Number.isFinite(providerAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(providerAmount - expectedAmount) > 0.009)
  )
    throw Object.assign(
      Error("Valor do provedor diverge da cotação segura."),
      { code: "provider-price-mismatch" },
    );
  return { active, providerAmount, providerPayerId };
}

function firestoreSubscriptionService(db) {
  const nowIso = () => new Date().toISOString();
  async function resolveIndex(subscriptionId) {
    const snapshot = await db.doc(`subscriptionIndex/${subscriptionId}`).get();
    return snapshot.exists ? snapshot.data() : null;
  }
  async function bindSubscriptionFromPlan(provider) {
    const subscriptionId=String(provider?.id||''),providerPlanId=String(provider?.preapproval_plan_id||'');
    if(!subscriptionId)return null;
    const indexRef=db.doc(`subscriptionIndex/${subscriptionId}`),current=await indexRef.get();
    if(current.exists)return current.data();
    if(!providerPlanId)return null;
    const planIndexRef=db.doc(`subscriptionPlanIndex/${providerPlanId}`),planIndexSnapshot=await planIndexRef.get();
    if(!planIndexSnapshot.exists)return null;
    const planIndex=planIndexSnapshot.data()||{},now=nowIso();
    await db.runTransaction(async transaction=>{
      const existing=await transaction.get(indexRef);
      if(existing.exists)return;
      const freshPlanIndex=await transaction.get(planIndexRef),source=freshPlanIndex.data()||{};
      if(!freshPlanIndex.exists||!source.businessId)throw Object.assign(Error('Plano de cobrança sem empresa vinculada.'),{code:'subscription-plan-index-not-found'});
      const index={...source,subscriptionId,providerPlanId,status:'pending',providerStatus:String(provider.status||'pending'),boundAt:now,updatedAt:now};
      transaction.create(indexRef,index);
      transaction.set(db.doc(`businesses/${source.businessId}/subscriptionIntents/${subscriptionId}`),{...index,checkoutUrl:source.checkoutUrl||null,createdAt:source.createdAt||now},{merge:true});
      transaction.set(planIndexRef,{subscriptionId,status:'bound',boundAt:now,updatedAt:now},{merge:true});
      if(source.couponRedemptionId)transaction.set(db.doc(`couponRedemptions/${source.couponRedemptionId}`),{mercadoPagoSubscriptionId:subscriptionId,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    });
    return{...planIndex,subscriptionId,providerPlanId};
  }
  async function applyProviderSubscription(provider, { source, eventId } = {}) {
    const subscriptionId = String(provider?.id || "");
    if (!subscriptionId) throw Error("Assinatura sem identificador.");
    await bindSubscriptionFromPlan(provider);
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
      if (index.status === "superseded") {
        transaction.set(
          indexRef,
          {
            providerStatus: String(provider.status || ""),
            lastIgnoredSource: source || "provider",
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          db.doc(
            `businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`,
          ),
          {
            status: "superseded",
            providerStatus: String(provider.status || ""),
            lastSource: source || "provider",
            updatedAt: now,
          },
          { merge: true },
        );
        return {
          businessId: index.businessId,
          subscription: businessSnapshot.data().subscription || {},
          redemptionId: null,
          ignored: true,
          reason: "superseded",
        };
      }
      const redemptionRef = index.couponRedemptionId
          ? db.doc(`couponRedemptions/${index.couponRedemptionId}`)
          : null,
        redemptionSnapshot = redemptionRef
          ? await transaction.get(redemptionRef)
          : null,
        redemption = redemptionSnapshot?.data() || null,
        business = businessSnapshot.data(),
        currentProviderId=String(business?.subscription?.mercadoPago?.subscriptionId||''),
        isCurrentProvider=!currentProviderId||currentProviderId===subscriptionId,
        validation = validateProviderSubscription(provider, index, business),
        active = validation.active,
        terminal = ["cancelled", "canceled", "expired"].includes(
          String(provider.status),
        );
      if(active&&!isCurrentProvider)throw Object.assign(Error('Uma assinatura antiga foi autorizada enquanto outra tentativa está ativa.'),{code:'provider-subscription-conflict'});
      let couponReleased=false;
      const discount =
          redemption?.discountSnapshot || index.discountSnapshot || null,
        subscription = providerPatch(provider, {
          planId: index.planId,
          billingCycle: index.billingCycle,
          discount: active ? discount : null,
          paymentMethodType:index.paymentMethodType,
          providerPlanId:index.providerPlanId,
          now,
          existing: business.subscription || {},
        }),
        plan = getPlan(subscription.planId);
      if(terminal){delete subscription.pendingDiscount;if(business.subscription?.hasPaidSubscription!==true){subscription.mercadoPago.subscriptionId=null;subscription.mercadoPago.preapprovalId=null;subscription.mercadoPago.lastClosedSubscriptionId=subscriptionId}}
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
        couponReleased=true;
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
      const businessPatch = {
        subscription,
        limits: plan?.limits || business.limits || {},
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (active && index.billingPayerEmail)
        businessPatch["billingProfile.billingPayerEmail"] =
          index.billingPayerEmail;
      if(isCurrentProvider)transaction.update(businessRef, businessPatch);
      const attemptStatus=active?'approved':terminal?subscription.status:'pending_payment';
      transaction.set(
        db.doc(
          `businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`,
        ),
        {
          status: attemptStatus,
          providerStatus: String(provider.status || ""),
          paymentMethodType:index.paymentMethodType||"card",
          providerPlanId:index.providerPlanId||null,
          updatedAt: now,
          lastSource: source || "provider",
        },
        { merge: true },
      );
      transaction.set(
        indexRef,
        {
          ...index,
          status: attemptStatus,
          providerStatus: String(provider.status || ""),
          updatedAt: now,
        },
        { merge: true },
      );
      return {
        businessId: index.businessId,
        subscription:isCurrentProvider?subscription:(business.subscription||{}),
        redemptionId: redemptionRef?.id || null,
        couponReleased,
        ignoredBusinessUpdate:!isCurrentProvider,
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
  async function recordPaymentEvent(subscriptionId,eventId,result={}){
    const markerRef=db.doc(`subscriptionPaymentEvents/${eventId}`),indexRef=db.doc(`subscriptionIndex/${subscriptionId}`);
    return db.runTransaction(async transaction=>{
      const marker=await transaction.get(markerRef);
      if(marker.exists)return marker.data();
      const indexSnapshot=await transaction.get(indexRef),index=indexSnapshot.data()||{};
      if(!indexSnapshot.exists||!index.businessId)return{processed:false};
      const businessRef=db.doc(`businesses/${index.businessId}`),businessSnapshot=await transaction.get(businessRef),subscription=businessSnapshot.data()?.subscription||{},successful=result.successful===true,paymentMethodType=index.paymentMethodType||subscription.paymentMethodType||'card',patch={'subscription.lastPaymentStatus':String(result.status||'unknown'),'subscription.lastPaymentStatusDetail':String(result.statusDetail||'')||null,'subscription.lastPaymentEventId':eventId,'subscription.lastPaymentProviderId':result.paymentId||null,'subscription.updatedAt':nowIso(),updatedAt:FieldValue.serverTimestamp()};
      if(successful)patch['subscription.lastPaymentDate']=nowIso();
      else if(paymentMethodType==='pix_monthly'&&subscription.status==='active')patch['subscription.status']='payment_pending';
      transaction.update(businessRef,patch);
      const row={eventId,subscriptionId,businessId:index.businessId,paymentMethodType,successful,status:String(result.status||'unknown'),statusDetail:String(result.statusDetail||'')||null,paymentId:result.paymentId||null,paymentMethodId:String(result.paymentMethodId||'')||null,paymentTypeId:String(result.paymentTypeId||'')||null,createdAt:FieldValue.serverTimestamp()};
      transaction.create(markerRef,row);
      return{processed:true,...row};
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
    bindSubscriptionFromPlan,
    applyProviderSubscription,
    recordPaymentEvent,
    recordDiscountPayment,
    completeDiscountRestoration,
  };
}

module.exports = { firestoreSubscriptionService, validateProviderSubscription };
