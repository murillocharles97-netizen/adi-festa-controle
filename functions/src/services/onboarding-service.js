'use strict';

const {HttpsError}=require('firebase-functions/v2/https');

const DAY_MS=24*60*60*1000;
const text=(value,max=120)=>String(value||'').trim().slice(0,max);

function onboardingService(db,{Timestamp,FieldValue,professionalLimits}){
  async function complete({uid,email,input={}}){
    const authUid=text(uid,128),authEmail=text(email,320).toLowerCase();
    if(!authUid||!authEmail)throw new HttpsError('unauthenticated','Entre novamente para concluir seu cadastro.');
    const ownerName=text(input.ownerName||input.name,100),businessName=text(input.businessName,120),segment=text(input.segment||input.businessType||'Comércio geral',80),phone=text(input.phone,30),businessPhone=text(input.businessPhone||phone,30),city=text(input.city,80),state=text(input.state,2).toUpperCase(),document=text(input.document,30);
    if(!ownerName||!businessName||!segment||!city||state.length!==2)throw new HttpsError('invalid-argument','Preencha nome, empresa, segmento, cidade e estado.');
    const businessId=`biz_${authUid}`,membershipId=`${businessId}_${authUid}`,
      refs={profile:db.doc(`users/${authUid}`),business:db.doc(`businesses/${businessId}`),membership:db.doc(`memberships/${membershipId}`),onboarding:db.doc(`onboarding/${authUid}`),settingsDefault:db.doc(`businesses/${businessId}/settings/default`),settingsOperation:db.doc(`businesses/${businessId}/settings/operation`),audit:db.doc(`businesses/${businessId}/auditLogs/account_created_${authUid}`)};
    return db.runTransaction(async transaction=>{
      const [profileSnapshot,businessSnapshot,membershipSnapshot,onboardingSnapshot,defaultSnapshot,operationSnapshot]=await Promise.all([transaction.get(refs.profile),transaction.get(refs.business),transaction.get(refs.membership),transaction.get(refs.onboarding),transaction.get(refs.settingsDefault),transaction.get(refs.settingsOperation)]),
        profile=profileSnapshot.data()||{},business=businessSnapshot.data()||{},membership=membershipSnapshot.data()||{},onboarding=onboardingSnapshot.data()||{};
      if(profileSnapshot.exists){
        if(profile.uid&&profile.uid!==authUid)throw new HttpsError('permission-denied','O UID do perfil pertence a outra conta.');
        if(text(profile.email,320).toLowerCase()!==authEmail)throw new HttpsError('permission-denied','O e-mail do perfil não corresponde à conta autenticada.');
        if(profile.businessId&&profile.businessId!==businessId)throw new HttpsError('permission-denied','O perfil já pertence a outra empresa.');
        if(profile.role&&profile.role!=='owner')throw new HttpsError('permission-denied','O perfil existente não possui papel de proprietário.');
        if(profile.active===false)throw new HttpsError('permission-denied','O perfil existente está inativo.');
      }
      if(businessSnapshot.exists&&(business.ownerId!==authUid||business.id&&business.id!==businessId))throw new HttpsError('permission-denied','A empresa encontrada pertence a outro proprietário.');
      if(businessSnapshot.exists&&business.active===false)throw new HttpsError('permission-denied','A empresa encontrada está inativa.');
      if(membershipSnapshot.exists&&(membership.uid!==authUid||membership.businessId!==businessId))throw new HttpsError('permission-denied','O vínculo empresarial encontrado é divergente.');
      const asTimestamp=value=>{if(!value)return null;if(typeof value.toMillis==='function')return value;const parsed=value instanceof Date?value:new Date(value);return Number.isNaN(parsed.getTime())?null:Timestamp.fromDate(parsed)},
        now=Timestamp.now(),createdAt=profile.createdAt||business.createdAt||onboarding.createdAt||now,
        priorTrialStart=asTimestamp(business.subscription?.trialStartedAt||membership.trialStartedAt),
        priorTrialEnd=asTimestamp(business.subscription?.trialEndsAt||membership.trialEndsAt),
        trialStartedAt=priorTrialStart||now,
        trialEndsAt=priorTrialEnd||Timestamp.fromMillis(trialStartedAt.toMillis()+7*DAY_MS),
        trialSubscription={planId:'trial',status:'trial',subscriptionStatus:'trialing',trialStartedAt,trialEndsAt,startedAt:trialStartedAt,expiresAt:trialEndsAt,nextBillingDate:null,lastPaymentDate:null,currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null,mercadoPago:{subscriptionId:null,customerId:null,preapprovalId:null,lastWebhook:null}},
        existingSubscription=business.subscription||{},
        subscription=existingSubscription.planId&&existingSubscription.status?(existingSubscription.planId==='trial'?{...trialSubscription,...existingSubscription,trialStartedAt:asTimestamp(existingSubscription.trialStartedAt)||trialStartedAt,trialEndsAt:asTimestamp(existingSubscription.trialEndsAt)||trialEndsAt}:existingSubscription):trialSubscription,
        limits={maxUsers:professionalLimits.users,maxProducts:professionalLimits.products,maxClients:professionalLimits.clients,maxMonthlySales:professionalLimits.monthlySales,users:professionalLimits.users,products:professionalLimits.products,clients:professionalLimits.clients,monthlySales:professionalLimits.monthlySales,catalogEnabled:true,campaignsEnabled:true};
      transaction.set(refs.business,{id:businessId,slug:business.slug||`${businessName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'negocio'}-${authUid.slice(0,6).toLowerCase()}`,name:business.name||businessName,legalName:business.legalName||'',document:business.document||document,phone:business.phone||businessPhone,email:business.email||authEmail,ownerId:authUid,active:business.active!==false,onboardingCompleted:true,businessType:business.businessType||segment,city:business.city||city,state:business.state||state,createdAt:business.createdAt||createdAt,updatedAt:FieldValue.serverTimestamp(),subscription,limits:business.limits||limits},{merge:true});
      transaction.set(refs.profile,{uid:authUid,email:authEmail,name:profile.name||ownerName,phone:profile.phone||phone,active:profile.active!==false,businessId,role:'owner',permissions:profile.permissions||[],onboardingCompleted:true,createdAt:profile.createdAt||createdAt,updatedAt:FieldValue.serverTimestamp(),lastLoginAt:FieldValue.serverTimestamp()},{merge:true});
      transaction.set(refs.membership,{id:membershipId,businessId,uid:authUid,email:authEmail,role:'owner',active:true,trialStartedAt,trialEndsAt,createdAt:membership.createdAt||createdAt,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      transaction.set(refs.onboarding,{id:authUid,uid:authUid,businessId,status:'completed',currentStep:5,createdAt:onboarding.createdAt||createdAt,completedAt:onboarding.completedAt||now,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      if(!defaultSnapshot.exists)transaction.set(refs.settingsDefault,{id:'default',businessId,nome:businessName,businessName,receiptName:businessName,telefone:businessPhone,currency:'BRL',timezone:'America/Sao_Paulo',onboardingStep:1,createdAt,updatedAt:FieldValue.serverTimestamp()});
      if(!operationSnapshot.exists)transaction.set(refs.settingsOperation,{id:'operation',businessId,ownerId:authUid,operationMode:'physical_store',creditMode:'disabled',operationOnboardingCompleted:false,modules:{creditSales:false,inventory:true,onlineCatalog:false,onlineOrders:false,delivery:false,pickup:false,physicalStore:true,scheduledVisits:false,campaigns:false,loyalty:false,crm:true,inPersonSales:true},smartCardMode:'automatic',cardMetrics:[],migrationVersion:2,schemaVersion:2,createdAt,updatedAt:FieldValue.serverTimestamp()});
      transaction.set(refs.audit,{id:`account_created_${authUid}`,businessId,type:'account_created',actorId:authUid,createdAt:createdAt,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      return{businessId,status:'completed',created:{profile:!profileSnapshot.exists,business:!businessSnapshot.exists,membership:!membershipSnapshot.exists},trial:{startedAt:trialStartedAt.toDate().toISOString(),endsAt:trialEndsAt.toDate().toISOString(),preserved:Boolean(priorTrialStart&&priorTrialEnd)}};
    });
  }
  return{complete};
}

module.exports={onboardingService};
