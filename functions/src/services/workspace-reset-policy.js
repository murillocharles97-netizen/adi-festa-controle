'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const BILLING_COLLECTIONS=new Set(['billingCheckoutAttempts','subscriptionIntents']);
const OPERATIONAL_COLLECTIONS=new Set([
  'products','productVariants','stockMovements','productFinancials','variantFinancials',
  'stockMovementFinancials','clients','sales','saleFinancials','payments','balanceAdjustments',
  'balanceEvents','processedOperations','campaigns','campaignProgress','campaignEvents',
  'campaignRedemptions','paymentAllocations','rewards','charges','messageHistory',
  'messageTemplates','messageSequences','clientContacts','customerSubscriptions',
  'customerSubscriptionEvents','customerMetrics','customerMonthlyMetrics','customerSegments',
  'metricEvents','visits','catalogOrders','activityEvents','auditLogs','invites','teamInvites',
  'settings','syncMetadata','paymentTerminals','paymentProviderConfigs','paymentIntents',
  'paymentCheckoutLocks','paymentReceivables',
]);
const RESET_STATES=new Set(['REQUESTED','LOCKED','DELETING','VERIFYING','COMPLETED','FAILED']);
const NEXT={REQUESTED:['LOCKED','FAILED'],LOCKED:['DELETING','FAILED'],DELETING:['VERIFYING','FAILED'],VERIFYING:['COMPLETED','FAILED'],FAILED:['LOCKED'],COMPLETED:[]};
function validId(value,label='Identificador'){
  if(typeof value!=='string'||!/^[-A-Za-z0-9_]{3,128}$/.test(value))
    throw new HttpsError('invalid-argument',`${label} inválido.`);
  return value;
}
function generation(value=0){
  if(!Number.isSafeInteger(value)||value<0)throw new HttpsError('failed-precondition','Geração operacional inválida.');
  return value;
}
function assertWritable(business,expectedGeneration=0){
  if(!business||business.active!==true)throw new HttpsError('permission-denied','Empresa indisponível.',{reason:'workspace-unavailable'});
  if(business.workspaceReset&&business.workspaceReset.status!=='COMPLETED')
    throw new HttpsError('failed-precondition','A restauração da empresa está em andamento ou precisa ser retomada.',{reason:'workspace-reset-locked'});
  if(generation(business.workspaceGeneration??0)!==generation(expectedGeneration))
    throw new HttpsError('failed-precondition','Os dados deste aparelho pertencem a uma configuração anterior. Reabra a empresa.',{reason:'workspace-generation-mismatch'});
}
function classifyCollection(name){
  if(BILLING_COLLECTIONS.has(name))return'preserve-billing';
  if(name==='members')return'preserve-owner-only';
  if(name==='workspaceResetJobs')return'preserve-reset-metadata';
  if(OPERATIONAL_COLLECTIONS.has(name))return'delete-operational';
  throw new HttpsError('failed-precondition','Foi encontrada uma coleção ainda não classificada. Nenhum reset pode iniciar.',{reason:'unclassified-collection',collection:name});
}
function assertResetOwner({uid,business,member,authTime,confirmation,now=Date.now()}){
  if(!uid)throw new HttpsError('unauthenticated','Entre novamente para continuar.');
  if(!business||business.active!==true||business.ownerId!==uid||member?.role!=='owner'||member?.status!=='active')
    throw new HttpsError('permission-denied','Somente o proprietário ativo pode restaurar esta empresa.');
  if(confirmation!=='RESETAR')throw new HttpsError('invalid-argument','Digite RESETAR para confirmar.');
  if(!Number.isFinite(authTime)||now-authTime*1000>5*60*1000||authTime*1000>now+30000)
    throw new HttpsError('unauthenticated','Confirme sua identidade novamente para restaurar os dados.',{reason:'recent-auth-required'});
  if(business.workspaceHasRealIntegratedPayments===true)
    throw new HttpsError('failed-precondition','Esta empresa possui pagamentos integrados reais. Use o fluxo de encerramento de dados para continuar.',{reason:'real-integrated-payments'});
}
function assertMockOnly(rows){
  // A frontend-controlled isTest flag can never authorize deletion of real evidence.
  if(rows.some(row=>!['mock','simulator'].includes(row.provider)))
    throw new HttpsError('failed-precondition','Esta empresa possui integração não simulada. O reset simples está bloqueado.',{reason:'real-integrated-payments'});
}
function assertTransition(from,to){
  if(!RESET_STATES.has(from)||!NEXT[from]?.includes(to))
    throw new HttpsError('failed-precondition',`Transição de restauração inválida: ${from} → ${to}.`);
}
function belongsToWorkspace(space,businessId){
  const links=[space?.businessId,space?.linkedBusinessId].filter(Boolean);
  return links.length>0&&links.every(id=>id===businessId);
}
function storagePrefixes(businessId,spaceIds=[]){
  validId(businessId,'Empresa');
  return[`businesses/${businessId}/`,...[...new Set(spaceIds)].map(id=>`financialSpaces/${validId(id,'Espaço')}/`)];
}
module.exports={BILLING_COLLECTIONS,OPERATIONAL_COLLECTIONS,RESET_STATES,NEXT,validId,generation,assertWritable,classifyCollection,assertResetOwner,assertMockOnly,assertTransition,belongsToWorkspace,storagePrefixes};
