'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const {validId}=require('./workspace-reset-policy');
const {operationalId}=require('../shared/operational-id');
const deny=message=>{throw new HttpsError('permission-denied',message);};
const iso=value=>value?.toDate?.().toISOString()||value||null;
const money=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100));

// Called inside the existing authenticated transaction. This module only reads;
// it never repairs a receipt, publishes a signal or executes a commercial intent.
async function paymentConfirmationRead({tx,c,d,ref}){
  if(!c.has('customers.receiveDebt')||!c.has('customers.view'))deny('Seu acesso não permite consultar este recebimento.');
  const paymentId=validId(d.paymentId,'Recebimento'),operationId=operationalId(d.operationId,'Operação'),clientId=validId(d.clientId,'Cliente');
  const p=(await tx.get(ref(c.bid,'payments',paymentId))).data();
  if(!p)return{confirmed:false,status:'awaiting_confirmation'};
  if(p.businessId!==c.bid||(p.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||p.operationId!==operationId||(p.clienteId||p.customerId)!==clientId)deny('O recebimento não corresponde à empresa, cliente ou operação.');
  await c.space(p.spaceId);
  const eventId='payment_received:'+paymentId;
  const [markerSnapshot,eventSnapshot,clientSnapshot,settingsSnapshot]=await Promise.all([
    tx.get(ref(c.bid,'processedOperations',operationId)),tx.get(ref(c.bid,'balanceEvents',eventId)),
    tx.get(ref(c.bid,'clients',clientId)),tx.get(ref(c.bid,'settings','default')),
  ]);
  const marker=markerSnapshot.data(),event=eventSnapshot.data(),client=clientSnapshot.data(),settings=settingsSnapshot.data()||{},generation=c.business.workspaceGeneration??0;
  const confirmed=marker?.status==='processed'&&marker.eventKind==='payment'&&marker.authorizationVersion===1&&/^[a-f0-9]{64}$/.test(marker.requestHash||'')&&marker.businessId===c.bid&&(marker.workspaceGeneration??0)===generation&&(marker.actorUid||marker.ownerId)===(p.actorUid||p.ownerId)&&
    p.status==='applied'&&p.applicationStatus==='applied'&&p.financialAppliedAt&&p.financialOperationId===eventId&&!p.financialReversedAt&&!p.reversedAt&&
    event?.status==='applied'&&event.type==='payment_received'&&event.businessId===c.bid&&(event.workspaceGeneration??0)===generation&&event.operationId===operationId&&event.customerId===clientId&&event.sourceCollection==='payments'&&event.sourceDocumentId===paymentId&&
    money(p.valor)&&p.valor>0&&money(event.balanceDelta)&&money(event.amount)&&Math.round(event.amount*100)===Math.round(p.valor*100)&&Math.round(event.balanceDelta*100)===Math.round(p.valor*100);
  if(!confirmed)return{confirmed:false,status:['conflict','cancelled','reversed'].includes(p.status)?'requires_review':'awaiting_confirmation'};
  if(!client||client.businessId!==c.bid||(client.workspaceGeneration??0)!==generation||!money(client.saldo)||!Number.isSafeInteger(client.financialVersion)||client.financialVersion<0)
    return{confirmed:false,status:'balance_unconfirmed'};
  const businessName=String(settings.nome||c.business.name||c.business.nome||'').trim();
  if(!businessName||!String(client.nome||'').trim())return{confirmed:false,status:'identity_unconfirmed'};
  return{confirmed:true,status:'confirmed',businessId:c.bid,workspaceGeneration:generation,paymentId,operationId,clientId,spaceId:p.spaceId,
    amount:p.valor,paymentDate:iso(p.data||p.createdAt||p.financialAppliedAt),paymentMethod:p.paymentMethod||'other',
    appliedAt:iso(p.financialAppliedAt),balance:client.saldo,financialVersion:client.financialVersion,checkedAt:new Date().toISOString(),
    businessName,clientName:String(client.nome),phone:String(client.telefone||''),
    // Only this category is exposed; no settings, financial lists or other clients.
    templates:Array.isArray(settings.receiptMessageTemplates)?settings.receiptMessageTemplates.filter(t=>t&&t.type==='receipt'&&t.active!==false).map(t=>({id:t.id,name:t.name,type:'receipt',receiptKind:t.receiptKind,content:t.content,isDefault:t.isDefault===true})):[],
  };
}
module.exports={paymentConfirmationRead};
