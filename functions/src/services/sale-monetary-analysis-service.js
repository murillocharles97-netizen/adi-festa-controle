'use strict';
const {createHash}=require('node:crypto');
const {Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {policyFor:defaultPolicy}=require('./sale-monetary-analysis-policy');
const KIND='monetary_analysis_v1';
const fail=(code,message)=>{throw new HttpsError(code,message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(value));
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
// Frozen diagnostic checksum contract V208/V210, for JSON-only originals.
// This is evidence validation, NOT queue normalization or a new Sync protocol.
function diagnosticChecksum(payload){const ignored=new Set(['ownerId','businessId','source','createdAt','criadoEm','updatedAt','atualizadoEm','serverUpdatedAt','localUpdatedAt','version','revision','schemaVersion','idempotencyKey','entityType','action','recoveryChecksum','createdBy','sourceDeviceId','appliedAt','financialAppliedAt','financialOperationId','financialRevision','financialReconciledAt','openBalance']);const comparable=v=>Array.isArray(v)?v.map(comparable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!ignored.has(k)&&!k.startsWith('__')).map(k=>[k,comparable(v[k])])):v;let h=2166136261;const s=JSON.stringify(comparable(payload));for(let n=0;n<s.length;n++){h^=s.charCodeAt(n);h=Math.imul(h,16777619);}return'fnv1a:'+(h>>>0).toString(16).padStart(8,'0');}
function calculate(sale){
 const local=sale.valorFinal??sale.valorTotal,items=sale.itens;
 if(typeof local!=='number'||!Number.isFinite(local)||local<0||!Array.isArray(items)||!items.length)fail('invalid-argument','Valores originais incompletos. Nenhum valor será reconstruído.');
 let serverCents=0,rawItemsTotal=0;
 const lines=items.map((i,index)=>{const q=i.quantidade??i.quantity,u=i.precoFinalUnitario??i.precoUnitario??i.unitPriceSnapshot;
  if(typeof q!=='number'||!Number.isFinite(q)||q<=0||typeof u!=='number'||!Number.isFinite(u)||u<0)fail('invalid-argument','Quantidade ou preço original inválido.');
  const unitCents=Math.round(u*100),lineCents=Math.round(q*unitCents);if(!Number.isSafeInteger(unitCents)||!Number.isSafeInteger(lineCents))fail('invalid-argument','Valor fora do limite seguro.');serverCents+=lineCents;rawItemsTotal+=q*u;
  return{index,...pick(i,['produtoId','productId','variantId','quantidade','quantity','precoOriginal','precoFinalUnitario','precoUnitario','unitPriceSnapshot','subtotalOriginal','subtotalFinal','desconto','descontoTipo']),rawLineTotal:q*u,originalUnitReported:typeof i.precoOriginal==='number'?i.precoOriginal:null,rawDiscountFromReportedOriginal:typeof i.precoOriginal==='number'?q*(i.precoOriginal-u):null,campaignDiscounts:(Array.isArray(i.campaignDiscounts)?i.campaignDiscounts:[]).map(d=>pick(d,['campaignId','type','percent','cycles','comboPrice','amount','amountCents'])),serverUnitCents:unitCents,serverLineCents:lineCents};
 });
 const originalCents=Math.round(local*100);if(!Number.isSafeInteger(originalCents)||!Number.isSafeInteger(serverCents))fail('invalid-argument','Total fora do limite seguro.');
 return{originalTotal:local,originalTotalCents:originalCents,rawItemsTotal,reportedTotalMinusRawItems:local-rawItemsTotal,serverExpectedCents:serverCents,differenceCents:serverCents-originalCents,calculationRule:'sum(round(quantity * round(originalFinalUnitPrice * 100)))',...pick(sale,['subtotalOriginal','descontoTotal','ajusteManual','descontoTipo','appliedCampaignIds','formaPagamento','status','paymentState','paymentIntentId']),customerId:sale.clienteId||sale.clientId||sale.customerId||null,lines};
}
function monetaryAnalysisService({db,FieldValue,context,space,validateOriginal,policyFor=defaultPolicy,enabled=true,recoveryEnabled=false}){
 const reader={get:r=>r.get()},root=c=>db.doc('businesses/'+c.businessId),receiptRef=(c,t)=>root(c).collection('saleRecoveryReviews').doc(t.saleId).collection('monetaryAnalysis').doc('receipt'),rawRef=(c,t)=>receiptRef(c,t).parent.doc('original'),indexRef=(c,t)=>root(c).collection('saleRecoveryOperations').doc(t.operationId);
 async function targetsFor(reader,c,data){if(!c.owner)return[];if(c.profile.businessId!==c.businessId||c.profile.uid&&c.profile.uid!==c.uid)fail('permission-denied','A sessão não corresponde à empresa desta análise.');const targets=policyFor(c).filter(t=>!data.spaceId||t.spaceId===data.spaceId);for(const t of targets)await space(reader,c,t.spaceId);return targets;}
 function publicReceipt(r){return pick(r,['kind','schemaVersion','businessId','actorUid','saleId','operationId','spaceId','workspaceGeneration','contentHash','payloadHash','status','commercialEffectsApplied','analysis','remoteChecks','retentionPolicy','retentionReviewAt','receivedAt']);}
 function verified(c,t,r,s,i){return r?.kind===KIND&&r.schemaVersion===1&&r.businessId===c.businessId&&r.actorUid===c.uid&&r.saleId===t.saleId&&r.operationId===t.operationId&&r.spaceId===t.spaceId&&r.workspaceGeneration===(c.business.workspaceGeneration??0)&&r.status==='analysis_received'&&r.commercialEffectsApplied===false&&s?.kind===KIND&&s.actorUid===c.uid&&typeof s.originalJson==='string'&&sha(s.originalJson)===r.contentHash&&s.contentHash===r.contentHash&&s.payloadHash===r.payloadHash&&i?.kind===KIND&&i.businessId===c.businessId&&i.actorUid===c.uid&&i.saleId===t.saleId&&i.operationId===t.operationId&&i.spaceId===t.spaceId&&i.workspaceGeneration===r.workspaceGeneration&&i.contentHash===r.contentHash&&i.payloadHash===r.payloadHash&&i.status==='analysis_only'&&i.commercialEffectsApplied===false;}
 async function status(request){const c=await context(reader,request),targets=await targetsFor(reader,c,request.data),items=[];
  for(const t of targets){const [r,s,i]=await Promise.all([receiptRef(c,t).get(),rawRef(c,t).get(),indexRef(c,t).get()]);if(r.exists||s.exists||i.data()?.kind===KIND){const v=r.data();if(!verified(c,t,v,s.data(),i.data()))fail('failed-precondition','A evidência remota precisa de revisão técnica.');const row=publicReceipt(v),decision=await receiptRef(c,t).parent.doc('decision').get();if(decision.exists)row.recoveryResolution=await recovery.resolution(reader,c,{saleId:t.saleId,operationId:t.operationId,contentHash:v.contentHash,payloadHash:v.payloadHash});items.push(row);}}
  return{kind:KIND,schemaVersion:1,eligible:!!targets.length,intakeEnabled:enabled,targets:targets.map(t=>({...pick(t,['saleId','operationId','spaceId','reportedAmountCents','expectedDiagnosticChecksum','movementIds'])})),items,commercialEffectsApplied:false};
 }
 async function inspectRemote(tx,c,t,sale){
  const b=root(c),refs=[['sale',b.collection('sales').doc(t.saleId)],['receipt',b.collection('processedOperations').doc(t.operationId)],['saleFinancial',b.collection('saleFinancials').doc(t.saleId)],['financialRoute',b.collection('financialIncomeRoutes').doc(sha('sale:'+t.saleId))],['income',db.doc(`financialSpaces/${t.spaceId}/entries/sale_${t.saleId}`)],...t.movementIds.flatMap(id=>[['movement:'+id,b.collection('stockMovements').doc(id)],['movementFinancial:'+id,b.collection('stockMovementFinancials').doc(id)]])];
  const values=await Promise.all(refs.map(([,ref])=>tx.get(ref))),present=refs.filter((_,i)=>values[i].exists).map(([key])=>key),queries=[];
  for(const[col,key,value]of [['stockMovements','operationId',t.operationId],['stockMovements','vendaId',t.saleId],['payments','operationId',t.operationId],['payments','saleId',t.saleId],['balanceEvents','operationId',t.operationId],['balanceEvents','sourceDocumentId',t.saleId],['balanceAdjustments','operationId',t.operationId],['paymentAllocations','saleId',t.saleId],['paymentIntents','saleId',t.saleId]]){const q=await tx.get(b.collection(col).where(key,'==',value).limit(21));queries.push({collection:col,field:key,count:q.size,complete:q.size<=20,documentIds:q.docs.slice(0,20).map(d=>d.id)});}
  const candidates=await tx.get(b.collection('sales').where('spaceId','==',t.spaceId).limit(501)),signature=items=>canonical((items||[]).map(i=>[i.produtoId||i.productId,i.variantId||null,i.quantidade??i.quantity]).sort((a,b)=>canonical(a).localeCompare(canonical(b))));
  const expected=signature(sale.itens),matches=candidates.docs.filter(d=>d.id!==t.saleId&&Array.isArray(d.data().itens)&&signature(d.data().itens)===expected).slice(0,20).map(d=>{const s=d.data();return{saleId:d.id,operationId:s.operationId||null,spaceId:s.spaceId,at:s.data||s.createdAt||null,total:s.valorFinal??s.valorTotal??null,sameTotal:Math.round(Number(s.valorFinal??s.valorTotal)*100)===Math.round(Number(sale.valorFinal??sale.valorTotal)*100),paymentMethod:s.formaPagamento||null,status:s.status||null};});
  return{checkedAt:new Date().toISOString(),presentDocuments:present,queries,possibleDuplicates:matches,duplicateComparisonComplete:candidates.size<=500,candidateLimit:500,absenceOfDuplicatesProven:false,commercialEffectsApplied:false};
 }
 async function submit(request){
  if(request.data?.confirmation!=='ENVIAR_PARA_ANALISE'||request.data?.schemaVersion!==1)fail('invalid-argument','Confirme explicitamente o envio somente para análise.');
  return db.runTransaction(async tx=>{const c=await context(tx,request);if(!c.owner)fail('permission-denied','Somente o gestor autorizado pode enviar estas evidências.');const targets=await targetsFor(tx,c,request.data);if(!targets.length)fail('permission-denied','Esta sessão não possui ocorrência autorizada para análise.');
   const v=validateOriginal(request.data,c.uid,c.businessId,{monetaryAnalysis:true}),t=targets.find(t=>t.saleId===v.saleId&&t.operationId===v.operationId);if(!t||v.spaceId!==t.spaceId||(v.packet.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('permission-denied','Identificadores, espaço ou geração fora desta análise.');
   if(t.expectedDiagnosticChecksum&&diagnosticChecksum(v.packet.payload)!==t.expectedDiagnosticChecksum)fail('failed-precondition','O pacote diverge do diagnóstico preservado. Nenhum original foi substituído.');
   const expected=[['sales',t.saleId,'create'],...t.productIds.map(id=>['products',id,'update']),...t.movementIds.map(id=>['stockMovements',id,'create'])].map(x=>x.join(':')).sort(),actual=v.packet.payload.writes.map(w=>[w.entityType,w.entityId,w.operation].join(':')).sort();if(canonical(expected)!==canonical(actual))fail('failed-precondition','O pacote contém destinos diferentes dos originais inventariados. Nada será reprocessado.');
   const rr=receiptRef(c,t),raw=rawRef(c,t),index=indexRef(c,t),[previous,stored,op]=await Promise.all([tx.get(rr),tx.get(raw),tx.get(index)]),payloadHash=sha(canonical(v.packet.payload));
   if(previous.exists||stored.exists||op.exists){const p=previous.data(),s=stored.data(),i=op.data();if(!verified(c,t,p,s,i)||p.contentHash!==request.data.contentHash||p.payloadHash!==payloadHash||s.originalJson!==request.data.originalJson)fail('failed-precondition','Há evidência diferente para estes IDs. Os originais foram preservados; nenhum dado foi sobrescrito.');return{...publicReceipt(p),duplicate:true};}
   if(!enabled)fail('failed-precondition','Novos envios estão temporariamente pausados. Evidências existentes continuam preservadas.');
   const analysis=calculate(v.sale),remoteChecks=await inspectRemote(tx,c,t,v.sale),receipt={kind:KIND,schemaVersion:1,businessId:c.businessId,actorUid:c.uid,saleId:t.saleId,operationId:t.operationId,spaceId:t.spaceId,workspaceGeneration:c.business.workspaceGeneration??0,contentHash:request.data.contentHash,payloadHash,status:'analysis_received',commercialEffectsApplied:false,analysis,remoteChecks,consent:{confirmation:'ENVIAR_PARA_ANALISE',actorUid:c.uid},reportedCommercialConfirmation:{source:'support_human_report_2026-10-28',paymentReceivedReported:true,goodsDeliveredReported:true,notRecreatedReported:true,authenticatedOwnerAttestation:false},retentionPolicy:'preserve_open_incident_review_after_90_days_no_automatic_deletion',retentionReviewAt:Timestamp.fromMillis(Date.now()+90*86400000),receivedAt:FieldValue.serverTimestamp()};
   // Exactly three evidence/fence documents. No commercial service or data writer.
   tx.create(raw,{kind:KIND,originalJson:request.data.originalJson,contentHash:request.data.contentHash,payloadHash,actorUid:c.uid,receivedAt:FieldValue.serverTimestamp()});
   tx.create(rr,receipt);tx.create(index,{kind:KIND,businessId:c.businessId,actorUid:c.uid,saleId:t.saleId,operationId:t.operationId,spaceId:t.spaceId,workspaceGeneration:receipt.workspaceGeneration,contentHash:receipt.contentHash,payloadHash,status:'analysis_only',commercialEffectsApplied:false});
   return{...publicReceipt(receipt),receivedAt:null,duplicate:false};
  });
 }
 async function loadVerified(reader,c,data){
  const targets=await targetsFor(reader,c,data),t=targets.find(t=>t.saleId===data.saleId&&t.operationId===data.operationId);if(!t)fail('permission-denied','Esta sessão não pode decidir sobre estes identificadores.');
  const [rr,raw,op]=await Promise.all([reader.get(receiptRef(c,t)),reader.get(rawRef(c,t)),reader.get(indexRef(c,t))]),r=rr.data(),s=raw.data();
  if(!verified(c,t,r,s,op.data())||data.contentHash&&data.contentHash!==r.contentHash||data.payloadHash&&data.payloadHash!==r.payloadHash)fail('failed-precondition','Os recibos e originais precisam de conferência.');
  const v=validateOriginal(s,c.uid,c.businessId,{monetaryAnalysis:true});if(v.operationId!==t.operationId||v.saleId!==t.saleId||v.spaceId!==t.spaceId||sha(canonical(v.packet.payload))!==r.payloadHash||t.expectedDiagnosticChecksum&&diagnosticChecksum(v.packet.payload)!==t.expectedDiagnosticChecksum)fail('failed-precondition','O original diverge da evidência recebida.');
  return{...v,contentHash:r.contentHash,payloadHash:r.payloadHash,target:t};
 }
 const recovery=require('./sale-monetary-recovery').monetaryRecovery({db,FieldValue,context,space,loadVerified,enabled:recoveryEnabled});
 return{submit,status,preview:recovery.preview,decide:recovery.decide,resolution:async(reader,c,data)=>{
  // An unrelated monetary incident must not abort a mixed read-only batch of
  // older recovery reviews. No evidence or commercial authority is inferred.
  if(!policyFor(c).some(t=>t.saleId===data.saleId&&t.operationId===data.operationId))return{saleId:data.saleId,operationId:data.operationId,status:'unconfirmed'};
  return recovery.resolution(reader,c,data);
 }};
}
module.exports={monetaryAnalysisService,calculate,diagnosticChecksum,KIND};
