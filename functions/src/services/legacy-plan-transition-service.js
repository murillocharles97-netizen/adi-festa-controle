'use strict';
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {logger}=require('firebase-functions');
const Catalog=require('../shared/plan-catalog');
const crypto=require('node:crypto');
const {idFor}=require('./legacy-checkout-recovery-service');
const messages={'legacy-migration-in-progress':'Uma troca já está em andamento. Verifique ou encerre a tentativa anterior antes de iniciar outra.','legacy-migration-request-conflict':'Esta tentativa já está vinculada a outro checkout. Nenhuma cobrança adicional foi criada.','legacy-paid-period-unverified':'Precisamos confirmar o período já pago antes de iniciar a troca.','legacy-migration-consent-required':'Confirme a troca voluntária na tela de planos antes de contratar.'};
messages['legacy-migration-closed-attempt']='Esta tentativa foi encerrada e preservada. Escolha novamente o plano e confira o valor antes de contratar.';
messages['legacy-source-billing-unverified']='Não foi possível confirmar a cobrança antiga. Nenhuma nova cobrança foi iniciada.';
messages['legacy-source-billing-pending']='Existe um pagamento do contrato antigo em processamento. Aguarde a conferência antes de contratar novamente.';
messages['legacy-source-late-payment-review']='Foi identificada uma aprovação recente do contrato antigo. Ela não quita o plano novo; o suporte deve conferir a cobrança antes de uma nova contratação.';
const fail=code=>Object.assign(new Error(messages[code]||code),{code});
const recurring=s=>s.paymentMethodType==='card'||(!['pix_monthly','card_monthly'].includes(s.paymentMethodType)&&Boolean(s.mercadoPago?.subscriptionId));
const sourceId=s=>String(s.mercadoPago?.subscriptionId||s.mercadoPago?.preapprovalId||'');
function assertLegacyCheckoutReady(subscription,now=new Date(),{explicitMigration=false}={}){
  const state=Catalog.legacyState(subscription,now);
  if(!state.legacy)return false;
  if(state.needsReview)throw fail('legacy-paid-period-unverified');
  if(!explicitMigration)throw fail('legacy-migration-consent-required');
  return true;
}
// Read before transaction writes. Client consent alone never authorizes activation.
async function readMigration(db,tx,index,subscription,replacementId){
  if(!index.legacyMigrationOperationId)return null;
  const ref=db.doc('legacyPlanTransitions/'+index.businessId),job=(await tx.get(ref)).data();
  if(!job||job.mode!=='approval_first'||job.operationId!==index.legacyMigrationOperationId||job.replacementId!==replacementId||job.targetPlanId!==index.planId||job.businessId!==index.businessId){
    const history=(await tx.get(db.doc('billingMigrationReservationHistory/'+idFor(index.businessId,index.legacyMigrationOperationId)))).data(),old=history?.reservation;
    if(history?.closed===true&&history.businessId===index.businessId&&history.operationId===index.legacyMigrationOperationId&&old?.mode==='approval_first'&&old.replacementId===replacementId&&old.targetPlanId===index.planId&&!old.activatedAt)return{ref,job:old,activated:false,blocked:true};
    throw fail('legacy-migration-binding-conflict');
  }
  const activated=Boolean(job.activatedAt);
  if(!activated&&sourceId(subscription)!==String(job.subscriptionId||''))throw fail('legacy-source-subscription-conflict');
  if(!activated&&!['awaiting_payment','attempt_closed'].includes(job.status))throw fail('legacy-migration-not-pending');
  return{ref,job,activated,blocked:!activated&&job.status==='attempt_closed'};
}
async function prepareOwnerReconciliation(db,tx,{authorization,business,index,orderId,paymentId,amount,approvedAt}){
  if(!authorization)return null;
  const uid=authorization.uid,bid=index.businessId;
  if(!uid||authorization.businessId!==bid||business.ownerId!==uid||index.ownerId!==uid)throw fail('legacy-migration-owner-required');
  const [ps,ms]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(db.doc(`businesses/${bid}/members/${uid}`))]),p=ps.data(),m=ms.data();
  if(business.active!==true||p?.businessId!==bid||p.active!==true||(ms.exists?(m.role!=='owner'||m.status!=='active'):(p.role!=='owner'||business.legacyAccessDisabled===true)))throw fail('legacy-migration-owner-required');
  const data={type:'official_owner_reconciliation',status:'accepted',businessId:bid,ownerUid:uid,operationId:index.operationId,orderId,paymentId,amount,approvedAt,externalReference:index.expectedExternalReference};
  const id=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),ref=db.doc('billingReconciliationProofs/'+id),prior=await tx.get(ref);
  if(prior.exists&&prior.data()?.status!=='accepted')throw fail('legacy-payment-proof-required');
  return{id,ref,exists:prior.exists,data};
}
function activateMigration(tx,migration,subscription,{paymentId,approvedAt,now,source,eventId,ownerProof}){
  if(!migration)return;
  if(migration.job.status==='attempt_closed')throw fail('legacy-closed-attempt-review-required');
  if(!paymentId||!Number.isFinite(Date.parse(approvedAt||'')))throw fail('legacy-payment-proof-required');
  if(!migration.activated&&(source!=='webhook'||!eventId)&&!(source==='owner_reconciliation'&&ownerProof?.data.ownerUid===migration.job.actorUid))throw fail('legacy-webhook-proof-required');
  const {job,ref}=migration;
  subscription.catalogVersion=2;
  subscription.legacyPlan=job.status!=='completed';
  subscription.legacyTransition=null;
  subscription.legacyMigration={operationId:job.operationId,sourceSubscriptionId:job.subscriptionId,replacementId:job.replacementId,activatedAt:job.activatedAt||now,status:job.status==='completed'?'completed':'cancellation_pending'};
  if(subscription.administrativeAccess?.financialConfirmation===false)subscription.administrativeAccess={...subscription.administrativeAccess,status:'superseded_by_paid_migration',supersededAt:now,paymentId};
  if(migration.activated)return;
  if(ownerProof&&!ownerProof.exists)tx.create(ownerProof.ref,{...ownerProof.data,createdAt:FieldValue.serverTimestamp()});
  tx.update(ref,{status:'pending',approvedPaymentId:String(paymentId),approvedAt,confirmedWebhookEventId:source==='webhook'?eventId:null,confirmedReconciliationProofId:ownerProof?.id||null,activatedAt:now,overlapStartedAt:now,nextAttemptAt:Timestamp.fromDate(new Date(now)),updatedAt:Timestamp.fromDate(new Date(now))});
}
function legacyPlanTransitionService(db,provider,{now=()=>new Date()}={}){
  async function verifySourceForCheckout(options){
    return require('./legacy-source-billing-guard').verifyLegacySourceBilling(db,provider,{...options,now});
  }
  async function enroll(businessId){
    const ref=db.doc('businesses/'+businessId),jobRef=db.doc('legacyPlanTransitions/'+businessId);
    return db.runTransaction(async tx=>{
      const [bs,js]=await Promise.all([tx.get(ref),tx.get(jobRef)]),s=bs.data()?.subscription||{},state=Catalog.legacyState(s,now());
      if(!bs.exists||!state.legacy||js.exists)return false;
      // Classification never schedules cancellation or freezes paid legacy renewals.
      tx.create(jobRef,{businessId,mode:'approval_first',status:'awaiting_selection',subscriptionId:sourceId(s)||null,recurring:recurring(s),paidThrough:state.paidThrough,nextAttemptAt:null,attempts:0,createdAt:Timestamp.fromDate(now())});
      return true;
    });
  }
  async function reserve({businessId,operationId,requestHash,planId,billingCycle,paymentMethodType,actorUid,sourceBillingCheck=null}){
    const ref=db.doc('businesses/'+businessId),jobRef=db.doc('legacyPlanTransitions/'+businessId);
    return db.runTransaction(async tx=>{
      const [bs,js]=await Promise.all([tx.get(ref),tx.get(jobRef)]),business=bs.data()||{},s=business.subscription||{},previous=js.data();
      if(business.ownerId!==actorUid)throw fail('legacy-migration-owner-required');
      if(!assertLegacyCheckoutReady(s,now(),{explicitMigration:true}))throw fail('legacy-migration-not-eligible');
      require('./legacy-source-billing-guard').assertSourceBillingCheck({check:sourceBillingCheck,business,businessId,actorUid,now:now()});
      if(previous?.mode==='approval_first'&&previous.operationId===operationId){
        if(previous.requestHash!==requestHash)throw fail('legacy-migration-request-conflict');
        if(previous.creationRecovery?.closed===true)throw fail('legacy-migration-closed-attempt');
        return previous;
      }
      if(previous?.operationId&&!['awaiting_selection','attempt_closed'].includes(previous.status))throw fail('legacy-migration-in-progress');
      const id=sourceId(s),isRecurring=sourceBillingCheck.recurring,index=isRecurring&&id?(await tx.get(db.doc('subscriptionIndex/'+id))).data():null;
      if(isRecurring&&(!id||index?.businessId!==businessId||Number(index.catalogVersion||1)>=2))throw fail('provider-tenant-unverified');
      const historyRef=previous?.operationId&&previous.status==='attempt_closed'?db.doc('billingMigrationReservationHistory/'+idFor(businessId,previous.operationId)):null,history=historyRef?await tx.get(historyRef):null;
      if(historyRef&&!history.exists)tx.create(historyRef,{businessId,operationId:previous.operationId,requestHash:previous.requestHash,reservation:previous,closed:true,reason:'owner_replaced_closed_attempt',createdAt:FieldValue.serverTimestamp()});
      const job={businessId,mode:'approval_first',operationId,requestHash,actorUid,subscriptionId:id||null,recurring:isRecurring,paidThrough:s.administrativeAccess?.financialConfirmation===false?(s.currentPeriodEnd||s.expiresAt||null):Catalog.legacyState(s,now()).paidThrough,oldNextBillingDate:s.nextBillingDate||null,targetPlanId:planId,billingCycle,paymentMethodType,status:'creating',replacementId:null,activatedAt:null,approvedPaymentId:null,nextAttemptAt:null,attempts:0,createdAt:Timestamp.fromDate(now())};
      if(sourceBillingCheck)job.sourceBillingCheck=sourceBillingCheck;
      tx.set(jobRef,job);
      return job;
    });
  }
  // The caller commits this atomically with the checkout and secure provider index.
  function bind({businessId,operationId,replacementId,sourceSubscriptionId,writer}){
    writer.update(db.doc('legacyPlanTransitions/'+businessId),{replacementId,status:'awaiting_payment',updatedAt:Timestamp.fromDate(now())});
    writer.update(db.doc('businesses/'+businessId),{'subscription.legacyMigration':{operationId,sourceSubscriptionId:sourceSubscriptionId||null,replacementId,status:'awaiting_payment'}});
  }
  async function process(businessId){
    const ref=db.doc('businesses/'+businessId),jobRef=db.doc('legacyPlanTransitions/'+businessId),token=require('node:crypto').randomUUID();
    const job=await db.runTransaction(async tx=>{
      const [js,bs]=await Promise.all([tx.get(jobRef),tx.get(ref)]),j=js.data(),s=bs.data()?.subscription||{};
      if(!j||j.mode!=='approval_first'||!['pending','retry','processing'].includes(j.status)||j.leaseUntil?.toMillis()>now().getTime())return null;
      const next=(await tx.get(db.doc((j.paymentMethodType==='card'?'subscriptionIndex/':'billingOrderIndex/')+j.replacementId))).data();
      if(!j.approvedPaymentId||!j.activatedAt||s.catalogVersion!==2||s.status!=='active'||s.legacyMigration?.operationId!==j.operationId||s.legacyMigration?.activatedAt!==j.activatedAt||next?.businessId!==businessId||next?.legacyMigrationOperationId!==j.operationId||!['approved','payment_approved'].includes(next?.status))throw fail('replacement-activation-required');
      if(j.paymentMethodType==='card'&&sourceId(s)!==j.replacementId)throw fail('replacement-subscription-conflict');
      const webhook=j.confirmedWebhookEventId?(await tx.get(db.doc('webhookEvents/'+j.confirmedWebhookEventId))).data():null;
      const proof=j.confirmedReconciliationProofId?(await tx.get(db.doc('billingReconciliationProofs/'+j.confirmedReconciliationProofId))).data():null;
      const webhookReady=webhook?.status==='processed'&&webhook.businessId===businessId;
      const reconciliationReady=proof?.type==='official_owner_reconciliation'&&proof.status==='accepted'&&proof.businessId===businessId&&proof.orderId===j.replacementId&&proof.paymentId===j.approvedPaymentId&&proof.ownerUid===j.actorUid;
      if(!webhookReady&&!reconciliationReady)throw fail('legacy-webhook-not-completed');
      tx.update(jobRef,{status:'processing',leaseToken:token,leaseUntil:Timestamp.fromMillis(now().getTime()+120000),attempts:FieldValue.increment(1)});return j;
    });
    if(!job)return{skipped:true};
    logger.info('[LEGACY_MIGRATION_CANCEL_STARTED]',{businessId,operationId:job.operationId,replacementId:job.replacementId});
    try{
      if(job.recurring){
        if(job.subscriptionId===job.replacementId)throw fail('migration-source-equals-target');
        const index=(await db.doc('subscriptionIndex/'+job.subscriptionId).get()).data();
        if(index?.businessId!==businessId||Number(index.catalogVersion||1)>=2)throw fail('provider-tenant-unverified');
        let remote=await provider.getSubscription(job.subscriptionId);
        if(String(remote.id)!==job.subscriptionId)throw fail('provider-id-mismatch');
        require('./firestore-subscription-service').validateProviderSubscription(remote,index);
        if(!['cancelled','canceled','expired'].includes(remote.status))await provider.cancelSubscription(job.subscriptionId);
        remote=await provider.getSubscription(job.subscriptionId);
        if(!['cancelled','canceled','expired'].includes(remote.status))throw fail('renewal-stop-unconfirmed');
      }
      await db.runTransaction(async tx=>{
        const [js,bs]=await Promise.all([tx.get(jobRef),tx.get(ref)]),s=bs.data()?.subscription||{};
        if(js.data()?.leaseToken!==token||s.legacyMigration?.operationId!==job.operationId||!s.legacyMigration.activatedAt)throw fail('legacy-transition-conflict');
        const stoppedAt=now().toISOString();
        // Never restore old plan/expiry: the replacement is already effective.
        tx.update(ref,{'subscription.legacyPlan':false,'subscription.legacyTransition':null,'subscription.legacyMigration.status':'completed','subscription.legacyMigration.oldRecurrenceStoppedAt':stoppedAt});
        tx.update(jobRef,{status:'completed',completedAt:Timestamp.fromDate(now()),overlapEndedAt:stoppedAt,overlapMilliseconds:Math.max(0,now().getTime()-Date.parse(job.activatedAt)),nextAttemptAt:null,leaseUntil:null,errorCode:null});
      });
      logger.info('[LEGACY_MIGRATION_COMPLETED]',{businessId,operationId:job.operationId,replacementId:job.replacementId});
      return{completed:true};
    }catch(error){
      await db.runTransaction(async tx=>{const js=await tx.get(jobRef);if(js.data()?.leaseToken===token)tx.update(jobRef,{status:'retry',errorCode:String(error.code||'provider-error').slice(0,100),leaseUntil:null,nextAttemptAt:Timestamp.fromMillis(now().getTime()+300000)});});
      logger.warn('[LEGACY_MIGRATION_RETRY]',{businessId,operationId:job.operationId,code:String(error.code||'provider-error'),newPlanActive:true});
      throw error;
    }
  }
  async function run(){
    // Kill switch only. No discovery/enrollment: retry already authorized jobs.
    if((await db.doc('systemConfig/planTransitionV2').get()).data()?.enabled===false)return{enabled:false};
    const jobs=await db.collection('legacyPlanTransitions').where('nextAttemptAt','<=',Timestamp.fromDate(now())).orderBy('nextAttemptAt').limit(100).get();let failed=0;
    for(const row of jobs.docs)try{await process(row.id);}catch{failed++;}
    return{enabled:true,processed:jobs.size,failed};
  }
  return{enroll,reserve,bind,process,run,verifySourceForCheckout};
}
module.exports={legacyPlanTransitionService,assertLegacyCheckoutReady,recurring,readMigration,activateMigration,prepareOwnerReconciliation};
