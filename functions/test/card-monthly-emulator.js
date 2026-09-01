'use strict';

const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {pixBillingService}=require('../src/services/pix-billing-service');
const {billingExternalReference}=require('../src/services/mercado-pago-service');

if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Este teste só pode executar no Firestore Emulator.');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT||'adi-festa-variations-test'},'card-monthly-emulator'),db=getFirestore(app),now='2026-08-31T18:00:00.000Z';

function order({id,operationId,status='action_required',detail='pending_challenge'}){
  return{id,status,status_detail:detail,total_amount:'50.34',currency:'BRL',external_reference:billingExternalReference('business-card-a',operationId),date_created:now,date_last_updated:now,transactions:{payments:[{id:`payment-${id}`,amount:'50.34',payment_method:{id:'visa',type:'credit_card',transaction_security:{url:'https://www.mercadopago.com/auth/challenge-fixture',status:status==='processed'?'authenticated':'pending'}}}]}};
}

async function seed(operationId,orderId){
  const businessRef=db.doc('businesses/business-card-a'),attemptRef=businessRef.collection('billingCheckoutAttempts').doc(operationId),expectedExternalReference=billingExternalReference('business-card-a',operationId);
  await businessRef.set({id:'business-card-a',ownerId:'owner-card-a',subscription:{status:'trialing',planId:'trial',trialEndsAt:'2026-09-10T00:00:00.000Z'}});
  await attemptRef.set({businessId:'business-card-a',requestedBy:'owner-card-a',operationId,planId:'premium',billingCycle:'monthly',paymentMethodType:'card_monthly',providerOrderId:orderId,status:'payment_challenge',chargedPrice:50.34,expectedExternalReference,paymentMethodId:'visa'});
  await db.doc(`billingOrderIndex/${orderId}`).set({businessId:'business-card-a',ownerId:'owner-card-a',operationId,planId:'premium',billingCycle:'monthly',paymentMethodType:'card_monthly',providerOrderId:orderId,chargedPrice:50.34,expectedExternalReference,paymentMethodId:'visa',status:'payment_challenge'});
  return{businessRef,attemptRef};
}

async function main(){
  const service=pixBillingService(db),operationId='operation-card-monthly-001',orderId='order-card-monthly-001',refs=await seed(operationId,orderId),challengeOrder=order({id:orderId,operationId});
  const challenge=await service.applyOrder(challengeOrder,{source:'emulator_challenge'}),before=await refs.businessRef.get();
  assert.equal(challenge.status,'payment_challenge');assert.match(challenge.attempt.challengeUrl,/mercadopago\.com/);assert.equal(before.data().subscription.status,'trialing','challenge não ativa o plano');
  const approvedOrder=order({id:orderId,operationId,status:'processed',detail:'accredited'}),approved=await service.applyOrder(approvedOrder,{source:'webhook',eventId:'card-approved'}),after=await refs.businessRef.get();
  assert.equal(approved.status,'payment_approved');assert.equal(after.data().subscription.status,'active');assert.equal(after.data().subscription.paymentMethodType,'card_monthly');assert.equal(after.data().subscription.billingStrategy,'manual_card');assert.equal(after.data().subscription.latestPayment.paymentMethod,'card');
  const periodEnd=after.data().subscription.currentPeriodEnd,replay=await service.applyOrder(approvedOrder,{source:'webhook',eventId:'card-approved-retry'}),afterReplay=await refs.businessRef.get();
  assert.equal(replay.idempotent,true);assert.equal(afterReplay.data().subscription.currentPeriodEnd,periodEnd,'webhook repetido não adiciona outro mês');
  await db.doc('businesses/business-card-b').set({id:'business-card-b',ownerId:'owner-card-b',sentinel:'isolated'});
  await assert.rejects(()=>service.applyOrder({...challengeOrder,external_reference:billingExternalReference('business-card-b',operationId)}),/Referência externa/);assert.equal((await db.doc('businesses/business-card-b').get()).data().sentinel,'isolated');
  console.log('Card monthly emulator: challenge, approved, idempotency and multiempresa OK');
}

main().then(()=>deleteApp(app)).catch(async error=>{console.error(error);await deleteApp(app);process.exitCode=1});
