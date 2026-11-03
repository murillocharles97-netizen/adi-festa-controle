'use strict';
const crypto=require('node:crypto');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {billingExternalReference}=require('./mercado-pago-service');
const Catalog=require('../shared/plan-catalog');
const idFor=(businessId,operationId)=>crypto.createHash('sha256').update(businessId+':'+operationId).digest('hex');
const millis=x=>x?.toMillis?.()??Date.parse(x||'');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function legacyCheckoutRecoveryService(db,provider,{now=()=>new Date()}={}){
  const refs=(bid,uid,op)=>({business:db.doc('businesses/'+bid),member:db.doc(`businesses/${bid}/members/${uid}`),profile:db.doc('users/'+uid),job:db.doc('legacyPlanTransitions/'+bid),attempt:db.doc(`businesses/${bid}/billingCheckoutAttempts/${op}`),proof:db.doc('billingMigrationRepairAuthorizations/'+idFor(bid,op)),history:db.doc('billingMigrationReservationHistory/'+idFor(bid,op))});
  async function read(r,tx=null){
    const names=Object.keys(r),rows=await Promise.all(names.map(k=>tx?tx.get(r[k]):r[k].get()));
    return Object.fromEntries(names.map((k,i)=>[k,{snapshot:rows[i],data:rows[i].data()}]));
  }
  function owner(s,bid,uid){
    const b=s.business.data,m=s.member.data,p=s.profile.data;
    if(!b||b.active!==true||b.ownerId!==uid||!p||p.active!==true||p.businessId!==bid)fail('permission-denied','Somente o proprietário ativo desta empresa pode verificar a contratação.');
    if(s.member.snapshot.exists?(m?.role!=='owner'||m?.status!=='active'):(p.role!=='owner'||b.legacyAccessDisabled===true))fail('permission-denied','Somente o proprietário ativo desta empresa pode verificar a contratação.');
  }
  function eligible(s,bid,op){
    const j=s.job.data,a=s.attempt.data;
    if(!j||j.businessId!==bid||j.operationId!==op||j.mode!=='approval_first'||!['pix_monthly','card_monthly'].includes(j.paymentMethodType))fail('migration-recovery-unavailable','Esta reserva não pode ser liberada por este procedimento.');
    if(j.replacementId||j.activatedAt||j.approvedPaymentId||!a||a.businessId!==bid||a.operationId!==op||a.requestedBy!==s.business.data.ownerId||a.status!=='failed'||a.providerOrderId||a.providerPaymentId||a.subscriptionId)fail('migration-recovery-has-provider-state','Existe vínculo ou situação de pagamento que precisa de conciliação. Nenhuma nova cobrança foi liberada.');
    if(a.requestHash!==j.requestHash||j.actorUid!==s.business.data.ownerId||s.business.data.subscription?.mercadoPago?.subscriptionId!==j.subscriptionId||s.business.data.subscription?.legacyMigration?.activatedAt)fail('migration-recovery-state-changed','O contrato ou a identidade da tentativa mudou. Preserve a reserva para análise.');
    if(!Catalog.legacyState(s.business.data.subscription,now()).legacy)fail('migration-recovery-state-changed','A empresa já usa outra política de contratação. Esta reserva precisa de análise.');
    if(!['creating','checking_creation','attempt_closed'].includes(j.status)||a.leaseUntil?.toMillis?.()>+now())fail('migration-recovery-busy','A contratação ainda está em processamento. Aguarde a conferência.');
    const externalReference=billingExternalReference(bid,op),proof=s.proof.data;
    const serverRejection=a.creationOutcome==='rejected_before_creation'&&a.providerCreateHttpStatus===400;
    const adminProof=proof?.businessId===bid&&proof.operationId===op&&proof.requestHash===j.requestHash&&proof.expectedExternalReference===externalReference&&proof.providerHttpStatus===400&&proof.outcome==='rejected_before_creation'&&proof.authority==='platform_admin'&&millis(proof.expiresAt)>+now()&&millis(proof.verifiedAt)<=+now()&&+now()-millis(proof.verifiedAt)<86400000;
    if(!serverRejection&&!adminProof)fail('migration-recovery-proof-required','A falha anterior precisa de comprovação técnica de que nenhuma cobrança foi criada. O acesso atual foi preservado.');
    const created=millis(a.createdAt||j.createdAt);
    if(!Number.isFinite(created)||created>+now()||+now()-created<120000)fail('migration-recovery-busy','Aguarde a conclusão da tentativa anterior antes de conferir.');
    return{j,a,externalReference,created,proofType:serverRejection?'server_provider_rejection':'admin_verified_provider_rejection'};
  }
  async function summary({businessId,uid}){
    const job=(await db.doc('legacyPlanTransitions/'+businessId).get()).data();
    if(!job||job.mode!=='approval_first'||!['creating','checking_creation'].includes(job.status))return null;
    if(job.businessId!==businessId||job.actorUid!==uid)return null;
    return{operationId:job.operationId,status:job.status,paymentMethodType:job.paymentMethodType,requiresVerification:true};
  }
  async function recover({businessId,uid,operationId,confirmed}){
    if(confirmed!==true||typeof businessId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(businessId)||typeof operationId!=='string'||!/^[-A-Za-z0-9_]{16,100}$/.test(operationId)||!uid)fail('invalid-argument','Confirme a verificação da tentativa interrompida.');
    const r=refs(businessId,uid,operationId),token=crypto.randomUUID();
    const initial=await read(r);owner(initial,businessId,uid);
    // An existing immutable result is a lookup, not another repair.
    if(initial.history.data?.closed===true&&initial.history.data.businessId===businessId&&initial.history.data.operationId===operationId)return{status:'reservation_released',operationId,replayed:true,paymentCreated:false};
    const original=eligible(initial,businessId,operationId),guard=require('./legacy-source-billing-guard');
    const sourceCheck=await guard.verifyLegacySourceBilling(db,provider,{businessId,actorUid:uid,expectedSubscriptionId:original.j.subscriptionId,now});
    const acquired=await db.runTransaction(async tx=>{
      const s=await read(r,tx);owner(s,businessId,uid);
      if(s.history.data?.closed===true&&s.history.data.businessId===businessId&&s.history.data.operationId===operationId)return{replayed:true};
      const intent=eligible(s,businessId,operationId);
      guard.assertSourceBillingCheck({check:sourceCheck,business:s.business.data,businessId,actorUid:uid,expectedSubscriptionId:intent.j.subscriptionId,now:now()});
      if(s.job.data?.recoveryLeaseUntil?.toMillis?.()>+now())fail('migration-recovery-busy','A verificação já está em andamento. Aguarde sem iniciar outra contratação.');
      tx.update(r.job,{status:'checking_creation',recoveryLeaseToken:token,recoveryLeaseUntil:Timestamp.fromMillis(+now()+60000)});
      return{...intent,requestHash:intent.j.requestHash};
    });
    if(acquired.replayed)return{status:'reservation_released',operationId,replayed:true,paymentCreated:false};
    try{
      // GET only, exact hash derived from this company and immutable operation.
      const search=await provider.searchOrders({externalReference:acquired.externalReference,beginDate:new Date(acquired.created-300000).toISOString(),endDate:now().toISOString(),page:1});
      const rows=search?.data,total=Number(search?.paging?.total);
      if(!Array.isArray(rows)||!Number.isSafeInteger(total)||total!==0||rows.length)fail('migration-recovery-provider-state','O provedor encontrou uma cobrança ou não comprovou uma busca vazia. A reserva foi preservada para conciliação.');
      const queries=[db.collection('billingOrderIndex').where('expectedExternalReference','==',acquired.externalReference),db.collection('billingPaymentEvents').where('operationId','==',operationId)];
      const finalSourceCheck=await guard.verifyLegacySourceBilling(db,provider,{businessId,actorUid:uid,expectedSubscriptionId:acquired.j.subscriptionId,now});
      const result=await db.runTransaction(async tx=>{
        const [s,...indexes]=await Promise.all([read(r,tx),...queries.map(q=>tx.get(q))]);owner(s,businessId,uid);
        const intent=eligible(s,businessId,operationId);
        guard.assertSourceBillingCheck({check:finalSourceCheck,business:s.business.data,businessId,actorUid:uid,expectedSubscriptionId:intent.j.subscriptionId,now:now()});
        if(intent.j.recoveryLeaseToken!==token||intent.j.recoveryLeaseUntil?.toMillis?.()<=+now()||intent.j.requestHash!==acquired.requestHash||indexes.some(x=>!x.empty))fail('migration-recovery-state-changed','A contratação mudou durante a conferência. Nenhuma nova cobrança foi liberada.');
        const id=idFor(businessId,operationId),audit=db.doc(`businesses/${businessId}/auditLogs/migration_creation_recovered_${id}`);
        tx.create(r.history,{businessId,operationId,requestHash:intent.j.requestHash,reservation:acquired.j,attemptStatus:intent.a.status,providerSearch:{externalReference:acquired.externalReference,total:0,checkedAt:Timestamp.fromDate(now())},proofType:intent.proofType,recoveredBy:uid,closed:true,createdAt:FieldValue.serverTimestamp()});
        tx.update(r.job,{status:'attempt_closed',creationRecovery:{id,closed:true,reason:'provider_rejected_before_creation',checkedAt:Timestamp.fromDate(now())},recoveryLeaseToken:FieldValue.delete(),recoveryLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
        tx.set(r.attempt,{reservationRecoveryId:id,reservationRecoveredAt:FieldValue.serverTimestamp()},{merge:true});
        tx.create(audit,{type:'legacy_checkout_creation_recovered',businessId,operationId,actorUid:uid,providerOrdersFound:0,sourceBillingCheck:finalSourceCheck,proofType:intent.proofType,paymentCreated:false,subscriptionChanged:false,createdAt:FieldValue.serverTimestamp()});
        return{status:'reservation_released',operationId,replayed:false,paymentCreated:false};
      });
      return result;
    }catch(error){
      await db.runTransaction(async tx=>{const s=await tx.get(r.job);if(s.data()?.recoveryLeaseToken===token)tx.update(r.job,{status:'creating',recoveryLeaseToken:FieldValue.delete(),recoveryLeaseUntil:FieldValue.delete(),recoveryLastError:String(error.code||'provider-verification-failed').slice(0,100)});});
      throw error;
    }
  }
  return{summary,recover};
}
module.exports={legacyCheckoutRecoveryService,idFor};
