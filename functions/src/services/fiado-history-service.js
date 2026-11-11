'use strict';
const {HttpsError}=require('firebase-functions/v2/https'),History=require('../shared/fiado-history-account');
const fail=message=>{throw new HttpsError('failed-precondition',message,{reason:'fiado-history-review-required'});};
const normalize=v=>v?.toDate?v.toDate().toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
async function readHistoryInput({tx,c,ref,clientId,client,checkRowAccess=true}){
 if(!c.has('customers.view')||require('../shared/operational-privacy-policy').restricted(c.member))throw new HttpsError('permission-denied','Histórico financeiro indisponível neste contexto.');
 const collections={};
 for(const [col,fields,cap]of [['sales',['clienteId','clientId','customerId'],350],['payments',['clienteId','clientId','customerId'],350],['balanceAdjustments',['clienteId','clientId','customerId'],350],['balanceEvents',['customerId','clientId','clienteId'],1000],['paymentAllocations',['clientId'],2000]]){
  const rows=new Map();for(const field of fields){const query=ref(c.bid,col,'__none__').parent.where(field,'==',clientId).limit(cap+1),snapshot=await tx.get(query);if(snapshot.size>cap)fail('Histórico excede o limite seguro.');for(const d of snapshot.docs)rows.set(d.id,{...normalize(d.data()),id:d.id});}if(rows.size>cap)fail('Histórico excede o limite seguro.');collections[col]=[...rows.values()];
 }
 if(Object.values(collections).reduce((n,rows)=>n+rows.length,0)>1600)fail('Histórico excede o limite agregado seguro.');
 for(const row of [...collections.sales,...collections.payments,...collections.balanceAdjustments,...collections.balanceEvents]){
  if(row.businessId&&row.businessId!==c.bid||(row.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('Histórico de outra empresa ou geração.');
  if(checkRowAccess){if(row.spaceId)await c.space(row.spaceId);else if(!c.owner)throw new HttpsError('permission-denied','Histórico sem espaço exige proprietário.');}
 }
 const operations=[...new Set(collections.balanceEvents.map(e=>e.operationId).filter(Boolean))];if(operations.length>1000)fail('Histórico de marcadores excede o limite seguro.');
 collections.processedOperations=[];for(let offset=0;offset<operations.length;offset+=100){const ids=operations.slice(offset,offset+100);if(ids.some(id=>typeof id!=='string'||id.includes('/')))fail('Marcador inválido.');const docs=await tx.getAll(...ids.map(id=>ref(c.bid,'processedOperations',id)));for(const d of docs)if(d.exists)collections.processedOperations.push({...normalize(d.data()),id:d.id});}
 return{businessId:c.bid,generation:c.business.workspaceGeneration??0,client:{...normalize(client),id:clientId},collections,complete:true,stable:true};
}
async function loadHistory(args){
 const input=await readHistoryInput(args);
 try{return{account:History.project(input,args.day),input};}catch(e){fail(e.message);}
}
module.exports={loadHistory,readHistoryInput};
