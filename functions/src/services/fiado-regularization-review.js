'use strict';

const {createHash}=require('node:crypto');
const {FieldPath}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const Account=require('../shared/fiado-account');
const {resolveOrigins}=require('../shared/fiado-history-origins');
const {operationalCommitService}=require('./operational-commit-service');
const {readHistoryInput}=require('./fiado-history-service');
const {evidenceDigest,regularizationService}=require('./fiado-history-regularization');
const {validId}=require('./workspace-reset-policy');

const collection='fiadoOriginReviews';
const kinds={sales:'credit_sale',payments:'payment_received',balanceAdjustments:'balance_adjustment'};
const active=row=>row.active!==false&&row.ativo!==false&&!row.deletedAt&&!row.cancelledAt&&!row.desfeita;
const allowed=row=>row.testOnly!==true&&row.isQA!==true&&row.qa!==true;
const deny=()=>{throw new HttpsError('permission-denied','Central de regularização indisponível para esta conta.');};
const invalid=(message,reason)=>{throw new HttpsError('failed-precondition',message,{reason});};
const iso=value=>value?.toDate?.().toISOString()||value||null;
const canonical=value=>JSON.stringify(value,(_,data)=>data&&typeof data==='object'&&!Array.isArray(data)?
 Object.fromEntries(Object.keys(data).sort().map(key=>[key,data[key]])):data);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const cents=value=>typeof value==='number'&&Number.isSafeInteger(Math.round(value*100))&&Math.abs(value*100-Math.round(value*100))<1e-5?
 Math.round(value*100):null;

function commercialDay(source,event){
 try{
  const day=Account.commercialDay({...source,occurredAt:source.occurredAt||source.data||event?.appliedAt});
  return day==='0001-01-01'?null:day;
 }catch{return null;}
}

function ledgerRecords(input,spaces,cutoff){
 const events=new Map(),markers=new Map(input.collections.processedOperations.map(row=>[row.id,row]));
 for(const event of input.collections.balanceEvents){
  if(!Object.hasOwn(kinds,event.sourceCollection)||kinds[event.sourceCollection]!==event.type)continue;
  const key=event.sourceCollection+':'+event.sourceDocumentId;
  const group=events.get(key)||[];
  group.push(event);
  events.set(key,group);
 }
 const records=[];
 for(const [kind,type] of Object.entries(kinds))for(const source of input.collections[kind]){
  if(!allowed(source)||kind==='sales'&&source.formaPagamento!=='fiado')continue;
  const id=kind+':'+source.id,group=events.get(id)||[];
  const event=group.length===1?group[0]:null,marker=markers.get(event?.operationId);
  if(event&&!allowed(event))continue;
  const origins=[...new Set([source,event,marker].flatMap(row=>[row?.spaceId,row?.financialSpaceId]).filter(Boolean))];
  const knownOrigin=origins.length===1?origins[0]:null;
  const date=commercialDay(source,event);
  const valueCents=cents(kind==='sales'?source.creditOriginalAmount??source.valorFinal??source.valorTotal:
   kind==='payments'?source.valor??source.amount:event?.balanceDelta??(source.saldoNovo-source.saldoAnterior));
  const stamp=digest({source,event,marker});
  const link=event&&{sourceCollection:kind,sourceId:source.id,eventId:event.id,operationId:event.operationId};
  const bothTagged=Boolean((source.spaceId||source.financialSpaceId)&&(event?.spaceId||event?.financialSpaceId));
  let destinations=[];
  if(link&&active(source)&&origins.length<=1&&valueCents!==null){
   destinations=spaces.filter(spaceId=>{
    if(knownOrigin&&knownOrigin!==spaceId||bothTagged)return false;
    try{resolveOrigins(input,[{...link,spaceId}]);return true;}catch{return false;}
   });
  }
  const documented=bothTagged&&origins.length===1&&link&&marker?.status==='processed'&&source.operationId===event.operationId;
  const batchEligible=!source.installmentPlan&&!knownOrigin&&origins.length===0&&date!==null&&date<cutoff&&destinations.includes(spaces[0]);
  records.push({id,type,date,valueCents,installment:Boolean(source.installmentPlan),knownOrigin,stamp,link,destinations,batchEligible,
   classification:documented?'known':destinations.length?'pending':'conflict'});
 }
 return records.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||a.id.localeCompare(b.id));
}

function approvedAccounts(policy){
 const {approvedLotBytes,approvedLotSha256,businessId}=policy||{};
 if(approvedLotBytes===undefined&&approvedLotSha256===undefined)return null;
 if(!Buffer.isBuffer(approvedLotBytes)||!/^[a-f0-9]{64}$/.test(approvedLotSha256||'')||
    createHash('sha256').update(approvedLotBytes).digest('hex')!==approvedLotSha256)
  throw Error('Manifesto inicial sem SHA-256 correspondente.');
 const file=JSON.parse(approvedLotBytes.toString('utf8'));
 if(file.businessId!==businessId||!Number.isSafeInteger(file.generation)||file.generation<0||
    !Array.isArray(file.accepted)||!file.accepted.length||file.accepted.length>50)throw Error('Manifesto inicial fora do escopo.');
 const accounts=new Map();
 for(const row of file.accepted){
  const id=validId(row.clientId,'Cliente do manifesto');
  if(accounts.has(id)||!Array.isArray(row.originLinks)||!row.originLinks.length||row.originLinks.length>120)
   throw Error('Contas ou vínculos inválidos no manifesto.');
  accounts.set(id,row.originLinks.map(link=>({sourceCollection:link.sourceCollection,sourceId:link.sourceId,
   eventId:link.eventId,operationId:link.operationId,spaceId:link.spaceId})));
 }
 if(file.accountCount!==accounts.size||file.originLinkCount!==[...accounts.values()].reduce((sum,links)=>sum+links.length,0))
  throw Error('Contagem do manifesto inicial divergente.');
 return {generation:file.generation,accounts};
}

function fiadoRegularizationReviewService(db,{access,now=()=>new Date()}={}){
 const policy=access&&Object.freeze({...access});
 const lot=approvedAccounts(policy);
 const {authorize}=operationalCommitService(db,{now});
 const executor=regularizationService(db,{now});
 const ref=(bid,col,id)=>db.doc('businesses/'+bid+'/'+col+'/'+id);

 async function owner(tx,request,readOnly){
  const data=request.data||{},uid=request.auth?.uid;
  if(policy?.enabled!==true||!policy.ownerUid||!policy.businessId||uid!==policy.ownerUid||data.businessId!==policy.businessId)deny();
  const scope=await authorize(tx,request,{businessId:data.businessId,userId:uid,workspaceGeneration:data.workspaceGeneration??0},{readOnly});
  if(!scope.owner||scope.business.ownerId!==uid||scope.member?.status!=='active')deny();
  return scope;
 }

 async function load(tx,scope,clientId){
  const client=(await tx.get(ref(scope.bid,'clients',clientId))).data();
  const generation=scope.business.workspaceGeneration??0;
  if(!client||client.businessId&&client.businessId!==scope.bid||(client.workspaceGeneration??0)!==generation||
     !active(client)||!allowed(client)||!(cents(client.saldo)<0))deny();
  const spaces=[policy.adiSpaceId,policy.cardSpaceId];
  if(!spaces.every(id=>typeof id==='string')||new Set(spaces).size!==2||!/^\d{4}-\d{2}-\d{2}$/.test(policy.legacyBefore||''))deny();
  const checked=await Promise.all(spaces.map(id=>scope.space(id)));
  if(checked.some(space=>space.status==='archived'||space.workspaceGeneration!==undefined&&space.workspaceGeneration!==generation))deny();

  const doc=ref(scope.bid,collection,clientId);
  const stored=(await tx.get(doc)).data();
  const current=stored?.workspaceGeneration===generation?stored:{};
  const input=await readHistoryInput({tx,c:scope,ref,clientId,client,checkRowAccess:false,useActivatedOrigins:false});
  const fromLot=lot?.generation===generation?lot.accounts.get(clientId)||[]:[];
  const records=ledgerRecords(input,spaces,policy.legacyBefore).map(row=>({...row,
   fromInitialLot:fromLot.some(link=>row.link&&link.sourceCollection===row.link.sourceCollection&&link.sourceId===row.link.sourceId&&
    link.eventId===row.link.eventId&&link.operationId===row.link.operationId&&row.destinations.includes(link.spaceId))}));
  const byId=new Map((current.decisions||[]).map(row=>[row.recordId,row]));
  const list=records.map(record=>{
   const prior=byId.get(record.id);
   const decision=prior?.stamp===record.stamp?prior:null;
   return {...record,batchEligible:record.batchEligible&&!decision,decision};
  });
  const financialDigest=evidenceDigest(input);
  const version=current.revision||null;
  const revision=digest([financialDigest,version,list.map(row=>[row.id,row.stamp,row.batchEligible,row.destinations])]);
  const unresolved=list.some(row=>row.classification!=='known'&&(!row.decision?.spaceId||row.classification==='conflict'));
  const publicRecords=list.map(({link,stamp,...row})=>row);
  return {doc,clientId,generation,financialDigest,revision,byId,list,
   summary:{clientId,name:client.nome||'Cliente',bookBalanceCents:-cents(client.saldo),revision,
    openingEnabled:policy.openingEnabled===true,openingConfirmed:!!client.fiadoOpeningBalance,
    state:unresolved||!list.length?'origin_pending':'balance_to_validate',
    spaces:[{id:spaces[0],name:'Adi Festa'},{id:spaces[1],name:'Emprestar Cartão'}],records:publicRecords}};
 }

 function read(request,fn){
  return db.runTransaction(async tx=>{
   const scope=await owner(tx,request,true);
   return fn(tx,scope);
  },{readOnly:true});
 }
 const clientId=request=>validId(request.data?.clientId,'Cliente');
 const account=request=>read(request,(tx,scope)=>load(tx,scope,clientId(request))).then(result=>result.summary);

 const list=request=>read(request,async(tx,scope)=>{
  const count=request.data?.limit??20;
  if(!Number.isSafeInteger(count)||count<1||count>25)throw new HttpsError('invalid-argument','Limite inválido.');
  const generation=scope.business.workspaceGeneration??0;
  const lotAvailable=lot?.generation===generation;
  const visible=doc=>{
   const row=doc.data();
   return row&&active(row)&&allowed(row)&&(!row.businessId||row.businessId===scope.bid)&&
    (row.workspaceGeneration??0)===generation&&cents(row.saldo)<0;
  };
  const summarize=doc=>({clientId:doc.id,name:doc.data().nome||'Cliente',bookBalanceCents:-cents(doc.data().saldo)});
  if(request.data?.lotOnly===true){
   if(!lotAvailable)invalid('O manifesto inicial ainda não está disponível.','fiado-review-lot-unavailable');
   const ids=[...lot.accounts.keys()];
   const cursor=request.data.cursor;
   if(cursor&&!lot.accounts.has(cursor))invalid('Reabra o lote para atualizar a página.','fiado-review-stale');
   const start=cursor?ids.indexOf(cursor)+1:0,selected=ids.slice(start,start+count);
   const docs=selected.length?await tx.getAll(...selected.map(id=>ref(scope.bid,'clients',id))):[];
   return {accounts:docs.filter(visible).map(summarize),nextCursor:start+count<ids.length?selected.at(-1):null,approvedLotAvailable:true};
  }
  const base=ref(scope.bid,'clients','__unused__').parent.where('saldo','<',0).orderBy('saldo').orderBy(FieldPath.documentId());
  const scanLimit=count*3+1;
  let query=base.limit(scanLimit);
  if(request.data?.cursor){
   const cursor=await tx.get(ref(scope.bid,'clients',validId(request.data.cursor,'Cursor')));
   if(!cursor.exists||!(cents(cursor.data().saldo)<0))invalid('Reabra a lista para atualizar a página.','fiado-review-stale');
   query=query.startAfter(cursor);
  }
  const snapshots=(await tx.get(query)).docs,accounts=[];
  let last=null;
  for(const doc of snapshots){
   if(accounts.length===count)break;
   last=doc.id;
   if(visible(doc))accounts.push(summarize(doc));
  }
  const more=last&&(last!==snapshots.at(-1)?.id||snapshots.length===scanLimit);
  return {accounts,nextCursor:more?last:null,approvedLotAvailable:lotAvailable};
 });

 function proposed(snapshot,data){
  if(data.revision!==snapshot.revision)invalid('A conta mudou. Confira novamente antes de salvar.','fiado-review-stale');
  if(!['batch','individual'].includes(data.mode)||!Array.isArray(data.items)||!data.items.length||
     data.items.length>(data.mode==='batch'?30:1))throw new HttpsError('invalid-argument','Seleção de conferência inválida.');
  const rows=new Map(snapshot.list.map(row=>[row.id,row])),ids=new Set();
  const items=data.items.map(item=>{
   const row=rows.get(item?.recordId);
   const spaceId=item?.spaceId??null;
   const note=typeof item?.note==='string'?item.note.trim():'';
   if(!row||ids.has(row.id)||row.classification==='known'||note.length>240||
      spaceId!==null&&!row.destinations.includes(spaceId)||
      data.mode==='batch'&&(!row.batchEligible||spaceId!==policy.adiSpaceId))
    invalid('Há uma exceção na seleção. Revise esse lançamento individualmente.','fiado-review-origin-conflict');
   ids.add(row.id);
   return {recordId:row.id,stamp:row.stamp,spaceId,note,previousDecisionId:row.decision?.eventId??null};
  }).sort((a,b)=>a.recordId.localeCompare(b.recordId));
  const reviewHash=digest([snapshot.clientId,snapshot.generation,snapshot.revision,data.mode,items]);
  return {items,reviewHash};
 }

 const prepare=request=>read(request,async(tx,scope)=>{
  const snapshot=await load(tx,scope,clientId(request));
  const proposal=proposed(snapshot,request.data);
  const byId=new Map(snapshot.list.map(row=>[row.id,row]));
  return {reviewHash:proposal.reviewHash,revision:snapshot.revision,mode:request.data.mode,
   items:proposal.items.map(item=>{
    const row=byId.get(item.recordId);
    return {recordId:row.id,type:row.type,date:row.date,valueCents:row.valueCents,
     knownOrigin:row.knownOrigin,spaceId:item.spaceId,note:item.note};
   })};
 });

 async function confirm(request){
  return db.runTransaction(async tx=>{
   const scope=await owner(tx,request,false),data=request.data,id=clientId(request);
   const eventId=validId(data.requestId,'Operação');
   if(data.confirmed!==true||!/^[a-f0-9]{64}$/.test(data.reviewHash||''))
    invalid('Confira o resumo e confirme a gravação da evidência.','fiado-review-confirmation-required');
   const doc=ref(scope.bid,collection,id);
   const generation=scope.business.workspaceGeneration??0;
   const eventRef=doc.collection('events').doc(generation+'_'+eventId);
   const prior=(await tx.get(eventRef)).data();
   const requestHash=digest([data.mode,data.revision,data.reviewHash,data.items]);
   if(prior){
    if(prior.actorUid!==scope.uid||prior.workspaceGeneration!==generation||prior.requestHash!==requestHash)
     invalid('A operação já corresponde a outra confirmação.','fiado-review-request-conflict');
    return {status:'replayed',eventId,writesApplied:0};
   }
   const snapshot=await load(tx,scope,id);
   const proposal=proposed(snapshot,data);
   if(proposal.reviewHash!==data.reviewHash)invalid('O resumo mudou. Confira novamente.','fiado-review-stale');
   const at=now().toISOString();
   const updates=proposal.items.map(row=>({...row,eventId,actorUid:scope.uid,at}));
   for(const row of updates)snapshot.byId.set(row.recordId,row);
   const decisions=snapshot.list.map(row=>snapshot.byId.get(row.id)).filter(Boolean);
   if(decisions.length>120)invalid('A conta excede o limite de revisão.','fiado-review-limit');
   tx.create(eventRef,{eventId,actorUid:scope.uid,businessId:scope.bid,workspaceGeneration:generation,
    clientId:id,at,mode:data.mode,reviewHash:proposal.reviewHash,requestHash,items:updates});
   tx.set(doc,{businessId:scope.bid,workspaceGeneration:generation,clientId:id,revision:eventId,decisions});
   return {status:'saved',eventId,writesApplied:2};
  });
 }

 async function review(request){
  const id=clientId(request);
  const snapshot=await read(request,(tx,scope)=>load(tx,scope,id));
  const confirmedOrigins=snapshot.list.filter(row=>row.classification!=='known'&&row.decision?.spaceId).length;
  const progress={revision:snapshot.revision,confirmedOrigins};
  if(snapshot.summary.state==='origin_pending')return {state:'origin_pending',...progress};
  const originLinks=snapshot.list.filter(row=>row.classification!=='known'&&row.decision?.spaceId)
   .map(row=>({...row.link,spaceId:row.decision.spaceId}));
  let result;
  try{result=await executor.review({...request,data:{businessId:request.data.businessId,
   workspaceGeneration:snapshot.generation,clientId:id,...(originLinks.length?{originLinks}:{})}});}
  catch(error){
   if(error.code==='failed-precondition')return {state:'balance_to_validate',reason:error.details?.reason||'history_review',...progress};
   throw error;
  }
  const final=await read(request,(tx,scope)=>load(tx,scope,id));
  if(final.revision!==snapshot.revision||result.evidenceDigest!==snapshot.financialDigest)
   invalid('O saldo ou as confirmações mudaram. Revise novamente.','fiado-review-stale');
  if(result.category!=='eligible_v2_activation'||!result.activationEnabled)
   return {state:'balance_to_validate',reason:result.proof?.reason||result.category,...progress};
  return {state:'ready',...progress,executorReviewHash:result.reviewHash,routing:result.routing,account:result.account};
 }

 async function reviewLot(request){
  const page=await list({...request,data:{businessId:request.data?.businessId,
   workspaceGeneration:request.data?.workspaceGeneration,lotOnly:true,limit:20}});
  if(page.nextCursor)invalid('Divida a revisão em lotes menores.','fiado-review-lot-limit');
  const accounts=[];
  for(let index=0;index<page.accounts.length;index+=3){
   const group=page.accounts.slice(index,index+3);
   accounts.push(...await Promise.all(group.map(async({clientId,name})=>({
    clientId,name,...await review({...request,data:{businessId:request.data.businessId,
     workspaceGeneration:request.data.workspaceGeneration,clientId}})
   }))));
  }
  return {accounts,spaces:[{id:policy.adiSpaceId,name:'Adi Festa'},{id:policy.cardSpaceId,name:'Emprestar Cartão'}]};
 }

 const accessCheck=request=>read(request,()=>({available:true}));
 return {access:accessCheck,list,account,prepare,confirm,review,reviewLot};
}

module.exports={fiadoRegularizationReviewService};
