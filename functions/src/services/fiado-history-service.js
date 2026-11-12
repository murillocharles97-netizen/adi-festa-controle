'use strict';
const {HttpsError}=require('firebase-functions/v2/https'),History=require('../shared/fiado-history-account');
const {ORIGIN_AUDIT_COLLECTION,withOrigins,activationAuditMatches}=require('../shared/fiado-history-origins');
const Opening=require('../shared/fiado-opening-balance');
const fail=message=>{throw new HttpsError('failed-precondition',message,{reason:'fiado-history-review-required'});};
const normalize=v=>v?.toDate?v.toDate().toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
async function readHistoryInput({tx,c,ref,clientId,client,checkRowAccess=true,useActivatedOrigins=true}){
 if(!c.has('customers.view')||require('../shared/operational-privacy-policy').restricted(c.member))throw new HttpsError('permission-denied','Histórico financeiro indisponível neste contexto.');
 const collections={};
 if(useActivatedOrigins&&client.fiadoOpeningBalance){
  // The server stamps this immutable epoch on post-cut financial writes. Do not
  // re-scan archived sources or rely on their dates to decide account membership.
  const audit=(await tx.get(ref(c.bid,Opening.COLLECTION,clientId))).data();
  for(const col of ['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations']){
   const rows=await tx.get(ref(c.bid,col,'__none__').parent.where('fiadoOpeningHash','==',client.fiadoOpeningBalance.hash).limit(2001));
   if(rows.size>2000)fail('Conta nova excede o limite seguro.');
   collections[col]=rows.docs.map(d=>({...normalize(d.data()),id:d.id}));
  }
  for(const calendar of audit?.plan?.calendars||[]){
   const row=await tx.get(ref(c.bid,'sales',calendar.saleId));
   if(!row.exists)fail('Parcelamento preservado indisponível.');
   if(!collections.sales.some(s=>s.id===row.id))collections.sales.push({...normalize(row.data()),id:row.id});
  }
  collections.processedOperations=[];
  for(const id of new Set(collections.balanceEvents.map(row=>row.operationId))){
   if(typeof id!=='string'||!id||id.includes('/'))fail('Operação nova inválida.');
   const row=await tx.get(ref(c.bid,'processedOperations',id));
   if(row.exists)collections.processedOperations.push({...normalize(row.data()),id:row.id});
  }
  const raw={businessId:c.bid,generation:c.business.workspaceGeneration??0,client:{...normalize(client),id:clientId},collections,complete:true,stable:true};
  let opening;
  try{opening=Opening.readOpening(raw,audit);}catch(error){fail(error.message);}
  if(checkRowAccess)for(const part of opening.parts)if(part.totalCents>0)await c.space(part.spaceId);
  return {...raw,opening};
 }
 for(const [col,fields,cap]of [['sales',['clienteId','clientId','customerId'],350],['payments',['clienteId','clientId','customerId'],350],['balanceAdjustments',['clienteId','clientId','customerId'],350],['balanceEvents',['customerId','clientId','clienteId'],1000],['paymentAllocations',['clientId'],2000]]){
  const rows=new Map();for(const field of fields){const query=ref(c.bid,col,'__none__').parent.where(field,'==',clientId).limit(cap+1),snapshot=await tx.get(query);if(snapshot.size>cap)fail('Histórico excede o limite seguro.');for(const d of snapshot.docs)rows.set(d.id,{...normalize(d.data()),id:d.id});}if(rows.size>cap)fail('Histórico excede o limite seguro.');collections[col]=[...rows.values()];
 }
 if(Object.values(collections).reduce((n,rows)=>n+rows.length,0)>1600)fail('Histórico excede o limite agregado seguro.');
 for(const row of [...collections.sales,...collections.payments,...collections.balanceAdjustments,...collections.balanceEvents]){
  if(row.businessId&&row.businessId!==c.bid||(row.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('Histórico de outra empresa ou geração.');

 }
 const operations=[...new Set(collections.balanceEvents.map(e=>e.operationId).filter(Boolean))];if(operations.length>1000)fail('Histórico de marcadores excede o limite seguro.');
 collections.processedOperations=[];for(let offset=0;offset<operations.length;offset+=100){const ids=operations.slice(offset,offset+100);if(ids.some(id=>typeof id!=='string'||id.includes('/')))fail('Marcador inválido.');const docs=await tx.getAll(...ids.map(id=>ref(c.bid,'processedOperations',id)));for(const d of docs)if(d.exists)collections.processedOperations.push({...normalize(d.data()),id:d.id});}
 const raw={businessId:c.bid,generation:c.business.workspaceGeneration??0,client:{...normalize(client),id:clientId},collections,complete:true,stable:true};
 let input=raw;
 if(useActivatedOrigins&&client.fiadoHistoryActivation?.originLinksDigest!==undefined){
  const activation=client.fiadoHistoryActivation;
  if(client.fiadoHistoryVersion!==1||activation.version!==1||activation.source!=='fiado_history_regularization'||
     activation.activationId!=='fiado_history_activation_'+clientId+'_v'+activation.financialVersion)fail('Ativação histórica inválida.');
  const audit=(await tx.get(ref(c.bid,ORIGIN_AUDIT_COLLECTION,activation.activationId))).data();
  if(!activationAuditMatches(activation,audit,raw))fail('Ativação histórica sem auditoria correspondente.');
  try{input=withOrigins(raw,audit.originLinks);}catch(error){fail(error.message);}
 }
 if(checkRowAccess)for(const col of ['sales','payments','balanceAdjustments','balanceEvents'])for(const row of input.collections[col]){
  if(row.spaceId)await c.space(row.spaceId);else if(!c.owner)throw new HttpsError('permission-denied','Histórico sem espaço exige proprietário.');
 }
 if(checkRowAccess&&input.opening)for(const part of input.opening.parts)
  if(part.totalCents>0)await c.space(part.spaceId);
 return input;
}
async function loadHistory(args){
 const input=await readHistoryInput(args);
 try{return{account:History.project(input,args.day),input};}catch(e){fail(e.message);}
}
module.exports={loadHistory,readHistoryInput};
