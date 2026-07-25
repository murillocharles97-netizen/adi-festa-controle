'use strict';

const {FieldValue}=require('firebase-admin/firestore');
const {providerPatch}=require('./subscription-service');
const {getPlan}=require('./plan-service');

function firestoreSubscriptionService(db){
  const nowIso=()=>new Date().toISOString();
  async function resolveIndex(subscriptionId){
    const snapshot=await db.doc(`subscriptionIndex/${subscriptionId}`).get();
    return snapshot.exists?snapshot.data():null;
  }
  async function applyProviderSubscription(provider,{source,eventId}={}){
    const subscriptionId=String(provider?.id||'');if(!subscriptionId)throw Error('Assinatura sem identificador.');
    const index=await resolveIndex(subscriptionId);if(!index?.businessId)throw Object.assign(Error('Assinatura sem empresa vinculada.'),{code:'subscription-index-not-found'});
    const businessRef=db.doc(`businesses/${index.businessId}`),businessSnapshot=await businessRef.get();if(!businessSnapshot.exists)throw Error('Empresa da assinatura não encontrada.');
    const business=businessSnapshot.data(),now=nowIso(),subscription=providerPatch(provider,{planId:index.planId,now,existing:business.subscription||{}}),plan=getPlan(subscription.planId);
    if(eventId)subscription.mercadoPago.lastWebhookEventId=eventId;
    const batch=db.batch();batch.update(businessRef,{subscription,limits:plan?.limits||business.limits||{},updatedAt:FieldValue.serverTimestamp()});batch.set(db.doc(`businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`),{status:subscription.status,providerStatus:String(provider.status||''),updatedAt:now,lastSource:source||'provider'},{merge:true});batch.set(db.doc(`subscriptionIndex/${subscriptionId}`),{...index,status:subscription.status,providerStatus:String(provider.status||''),updatedAt:now},{merge:true});await batch.commit();
    return{businessId:index.businessId,subscription};
  }
  return{resolveIndex,applyProviderSubscription};
}

module.exports={firestoreSubscriptionService};
