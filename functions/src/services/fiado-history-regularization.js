'use strict';
// Fiado history regularization (proposal, V2 of this candidate).
//
// Scope: accounts whose traditional projection (V1) no longer reproduces the
// book balance, but whose confirmed ledger (balanceEvents + processed markers)
// proves the debt (V2). Regularizing such an account means ONLY activating the
// already-shipped V2 contract (`client.fiadoHistoryVersion = 1`). No balance,
// sale, payment, allocation, ledger event or legacy snapshot is created or
// changed, and no retroactive receipt is invented.
//
// The planner is pure/read-only and reuses the production proof, the V2
// projection and the receipt routing decision unchanged. The review/apply/
// rollback commands use the operational backend authorization (`authorize`)
// and its containment switch. They are NOT exported by functions/src/index.js
// and are not deployed by this change.

const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const History=require('../shared/fiado-history-account');
const {prove}=require('../shared/fiado-history-proof');
const Plan=require('../shared/installment-plan');
const {readHistoryInput}=require('./fiado-history-service');
const {decideReceiptRoute}=require('./fiado-receipt-route');
const {ORIGIN_AUDIT_COLLECTION,resolveOrigins,withOrigins,originLinksDigest,activationAuditMatches}=require('../shared/fiado-history-origins');

const ACTIVATION_VERSION=1;
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
const sha=v=>createHash('sha256').update(canonical(v)).digest('hex');
const normalize=v=>v?.toDate?v.toDate().toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;
const cents=value=>{const n=Math.round(Number(value||0)*100);if(!Number.isSafeInteger(n))throw Error('invalid-money');return n;};
const activationId=(clientId,financialVersion)=>`fiado_history_activation_${clientId}_v${financialVersion}`;
const fail=(code,message,reason,extra={})=>{throw new HttpsError(code,message,{reason,...extra});};

// ---------- Minimal evidence specification ----------
// Every field read by prove(), History.project(), readHistoryInput() and
// decideReceiptRoute() for a Fiado account. The dry-run snapshot needs only
// these fields, and the evidence digest covers exactly these fields, so a
// minimized export and the live documents produce the same digest.
const OWNERSHIP=['id','businessId','workspaceGeneration','clienteId','clientId','customerId','spaceId','financialSpaceId'];
const LIFECYCLE=['status','applicationStatus','active','deletedAt','cancelledAt','desfeita','operationId','data','createdAt','financialAppliedAt'];
const FIELD_SPEC=Object.freeze({
 clients:['id','businessId','workspaceGeneration','saldo','financialVersion','legacyBalance','legacyBalanceRemaining','hasInstallmentFiado','fiadoHistoryVersion','active','ativo','deletedAt','cancelledAt','desfeita'],
 sales:[...OWNERSHIP,...LIFECYCLE,'formaPagamento','valorFinal','valorTotal','creditOriginalAmount','creditPaidAmount','creditRemainingAmount','creditSettled',
  'installmentPlan','occurredAt','commercialDate','priorSale','financialOperationId','financialReversedAt','financialReversalEventId','cancelOperationId','saldoAnterior','saldoAtual','saldoNovo'],
 payments:[...OWNERSHIP,...LIFECYCLE,'valor','amount','allocatedAmount','legacyAmount','resolutionOperationId','saldoAnterior','saldoNovo'],
 balanceAdjustments:[...OWNERSHIP,...LIFECYCLE,'saldoAnterior','saldoNovo'],
 balanceEvents:[...OWNERSHIP,'status','type','sourceCollection','sourceDocumentId','operationId','appliedAt','balanceDelta','balanceBefore','balanceAfter','reversesEventId'],
 paymentAllocations:['id','businessId','workspaceGeneration','clientId','paymentId','saleId','amount','spaceId','financialSpaceId'],
 processedOperations:['id','businessId','workspaceGeneration','status','eventKind','spaceId','financialSpaceId'],
 financialSpaces:['id','businessId','linkedBusinessId','workspaceGeneration','status','active','type','financialType','legacyFinancialType','capabilities'],
});
// priorSale is read only for its commercial date; capabilities only for sales.
const NESTED=Object.freeze({priorSale:['commercialDate'],capabilities:['sales']});
function pick(row,fields){
 const out={};
 for(const key of fields){
  if(!Object.hasOwn(row||{},key)||row[key]===undefined)continue;
  const value=normalize(row[key]);
  out[key]=NESTED[key]&&value&&typeof value==='object'?Object.fromEntries(NESTED[key].filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]])):value;
 }
 return out;
}
function minimizeSnapshot(snapshot){
 const docs=(name,rows)=>({docs:rows.map(row=>pick(row,FIELD_SPEC[name]))});
 return{format:'veconi-fiado-regularization-snapshot/1',businessId:snapshot.businessId,generation:snapshot.generation??0,exportedAt:snapshot.exportedAt??null,readTime:snapshot.readTime??null,
  clients:docs('clients',snapshot.clients.docs),
  collections:Object.fromEntries(['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations','processedOperations'].map(name=>[name,docs(name,snapshot.collections[name]?.docs||[])])),
  spaces:docs('financialSpaces',snapshot.spaces?.docs||[])};
}
// Identity-ordered digest of the minimal evidence of one account.
function evidenceDigest(input){
 const collections=Object.fromEntries(Object.entries(input.collections).map(([name,rows])=>[name,rows.map(row=>pick(row,FIELD_SPEC[name])).sort((a,b)=>String(a.id).localeCompare(String(b.id)))]));
 return sha({version:ACTIVATION_VERSION,businessId:input.businessId,generation:input.generation,client:pick(input.client,FIELD_SPEC.clients),collections});
}
const withoutActivation=input=>({...input,client:Object.fromEntries(Object.entries(input.client).filter(([k])=>!['fiadoHistoryVersion','fiadoHistoryActivation'].includes(k)))});

const originsOf=account=>{const spaces=[...new Set(account.entries.map(e=>e.spaceId).filter(Boolean))].sort();return{spaces,hasUnknown:account.entries.some(e=>!e.spaceId)};};

// Categories:
//  no_debt, already_active, v1_consistent       -> nothing to regularize
//  eligible_v2_activation                         -> candidate (explicit owner confirmation still required)
//  alias_review                                   -> verifiable ID link; needs an attestation step, never automatic
//  activation_without_route                       -> V2 proves the debt but not a single known origin / no receipt route
//  individual_review                              -> no sufficient proof; never automated
async function classify({input,day,route,originLinks=[]}){
 Plan.date(day);
 const client=input.client,saldoCents=cents(client.saldo),base={clientId:client.id,financialVersion:Number(client.financialVersion||0),saldoCents,evidenceDigest:evidenceDigest(input)};
 if(originLinks.length&&client.fiadoHistoryActivation!==undefined)return{...base,category:'already_active'};
 if(!originLinks.length&&client.fiadoHistoryVersion===1)return{...base,category:'already_active'};
 if(originLinks.length)return classifyOrigins({input,day,route,originLinks,base});
 if(saldoCents>=0)return{...base,category:'no_debt'};
 const proof=prove(input,day);
 const summary={strictEligible:proof.strictEligible,strictError:proof.strictError,financialProof:proof.financialProof,reason:proof.reason,details:proof.details||[]};
 if(proof.strictEligible)return{...base,category:'v1_consistent',proof:summary};
 if(!proof.financialProof){
  const alias=(proof.details||[]).includes('operation-alias-requires-review');
  return{...base,category:alias?'alias_review':'individual_review',proof:summary,issues:proof.issues};
 }
 let account;
 try{account=History.project(input,day);}catch(error){return{...base,category:'individual_review',proof:{...summary,projectionError:error.message}};}
 if(account.totalCents!==-saldoCents||account.creditCents!==0||account.financialVersion!==base.financialVersion)
  return{...base,category:'individual_review',proof:{...summary,projectionError:'projection-book-mismatch'}};
 const origins=originsOf(account);
 const accountSummary={version:account.version,asOf:account.asOf,dueCents:account.dueCents,futureCents:account.futureCents,totalCents:account.totalCents,entries:account.entries.length,anchor:proof.anchor,effectsAfterAnchor:proof.effectsAfterAnchor};
 const result={...base,proof:summary,account:accountSummary,origins};
 // Activation turns the account into a "scheduled" one for routing: the owner-only
 // "original origin" route is no longer available. Only a single, known origin
 // keeps a receipt route after activation.
 if(origins.spaces.length!==1||origins.hasUnknown)return{...result,category:'activation_without_route'};
 const spaceId=origins.spaces[0];
 const before=await route(client,spaceId),after=await route({...client,fiadoHistoryVersion:1},spaceId);
 const routing={spaceId,before:before.mode==='blocked'?{mode:'blocked',reason:before.reason}:{mode:before.mode},after:after.mode==='blocked'?{mode:'blocked',reason:after.reason}:{mode:after.mode,dueCents:after.dueCents,futureCents:after.futureCents,totalCents:after.totalCents}};
 if(after.mode!=='space'||after.totalCents!==account.totalCents)return{...result,routing,category:'activation_without_route'};
 return{...result,routing,category:'eligible_v2_activation',plannedWrite:{
  path:`businesses/${input.businessId}/clients/${client.id}`,
  set:{fiadoHistoryVersion:1,fiadoHistoryActivation:{version:ACTIVATION_VERSION,activationId:activationId(client.id,base.financialVersion),evidenceDigest:base.evidenceDigest}},
  unchanged:['saldo','financialVersion','legacyBalance','legacyBalanceRemaining','hasInstallmentFiado'],
  audit:`businesses/${input.businessId}/auditLogs/${activationId(client.id,base.financialVersion)}`}};
}
async function classifyOrigins({input,day,route,originLinks,base}){
 const blocked=reason=>({...base,category:'activation_without_route',proof:{reason}});
 if(base.saldoCents>=0)return blocked('no_debt');
 const candidate=withOrigins(input,originLinks);
 const proof=prove(candidate,day);
 if(!proof.financialProof)return blocked(proof.reason);
 let account;
 try{account=History.project(candidate,day,{scoped:true});}catch(error){return blocked(error.message);}
 if(account.totalCents!==-base.saldoCents||account.financialVersion!==base.financialVersion||account.creditCents!==0)
  return blocked('projection-book-mismatch');
 const origins=originsOf(account);
 if(origins.hasUnknown||!origins.spaces.length)return blocked('origin_unverified');
 const summarize=decision=>decision.mode==='blocked'?{mode:'blocked',reason:decision.reason}:
  {mode:decision.mode,dueCents:decision.dueCents,futureCents:decision.futureCents,totalCents:decision.totalCents};
 const activated={...input.client,fiadoHistoryVersion:1,fiadoHistoryActivation:{version:ACTIVATION_VERSION,
  source:'fiado_history_regularization',originLinksDigest:originLinksDigest(originLinks),financialVersion:base.financialVersion,
  activationId:activationId(base.clientId,base.financialVersion),activatedBy:'review-only',evidenceDigest:base.evidenceDigest,reviewHash:'0'.repeat(64)}};
 const routing=[];
 for(const spaceId of origins.spaces){
  const after=await route(activated,spaceId,1,originLinks);
  if(after.mode!=='space'||after.scopedReceiptVersion!==1)return blocked(after.reason||'origin_unverified');
  routing.push({spaceId,before:summarize(await route(input.client,spaceId,1)),after:summarize(after)});
 }
 if(routing.reduce((sum,row)=>sum+row.after.totalCents,0)!==account.totalCents)return blocked('scoped-total-mismatch');
 const {version,asOf,dueCents,futureCents,totalCents}=account;
 return {...base,category:'eligible_v2_activation',originLinks,origins,routing,
  proof:{strictError:proof.strictError??null},
  account:{version,asOf,dueCents,futureCents,totalCents,entries:account.entries.length,anchor:proof.anchor,effectsAfterAnchor:proof.effectsAfterAnchor}};
}

// Binds the owner's confirmation to everything the decision depends on.
const reviewHash=plan=>sha({version:ACTIVATION_VERSION,clientId:plan.clientId,category:plan.category,evidenceDigest:plan.evidenceDigest,financialVersion:plan.financialVersion,saldoCents:plan.saldoCents,account:plan.account,origins:plan.origins,routing:plan.routing,originLinks:plan.originLinks});

// ---------- Read-only snapshot adapter (offline dry-run) ----------
function snapshotReader(snapshot,{spaces={}}={}){
 const docs=new Map();
 const put=(col,row)=>docs.set(`businesses/${snapshot.businessId}/${col}/${row.id}`,{...row});
 for(const row of snapshot.clients.docs)put('clients',row);
 for(const [col,{docs:rows}] of Object.entries(snapshot.collections))for(const row of rows)put(col,row);
 const docRef=path=>({path,id:path.split('/').at(-1),get parent(){return collection(path.split('/').slice(0,-1).join('/'));}});
 const collection=path=>({path,id:path.split('/').at(-1),where:(field,op,value)=>{if(op!=='==')throw Error('unsupported-query');return{limit:n=>({path,field,value,limit:n})};}});
 const snap=(path,data)=>({id:path.split('/').at(-1),exists:data!==undefined,data:()=>data===undefined?undefined:structuredClone(data)});
 const overrides=new Map();
 const tx={
  async get(target){
   if(target.field){const rows=[...docs.entries()].filter(([p,d])=>p.startsWith(target.path+'/')&&p.split('/').length===target.path.split('/').length+1&&d[target.field]===target.value).slice(0,target.limit);
    return{size:rows.length,docs:rows.map(([p,d])=>snap(p,d))};}
   return snap(target.path,overrides.has(target.path)?overrides.get(target.path):docs.get(target.path));
  },
  async getAll(...refs){return Promise.all(refs.map(r=>tx.get(r)));},
 };
 const ref=(bid,col,id)=>docRef(`businesses/${bid}/${col}/${id}`);
 const context=()=>{
  const business={id:snapshot.businessId,ownerId:'dry-run-owner',workspaceGeneration:snapshot.generation??0,active:true};
  return{uid:'dry-run-owner',bid:snapshot.businessId,business,owner:true,role:'owner',member:{role:'owner',status:'active'},has:()=>true,access:{canMutate:true},
   space:async id=>{const value=spaces[id]||snapshot.spaces?.docs?.find(s=>s.id===id);if(!value||value.active===false)throw new HttpsError('permission-denied','Espaço não autorizado.');return value;}};
 };
 return{tx,ref,context,overrides};
}

async function planSnapshot(snapshot,{day=Plan.today(),spaces}={}){
 const reader=snapshotReader(snapshot,{spaces}),c=reader.context(),rows=[];
 for(const client of snapshot.clients.docs){
  if(cents(client.saldo)>=0&&client.fiadoHistoryVersion!==1)continue;
  let input;
  try{input=await readHistoryInput({tx:reader.tx,c,ref:reader.ref,clientId:client.id,client,checkRowAccess:false,useActivatedOrigins:false});}
  catch(error){rows.push({clientId:client.id,category:'individual_review',proof:{reason:'history-read-failed:'+error.message}});continue;}
  const route=async(override,spaceId)=>{
   const path=reader.ref(c.bid,'clients',client.id).path;reader.overrides.set(path,override);
   try{return await decideReceiptRoute({tx:reader.tx,c,ref:reader.ref,clientId:client.id,spaceId,now:new Date(day+'T15:00:00.000Z')});}
   finally{reader.overrides.delete(path);}
  };
  rows.push(await classify({input,day,route}));
 }
 const counts=rows.reduce((n,r)=>(n[r.category]=(n[r.category]||0)+1,n),{});
 return{version:ACTIVATION_VERSION,mode:'dry-run',writesApplied:0,businessId:snapshot.businessId,generation:snapshot.generation??0,asOf:day,counts,rows};
}

// ---------- Backend commands (for review; not exported by index.js) ----------
// review   -> read-only plan + reviewHash (no writes)
// apply    -> requires confirmed:true and the current reviewHash; writes marker + audit + sync signal
// rollback -> removes an activation only while no financial effect happened after it
// All three: authenticated active OWNER via the operational backend context
// (user profile, membership, subscription/writability, workspace generation).
function regularizationService(db,{now=()=>new Date(),commitModule=require('./operational-commit-service')}={}){
 const ref=(bid,col,id)=>db.doc(`businesses/${bid}/${col}/${id}`);
 const authorize=commitModule.operationalCommitService(db,{now}).authorize;
 const activationEnabled=()=>commitModule.HISTORY_ACTIVATION_ENABLED===true;
 const auditCollection=activation=>activation?.originLinksDigest!==undefined?ORIGIN_AUDIT_COLLECTION:'auditLogs';

 async function owner(tx,request,readOnly){
  const d=request.data||{},uid=request.auth?.uid;
  const c=await authorize(tx,request,{businessId:d.businessId,userId:uid,workspaceGeneration:d.workspaceGeneration??0},{readOnly});
  if(!c.owner||c.business.ownerId!==c.uid)fail('permission-denied','Somente o proprietário pode regularizar o histórico.','fiado-regularization-owner-only');
  if(typeof d.clientId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(d.clientId))fail('invalid-argument','Cliente inválido.','fiado-regularization-invalid-client');
  return c;
 }
 async function readClient(tx,c,clientId){
  const clientRef=ref(c.bid,'clients',clientId),snap=await tx.get(clientRef),client=snap.data();
  if(!client||client.businessId&&client.businessId!==c.bid||(client.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))
   fail('failed-precondition','Cliente fora da empresa ou geração.','fiado-regularization-foreign-client');
  return {clientRef,client:normalize(client)};
 }
 async function load(tx,c,clientId,initial){
  const {clientRef,client}=initial||await readClient(tx,c,clientId);
  const input=await readHistoryInput({tx,c,ref,clientId,client,checkRowAccess:false,useActivatedOrigins:false});
  return{clientRef,client,input};
 }
 async function plan(tx,c,clientId,day,requested,initial){
  const {clientRef,client,input}=await load(tx,c,clientId,initial);
  let originLinks=[];
  if(requested!==undefined&&client.fiadoHistoryActivation===undefined){
   try{originLinks=resolveOrigins(input,requested);}catch(error){fail('failed-precondition',error.message,'fiado-regularization-origin-proof');}
   await checkOriginSpaces(tx,c,originLinks,input);
  }
  // Route simulation reads the client through an overlay; nothing is written here.
  const overlay=(override,previewLinks)=>({
   async get(target){
    if(target.path===clientRef.path)return {id:clientId,exists:true,data:()=>override};
    const activation=override.fiadoHistoryActivation;
    if(previewLinks&&activation?.activatedBy==='review-only'&&target.path===ref(c.bid,ORIGIN_AUDIT_COLLECTION,activation.activationId).path){
     return {exists:true,data:()=>({type:'fiado_history_activation',businessId:c.bid,workspaceGeneration:input.generation,clientId,
      activationId:activation.activationId,actorUid:activation.activatedBy,originLinks:previewLinks,
      evidenceDigest:activation.evidenceDigest,reviewHash:activation.reviewHash})};
    }
    return tx.get(target);
   },
   getAll:(...refs)=>tx.getAll(...refs)
  });
  const route=(override,spaceId,scopedReceiptVersion,previewLinks)=>decideReceiptRoute({tx:overlay(override,previewLinks),c,ref,clientId,spaceId,now:new Date(day+'T15:00:00.000Z'),scopedReceiptVersion});
  return{clientRef,client,input,plan:await classify({input,day,route,originLinks})};
 }
 async function checkOriginSpaces(tx,c,links,input){
  for(const id of new Set(links.map(link=>link.spaceId))){
   const space=await c.space(id);
   if(space.workspaceGeneration!==undefined&&space.workspaceGeneration!==input.generation)
    fail('failed-precondition','Espaço de outra geração.','fiado-regularization-origin-proof');
  }
  const payments=links.filter(link=>link.sourceCollection==='payments');
  if(!payments.length)return;
  const spaces=db.collection('financialSpaces');
  const snapshots=await Promise.all(['businessId','linkedBusinessId'].map(field=>tx.get(spaces.where(field,'==',c.bid).limit(101))));
  if(snapshots.some(snapshot=>snapshot.size>100))fail('failed-precondition','Conjunto de caixas excede o limite seguro.','fiado-regularization-origin-cash');
  const ids=[...new Set(snapshots.flatMap(snapshot=>snapshot.docs.map(doc=>doc.id)))];
  if(ids.length*payments.length>1000)fail('failed-precondition','Conjunto de caixas excede o limite seguro.','fiado-regularization-origin-cash');
  const refs=payments.flatMap(link=>ids.map(id=>spaces.doc(id).collection('entries').doc('credit_payment_'+link.sourceId)));
  const records=refs.length?await tx.getAll(...refs):[];
  const byPayment=new Map();
  for(const record of records.filter(record=>record.exists)){
   const rows=byPayment.get(record.id)||[];
   rows.push(record);
   byPayment.set(record.id,rows);
  }
  for(const link of payments){
   const [cash,...duplicates]=byPayment.get('credit_payment_'+link.sourceId)||[];
   const row=cash?.data(),source=input.collections.payments.find(payment=>payment.id===link.sourceId);
   if(!row||duplicates.length||cash.ref.parent.parent.id!==link.spaceId||row.sourceId!==link.sourceId||
     row.amountCents!==cents(source.valor??source.amount)||row.direction!=='in'||row.status!=='paid')
    fail('failed-precondition','Entrada de caixa histórica sem correspondência única.','fiado-regularization-origin-cash');
   link.cashPath=cash.ref.path;
   link.cashProof=sha([link.cashPath,row.sourceId,row.amountCents,row.direction,row.status]);
  }
 }
 const today=()=>Plan.today(now());
 const signal=(tx,c,id)=>tx.set(db.doc(`businesses/${c.bid}`).collection('syncMetadata').doc('last-sync'),{businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,publisher:'operational_server',
  sourceSessionId:'server:'+id,sourceOperationId:id,ownerId:c.uid,actorUid:c.uid,sourceUid:c.uid,revision:'server:'+id,updatedAt:now(),changedCollections:['clients'],collectionVersions:{clients:'server:'+id}},{merge:true});

 async function review(request){
  return db.runTransaction(async tx=>{
   const c=await owner(tx,request,true),day=today(),{plan:p}=await plan(tx,c,request.data.clientId,day,request.data.originLinks);
   return{mode:'review',writesApplied:0,activationEnabled:activationEnabled(),asOf:day,...p,reviewHash:reviewHash(p)};
  },{readOnly:true});
 }

 async function apply(request){
  const d=request.data||{};
  if(d.confirmed!==true||!/^[a-f0-9]{64}$/.test(d.reviewHash||''))fail('failed-precondition','Confirme explicitamente a revisão atual antes de ativar.','fiado-regularization-confirmation-required');
  return db.runTransaction(async tx=>{
   const c=await owner(tx,request,false);
   // Containment can still answer a replay from its marker and audit without
   // relocking the ledger or requiring the historical quote to be current.
   const initial=await readClient(tx,c,d.clientId),{client,clientRef}=initial;
   if(client.fiadoOpeningBalance)fail('A conta já possui saldo final confirmado.','failed-precondition','fiado-opening-active');
   if(client.fiadoHistoryVersion===1){
    const marker=client.fiadoHistoryActivation;
    if(marker?.source==='fiado_history_regularization'&&marker.reviewHash===d.reviewHash){
     const id=activationId(d.clientId,marker.financialVersion);
     const audit=marker.activationId===id?(await tx.get(ref(c.bid,auditCollection(marker),id))).data():null;
     const scope={businessId:c.bid,generation:c.business.workspaceGeneration??0,client:{id:d.clientId}};
     if(!audit||audit.clientId!==d.clientId||audit.reviewHash!==d.reviewHash||
       marker.originLinksDigest!==undefined&&!activationAuditMatches(marker,audit,scope))fail('failed-precondition','Ativação sem auditoria válida.','fiado-regularization-audit-missing');
     return{status:'replayed',activationId:id,writesApplied:0};
    }
    if(marker!==undefined||!Array.isArray(d.originLinks)||!d.originLinks.length)return{status:'already_active',writesApplied:0};
   }
   if(!activationEnabled())fail('failed-precondition','Novas ativações do histórico estão pausadas.','fiado-history-activation-paused');
   const {plan:p}=await plan(tx,c,d.clientId,today(),d.originLinks,initial);
   const id=activationId(d.clientId,p.financialVersion);
   if(p.category!=='eligible_v2_activation')fail('failed-precondition','Conta não elegível para regularização automática.','fiado-regularization-not-eligible',{category:p.category});
   if(reviewHash(p)!==d.reviewHash)fail('failed-precondition','O histórico mudou desde a revisão. Revise novamente.','fiado-regularization-stale');
   const collection=p.originLinks?ORIGIN_AUDIT_COLLECTION:'auditLogs';
   const audit=ref(c.bid,collection,id),rolledBack=ref(c.bid,collection,id+'_rollback');
   const [auditSnap,rollbackSnap]=await Promise.all([tx.get(audit),tx.get(rolledBack)]);
   if(rollbackSnap.exists)fail('failed-precondition','Esta ativação foi revertida; reativar exige revisão individual.','fiado-regularization-previously-rolled-back');
   if(auditSnap.exists)fail('failed-precondition','Evidência de ativação sem marcador no cliente; revisão individual obrigatória.','fiado-regularization-audit-orphan');
   const at=now().toISOString(),activation={version:ACTIVATION_VERSION,activationId:id,evidenceDigest:p.evidenceDigest,reviewHash:d.reviewHash,financialVersion:p.financialVersion,saldoCents:p.saldoCents,activatedAt:at,activatedBy:c.uid,source:'fiado_history_regularization',...(p.originLinks?{originLinksDigest:originLinksDigest(p.originLinks)}:{})};
   tx.create(audit,{type:'fiado_history_activation',businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,actorUid:c.uid,clientId:d.clientId,activationId:id,
    evidenceDigest:p.evidenceDigest,reviewHash:d.reviewHash,financialVersion:p.financialVersion,saldoCents:p.saldoCents,account:p.account,origins:p.origins,routing:p.routing,...(p.originLinks?{originLinks:p.originLinks}:{}),
    proof:{anchor:p.account.anchor,effectsAfterAnchor:p.account.effectsAfterAnchor,strictError:p.proof.strictError},clientBefore:pick(client,FIELD_SPEC.clients),createdAt:at});
   // Only the routing marker and the sync envelope change. saldo, financialVersion and legacy snapshots stay as they are.
   tx.update(clientRef,{fiadoHistoryVersion:1,fiadoHistoryActivation:activation,updatedAt:now(),updatedByUid:c.uid});
   signal(tx,c,id);
   return{status:'activated',activationId:id,writesApplied:3,routing:p.routing,account:p.account};
  });
 }

 // Safe reversal: allowed only for activations made by this command and only
 // while the evidence is byte-for-byte what was activated (no receipt, sale,
 // adjustment or cancellation since). Otherwise individual review is required.
 async function rollback(request){
  const d=request.data||{};
  if(d.confirmed!==true||typeof d.reason!=='string'||d.reason.trim().length<5)fail('failed-precondition','Informe o motivo e confirme a reversão.','fiado-regularization-rollback-confirmation');
  return db.runTransaction(async tx=>{
   const c=await owner(tx,request,false);
   const {clientRef,client,input}=await load(tx,c,d.clientId),activation=client.fiadoHistoryActivation;
   if(client.fiadoOpeningBalance)fail('A conta já possui saldo final confirmado.','failed-precondition','fiado-opening-active');
   if(activation===undefined&&typeof d.activationId==='string'&&/^fiado_history_activation_[\w-]+_v\d+$/.test(d.activationId)){
    const prior=await tx.getAll(...['auditLogs',ORIGIN_AUDIT_COLLECTION].map(col=>ref(c.bid,col,d.activationId+'_rollback')));
    if(prior.map(snap=>snap.data()).some(row=>row?.clientId===d.clientId&&row.activationId===d.activationId&&row.workspaceGeneration===input.generation))
     return{status:'replayed',writesApplied:0};
   }
   if(client.fiadoHistoryVersion!==1){
    fail('failed-precondition','A conta não está ativada.','fiado-regularization-not-active');
   }
   if(activation?.source!=='fiado_history_regularization'||!activation.activationId)
    fail('failed-precondition','Ativação feita por recebimento ou parcela não pode ser revertida por esta rotina.','fiado-regularization-rollback-foreign');
   const collection=auditCollection(activation);
   const audit=await tx.get(ref(c.bid,collection,activation.activationId));
   const record=audit.data();
   if(!record||record.clientId!==d.clientId||record.reviewHash!==activation.reviewHash||record.evidenceDigest!==activation.evidenceDigest||
      activation.originLinksDigest!==undefined&&!activationAuditMatches(activation,record,input))
    fail('failed-precondition','Ativação sem auditoria; revisão individual obrigatória.','fiado-regularization-audit-missing');
   const baseline=withoutActivation(input),previousVersion=record.clientBefore.fiadoHistoryVersion;
   if(previousVersion!==undefined)baseline.client.fiadoHistoryVersion=previousVersion;
   const current=evidenceDigest(baseline);
   if(current!==activation.evidenceDigest||Number(client.financialVersion||0)!==activation.financialVersion||cents(client.saldo)!==activation.saldoCents)
    fail('failed-precondition','Houve movimento financeiro após a ativação; a reversão exige revisão individual.','fiado-regularization-rollback-requires-review');
   const rollbackRef=ref(c.bid,collection,activation.activationId+'_rollback'),at=now().toISOString();
   tx.create(rollbackRef,{type:'fiado_history_activation_rollback',businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,actorUid:c.uid,clientId:d.clientId,
    activationId:activation.activationId,evidenceDigest:current,reason:d.reason.trim(),activation,createdAt:at});
   const {FieldValue}=require('firebase-admin/firestore');
   tx.update(clientRef,{fiadoHistoryVersion:previousVersion??FieldValue.delete(),fiadoHistoryActivation:FieldValue.delete(),updatedAt:now(),updatedByUid:c.uid});
   signal(tx,c,activation.activationId+'_rollback');
   return{status:'rolled_back',activationId:activation.activationId,writesApplied:3};
  });
 }
 return{review,apply,rollback};
}

module.exports={ACTIVATION_VERSION,FIELD_SPEC,activationId,evidenceDigest,minimizeSnapshot,reviewHash,classify,snapshotReader,planSnapshot,regularizationService};
