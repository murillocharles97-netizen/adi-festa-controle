'use strict';

const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {pixBillingService}=require('../src/services/pix-billing-service');

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Este teste só pode executar no Firestore Emulator.');

const app=initializeApp({projectId:process.env.GCLOUD_PROJECT||'adi-festa-variations-test'},'pix-billing-emulator');
const db=getFirestore(app);
const now='2026-08-25T12:00:00.000Z';

function order({id,operationId,amount='39.92',status='action_required',detail='waiting_transfer'}){
  return{id,status,status_detail:detail,total_amount:amount,currency:'BRL',external_reference:`billing:business-a:${operationId}`,date_created:now,date_last_updated:now,transactions:{payments:[{id:`payment-${id}`,amount,payment_method:{id:'pix',type:'bank_transfer',qr_code:`pix-code-${id}`,qr_code_base64:'fixture-base64',ticket_url:`https://example.invalid/${id}`},expiration_time:'2026-08-26T12:00:00.000Z'}]}};
}

async function seedAttempt({operationId,orderId,couponId='coupon-fixture',redemptionId=`redemption-${orderId}`}){
  const businessRef=db.doc('businesses/business-a'),attemptRef=businessRef.collection('billingCheckoutAttempts').doc(operationId);
  await businessRef.set({id:'business-a',ownerId:'owner-a',active:true,subscription:{planId:'trial',status:'trialing',trialEndsAt:'2026-09-01T12:00:00.000Z'}});
  await attemptRef.set({businessId:'business-a',requestedBy:'owner-a',operationId,planId:'professional',billingCycle:'monthly',paymentMethodType:'pix_monthly',providerOrderId:orderId,status:'payment_pending',chargedPrice:39.92,finalAmount:39.92,originalAmount:49.9,discountAmount:9.98,expectedExternalReference:`billing:business-a:${operationId}`,couponRedemptionId:redemptionId,couponSnapshot:{couponId,code:'PARCEIRO20',discountType:'percentage',discountValue:20,originalPrice:49.9,discountedPrice:39.92},qrCode:`pix-code-${orderId}`,qrCodeBase64:'fixture-base64',ticketUrl:`https://example.invalid/${orderId}`});
  await db.doc(`billingOrderIndex/${orderId}`).set({businessId:'business-a',ownerId:'owner-a',operationId,planId:'professional',billingCycle:'monthly',paymentMethodType:'pix_monthly',providerOrderId:orderId,chargedPrice:39.92,expectedExternalReference:`billing:business-a:${operationId}`,couponRedemptionId:redemptionId,discountSnapshot:{couponId,code:'PARCEIRO20',discountType:'percentage',discountValue:20,originalPrice:49.9,discountedPrice:39.92},status:'payment_pending'});
  await db.doc(`adminCoupons/${couponId}`).set({id:couponId,reservedCount:1,redemptionCount:0,activeSubscriptions:0,discountGrantedTotal:0});
  await db.doc(`couponRedemptions/${redemptionId}`).set({id:redemptionId,couponId,businessId:'business-a',userId:'owner-a',status:'pending_payment',originalPrice:49.9,discountedPrice:39.92,discountSnapshot:{couponId,code:'PARCEIRO20',discountType:'percentage',discountValue:20,originalPrice:49.9,discountedPrice:39.92}});
  return{businessRef,attemptRef,redemptionId,couponId};
}

async function main(){
  const service=pixBillingService(db),first=await seedAttempt({operationId:'operation-pix-approved-001',orderId:'order-approved-001'}),pendingOrder=order({id:'order-approved-001',operationId:'operation-pix-approved-001'});
  const pending=await service.applyOrder(pendingOrder,{source:'emulator_pending'}),before=await first.businessRef.get();
  assert.equal(pending.status,'payment_pending');
  assert.equal(before.data().subscription.status,'trialing','gerar QR não ativa o plano');

  const approvedOrder={...pendingOrder,status:'processed',status_detail:'accredited'};
  const approved=await service.applyOrder(approvedOrder,{source:'webhook',eventId:'event-approved-001'}),businessAfter=await first.businessRef.get(),attemptAfter=await first.attemptRef.get(),couponAfter=await db.doc(`adminCoupons/${first.couponId}`).get(),redemptionAfter=await db.doc(`couponRedemptions/${first.redemptionId}`).get();
  assert.equal(approved.status,'payment_approved');
  assert.equal(businessAfter.data().subscription.status,'active');
  assert.equal(businessAfter.data().subscription.paymentMethodType,'pix_monthly');
  assert.equal(businessAfter.data().subscription.latestPayment.amount,39.92);
  assert.equal(businessAfter.data().subscription.discount.code,'PARCEIRO20');
  assert.equal(attemptAfter.data().qrCode,undefined,'QR é removido após aprovação');
  assert.equal(couponAfter.data().redemptionCount,1);
  assert.equal(redemptionAfter.data().status,'active');

  const periodEnd=businessAfter.data().subscription.currentPeriodEnd,replay=await service.applyOrder(approvedOrder,{source:'webhook',eventId:'event-approved-retry'}),businessReplay=await first.businessRef.get();
  assert.equal(replay.idempotent,true);
  assert.equal(businessReplay.data().subscription.currentPeriodEnd,periodEnd,'webhook repetido não adiciona outro período');
  assert.equal((await db.collection('billingPaymentEvents').get()).size,1);

  const expiredSeed=await seedAttempt({operationId:'operation-pix-expired-002',orderId:'order-expired-002',couponId:'coupon-expired',redemptionId:'redemption-expired'}),expiredOrder=order({id:'order-expired-002',operationId:'operation-pix-expired-002',status:'expired',detail:'expired'}),expired=await service.applyOrder(expiredOrder,{source:'webhook',eventId:'event-expired-002'}),expiredAttempt=await expiredSeed.attemptRef.get(),expiredRedemption=await db.doc('couponRedemptions/redemption-expired').get();
  assert.equal(expired.status,'expired');
  assert.equal(expiredAttempt.data().qrCode,undefined);
  assert.equal(expiredRedemption.data().status,'failed','Pix expirado libera a reserva do cupom');

  await assert.rejects(()=>service.applyOrder({...order({id:'order-approved-001',operationId:'operation-pix-approved-001'}),external_reference:'billing:business-b:operation-pix-approved-001'}),/Referência externa/);
  console.log('Pix billing emulator: pending, coupon, approved, duplicate, expired and tenant validation OK');
}

main().then(()=>deleteApp(app)).catch(async error=>{console.error(error);await deleteApp(app);process.exitCode=1});
