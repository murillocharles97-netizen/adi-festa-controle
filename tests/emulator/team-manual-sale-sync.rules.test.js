'use strict';
// Real Vendas -> diffWrites -> Sync transaction/ack/queue against local Rules.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const source=fs.readFileSync('js/firebase/sync.js','utf8'),published=execFileSync('git',['show','d6c97fa1ab704beecb8fe4b02d96368ebdb25815:js/firebase/sync.js'],{encoding:'utf8',maxBuffer:2e6});
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const bid='team-manual-'+Date.now().toString(36),a=bid+'-a',b=bid+'-b',owner='audit-owner',seller='audit-seller',cashier='audit-cashier';
let env,sanitizer,sequence=0;
const grants={'sales.create':true,'products.view':true,'inventory.view':true,'customers.view':true,'sales.viewAll':false,'financial.view':false,'customers.receiveDebt':false,'customers.adjustBalance':false,'cost.view':false,'profit.view':false,'team.view':false,'team.manage':false,'settings.manage':false};
const bridge=x=>x instanceof Date?x:Array.isArray(x)?Array.from(x,bridge):x&&Object.prototype.toString.call(x)==='[object Object]'&&!x._methodName&&typeof x.toDate!=='function'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,bridge(v)])):x;
const path=(name,id)=>['businesses',bid,name,id];
async function admin(fn){let result;await env.withSecurityRulesDisabled(async c=>{result=await fn(c.firestore());});return result;}
async function read(name,id){return admin(db=>sdk.getDoc(sdk.doc(db,...path(name,id))));}
async function list(name){return admin(db=>sdk.getDocs(sdk.collection(db,'businesses',bid,name)));}
async function seed(variable=false,space=a){
 const id='qa-product-'+(++sequence),p={id,businessId:bid,ownerId:owner,nome:'QA equivalente Bauny',preco:24.9,estoqueAtual:3,estoque:3,totalStock:3,ativo:true,active:true,schemaVersion:3,itemKind:'product',productType:variable?'variable':'simple',spaceAccessMode:'selected_spaces',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1};
 const variants=variable?[{id:id+'-variant',businessId:bid,ownerId:owner,parentProductId:id,displayName:'QA',attributeValues:{Cor:'QA'},stock:3,price:24.9,active:true,schemaVersion:3}]:[];
 await admin(async db=>{await sdk.setDoc(sdk.doc(db,...path('products',id)),p);for(const v of variants)await sdk.setDoc(sdk.doc(db,...path('productVariants',v.id)),v);});
 return{p,variants};
}
async function pipeline(uid,{variable=false,space=a,customer=false,productOverrides={},productCount=1}={}){
 const {p,variants}=await seed(variable,space);
 Object.assign(p,productOverrides);await admin(db=>sdk.setDoc(sdk.doc(db,...path('products',p.id)),p));
 const data={config:{},produtos:[p],variacoesProdutos:variants,clientes:[],vendas:[],movimentacoes:[],movimentacoesEstoque:[],campanhas:[],progressosCampanha:[]};
 for(let n=1;n<productCount;n++)data.produtos.push((await seed(false,space)).p);
 if(customer){const c={id:'qa-client-'+sequence,businessId:bid,nome:'QA',saldo:0,totalComprado:0,quantidadeVendas:0,active:true};data.clientes.push(c);await admin(db=>sdk.setDoc(sdk.doc(db,...path('clients',c.id)),c));}
 const before=structuredClone(data),role=uid===owner?'owner':uid===cashier?'cashier':'seller',client=env.authenticatedContext(uid).firestore(),origin=Object.freeze({businessId:bid,workspaceGeneration:0,uid});
 let queue=[],acknowledged=0;
 const names={products:'produtos',productVariants:'variacoesProdutos',clients:'clientes',sales:'vendas',stockMovements:'movimentacoesEstoque'};
 const c={console,structuredClone,Date,crypto,TextEncoder,Utils:{uuid:crypto.randomUUID},db:client,doc:sdk.doc,deleteField:sdk.deleteField,serverTimestamp:sdk.serverTimestamp,increment:sdk.increment,getDocFromServer:sdk.getDocFromServer,currentUser:{uid},currentPath:'',activeBusinessId:()=>bid,stableLegacyOperationId:i=>i.operationId,legacyReconciliationOperationId:id=>`legacy_reconciliation:${id}`,normalizeText:x=>String(x||'').toLowerCase(),sanitizeForFirestore:x=>sanitizer(bridge(x)),queuePreflight:()=>({ok:true}),IDEMPOTENT_EVENT_NAMES:new Set(['sales','stockMovements']),SOURCES:Object.fromEntries(Object.entries(names).map(([n,key])=>[n,{key}])),sourceItems:(d,n)=>d[names[n]]||[],now:()=>new Date().toISOString(),DB:{getBusinessId:()=>bid,carregar:()=>data,alterar:fn=>fn(data),salvar:next=>Object.assign(data,next),flush:async()=>{}},TeamAccess:{has:permission=>role==='owner'||grants[permission]===true,actor:()=>({actorUid:uid,actorNameSnapshot:'QA',actorRoleSnapshot:role})},SpaceContext:{requireSalesSpace:id=>id||space,stockMovementOrigin:(_p,id)=>({businessId:bid,spaceId:id||space})},Campanhas:{aplicarVendaNoBanco:()=>[]},WorkspaceRuntime:{capture:()=>origin},dispatchEvent(){},CustomEvent:class{},processingPromise:null,readOnlyMode:false,cloudPaused:false,navigator:{onLine:true},lastErrorCode:'',lastError:'',readQueue:()=>structuredClone(queue),saveQueue:q=>{queue=structuredClone(q);},queueCounts:()=>({total:queue.length,errors:queue.filter(i=>i.status==='error').length,corrupt:false}),queueErrorBreakdown:()=>({}),validateUser:async()=>{},updateQueueState(){},canAttempt:()=>true,emit(){},errorCode:e=>String(e.code||'').replace(/^firestore\//,''),friendlyError:e=>e.message,reportError(){},markLocalSaleConfirmed:item=>{acknowledged++;data.vendas.find(s=>s.operationId===item.operationId).syncConfirmedAt=new Date().toISOString();},markLocalPaymentConfirmed(){}};
 c.CLOUD_NAMES=Object.keys(names);
 c.syncSessionGeneration=1;c.auth={currentUser:{uid}};c.state={userProfile:{uid,businessId:bid}};
 c.readPaths=[];
 c.DB.getWorkspaceGeneration=()=>0;
 c.window=c;vm.createContext(c);
 vm.runInContext(section(source,'function saleQueueRequiresReview(','const readPullState'),c);
 vm.runInContext(section(published,'function saleTimingWait(','async function syncStep('),c);
 for(const f of ['js/product-variations.js','js/vendas.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
 const vmSdk={...sdk,runTransaction:(db,fn)=>sdk.runTransaction(db,t=>fn({get:r=>{c.readPaths.push(r.path);return t.get(r);},set:(r,d,o)=>t.set(r,bridge(d),o),update:(r,d)=>t.update(r,bridge(d)),delete:r=>t.delete(r)}))};
 c.runTransaction=require('../../js/workspace-writer.js').create({sdk:vmSdk,runtime:()=>c.WorkspaceRuntime}).runTransaction;
 vm.runInContext(fs.readFileSync('js/firebase/product-import-fence.js','utf8').replace('export ',''),c);
 for(const [start,end]of [['function enrich(','function archiveQueue('],['function changedFields(','function captureChanges('],['function financialEffectFromWrites(','const readSignalVersions'],['async function commitQueueItem(','function rollbackPaymentConflict('],['async function processSyncQueue(','function pendingIds(']])vm.runInContext(section(source,start,end),c);
 const sale=c.Vendas.registrar({id:crypto.randomUUID(),operationId:crypto.randomUUID(),spaceId:space,clienteId:customer?data.clientes[0].id:null,status:'pago',formaPagamento:'dinheiro',itens:data.produtos.map((product,n)=>({produtoId:product.id,variantId:n===0?variants[0]?.id||null:null,quantidade:1,precoOriginal:24.9,precoFinalUnitario:24.9}))});
 const packet={queueId:crypto.randomUUID(),operationId:sale.operationId,businessId:bid,userId:uid,payloadVersion:4,createdAtLocal:sale.data,status:'pending',attempts:0,payload:{eventKind:'sale',writes:bridge(c.diffWrites(before,data))}};
 queue=[structuredClone(packet)];
 return{data,p,variants,sale,packet,client,context:c,queue:()=>structuredClone(queue),setQueue:q=>{queue=structuredClone(q);},acknowledged:()=>acknowledged,run:()=>c.processSyncQueue({force:true}),commit:()=>c.commitQueueItem(structuredClone(packet)),old:()=>vm.runInContext(section(published,'async function commitQueueItem(','async function verifySaleQueueCommit('),c),fixed:()=>vm.runInContext(section(source,'async function commitQueueItem(','async function verifySaleQueueCommit('),c)};
}
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 sanitizer=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js','utf8')))).sanitizeForFirestore;
 await admin(async db=>{
  await sdk.setDoc(sdk.doc(db,'businesses',bid),{ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
  for(const uid of [owner,seller,cashier]){const role=uid===owner?'owner':uid===cashier?'cashier':'seller';await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role,active:true});await sdk.setDoc(sdk.doc(db,...path('members',uid)),{uid,role,status:'active',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:uid===owner?[]:[a],permissions:grants});}
  for(const space of [a,b])await sdk.setDoc(sdk.doc(db,'financialSpaces',space),{id:space,businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{sales:true,inventory:true,products:true,finance:true}});
 });
});
test.after(async()=>env?.cleanup());
for(const uid of [seller,cashier])for(const variable of [false,true])test(`${uid}/${variable?'variation':'simple'}: denied old sale stays untouched; fresh sale commits once`,async()=>{
 const legacy=await pipeline(uid,{variable,customer:!variable}),original=structuredClone(legacy.packet.payload);
 legacy.old();const failed=await legacy.run();assert.equal(failed.sent,0);assert.equal(legacy.queue()[0].lastErrorCode,'permission-denied',legacy.queue()[0].lastErrorMessage);assert.equal(legacy.queue()[0].attempts,1);
 const heldPacket=JSON.stringify(legacy.queue());legacy.fixed();legacy.context.readPaths.length=0;
 const held=await legacy.run();assert.equal(held.reviewHeld,1);assert.equal(held.sent,0);assert.equal(JSON.stringify(legacy.queue()),heldPacket);assert.equal(legacy.context.readPaths.length,0);assert.deepEqual(legacy.queue()[0].payload,original);
 await assert.rejects(legacy.context.commitQueueItem(legacy.queue()[0]),{code:'sale-recovery-review-required'});
 assert.equal((await read('sales',legacy.sale.id)).exists(),false);assert.equal((await read('products',legacy.p.id)).data().estoqueAtual,3);
 const p=await pipeline(uid,{variable,customer:!variable}),payload=structuredClone(p.packet.payload);
 const recovered=await p.run();assert.equal(recovered.sent,1,JSON.stringify(p.queue().map(i=>({error:i.lastErrorMessage,path:i.lastErrorPath}))));assert.equal(recovered.pending,0);assert.equal(p.queue().length,0);assert.equal(p.acknowledged(),1);
 assert.ok(p.context.readPaths.some(path=>path.includes('/stockMovements/')));assert.equal(p.context.readPaths.some(path=>/\/(balanceAdjustments|saleFinancials|productFinancials|stockMovementFinancials)\//.test(path)),false);
 assert.deepEqual(p.packet.payload,payload);assert.equal((await read('sales',p.sale.id)).data().actorUid,uid);assert.equal((await read('sales',p.sale.id)).data().spaceId,a);
 await Promise.all([p.commit(),p.commit()]);assert.equal((await read('products',p.p.id)).data().estoqueAtual,2);
 if(variable)assert.equal((await read('productVariants',p.variants[0].id)).data().stock,2);
 assert.equal((await list('stockMovements')).docs.filter(s=>s.data().operationId===p.sale.operationId).length,1);
 const movement=(await list('stockMovements')).docs.find(s=>s.data().operationId===p.sale.operationId).data();assert.equal(movement.actorUid,uid);assert.equal(movement.spaceId,a);assert.equal(movement.businessId,bid);assert.equal(movement.quantidade,-1);
 assert.equal((await list('sales')).docs.filter(s=>s.data().operationId===p.sale.operationId).length,1);
 if(!variable)assert.equal((await read('clients',p.data.clientes[0].id)).data().quantidadeVendas,1);
 const ownerDb=env.authenticatedContext(owner).firestore(),remote=await sdk.getDocFromServer(sdk.doc(ownerDb,...path('sales',p.sale.id)));assert.equal(remote.data().valorFinal,24.9);
 for(const [name,id]of [['balanceAdjustments','legacy_reconciliation:'+p.sale.id],['productFinancials',p.p.id],['saleFinancials',p.sale.id],['members',owner],['settings','default']]){
  if(name==='settings')await assertFails(sdk.setDoc(sdk.doc(p.client,...path(name,id)),{businessId:bid}));
  else await assertFails(sdk.getDoc(sdk.doc(p.client,...path(name,id))));
 }
 assert.equal((await read('saleFinancials',p.sale.id)).exists(),false);
});
test('owner equivalent manual sale still commits through canonical pipeline',async()=>{const p=await pipeline(owner);await p.run();assert.equal(p.queue().length,0);assert.equal((await read('products',p.p.id)).data().estoqueAtual,2);});
test('lost response after commit keeps original queue; retry does not debit again',async()=>{
 const p=await pipeline(seller),commit=p.context.commitQueueItem;let first=true;p.context.commitQueueItem=async item=>{await commit(item);if(first){first=false;throw Object.assign(Error('QA lost response'),{code:'unavailable'});}};
 await p.run();assert.equal(p.queue().length,1);assert.equal((await read('products',p.p.id)).data().estoqueAtual,2);await p.run();assert.equal(p.queue().length,0);assert.equal((await read('products',p.p.id)).data().estoqueAtual,2);
});
test('private reconciliation tombstone rejects seller replay and direct create atomically',async()=>{
 const p=await pipeline(seller);await admin(db=>sdk.setDoc(sdk.doc(db,...path('balanceAdjustments','legacy_reconciliation:'+p.sale.id)),{businessId:bid,resolutionStatus:'resolved_by_reconciliation',resolvedSaleId:p.sale.id}));
 await p.run();assert.equal(p.queue().length,1);assert.equal(p.queue()[0].lastErrorCode,'permission-denied');assert.equal((await read('products',p.p.id)).data().estoqueAtual,3);assert.equal((await read('sales',p.sale.id)).exists(),false);
 await assertFails(sdk.setDoc(sdk.doc(p.client,...path('sales',p.sale.id)),{id:p.sale.id,businessId:bid,spaceId:a,financialSpaceId:a,actorUid:seller,valorFinal:24.9,status:'pago'}));
});
test('other-space stock and forged actor stay denied with no partial writes',async()=>{
 const p=await pipeline(seller,{space:b});await p.run();assert.equal(p.queue().length,1);assert.equal((await read('products',p.p.id)).data().estoqueAtual,3);assert.equal((await read('sales',p.sale.id)).exists(),false);
 const own=await pipeline(seller);own.packet.payload.writes.find(w=>w.entityType==='sales').data.actorUid=owner;await assertFails(own.commit());assert.equal((await read('products',own.p.id)).data().estoqueAtual,3);
});
test('private and existing other-space movements stay unreadable; missing-marker read is scoped to membership',async()=>{
 const otherId='other-space-movement';await admin(db=>sdk.setDoc(sdk.doc(db,...path('stockMovements',otherId)),{businessId:bid,spaceId:b,produtoId:'not-allowed',quantidade:-1}));
 const client=env.authenticatedContext(seller).firestore();await assertFails(sdk.getDoc(sdk.doc(client,...path('stockMovements',otherId))));
 await assertFails(sdk.getDoc(sdk.doc(client,'businesses','another-business','stockMovements','missing-marker')));
 await assertFails(sdk.getDoc(sdk.doc(env.unauthenticatedContext().firestore(),...path('stockMovements','missing-marker'))));
});
test('recovery keeps the queue and all stock when remote units are reserved meanwhile',async()=>{
 const p=await pipeline(seller);await admin(db=>sdk.updateDoc(sdk.doc(db,...path('products',p.p.id)),{onlineReservedStock:3}));await p.run();assert.equal(p.queue().length,1);assert.equal(p.queue()[0].lastErrorCode,'online-stock-reserved');assert.equal((await read('products',p.p.id)).data().estoqueAtual,3);assert.equal((await read('sales',p.sale.id)).exists(),false);
});
test('equivalent all-spaces product: old denied sale stays held; new sale debits once without rewriting unrelated aggregate',async()=>{
 const p=await pipeline(seller,{productOverrides:{spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,estoqueAtual:1,estoque:1,totalStock:6}}),payload=structuredClone(p.packet.payload);
 p.old();await p.run();assert.equal(p.queue()[0].lastErrorCode,'permission-denied');assert.equal((await read('products',p.p.id)).data().estoqueAtual,1);
 const heldPacket=JSON.stringify(p.queue());p.fixed();await p.run();assert.equal(JSON.stringify(p.queue()),heldPacket);assert.deepEqual(p.packet.payload,payload);assert.equal((await read('products',p.p.id)).data().estoqueAtual,1);
 const fresh=await pipeline(seller,{productOverrides:{spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,estoqueAtual:1,estoque:1,totalStock:6}});await fresh.run();await fresh.commit();const stock=(await read('products',fresh.p.id)).data();assert.equal(stock.estoqueAtual,0);assert.equal(stock.estoque,0);assert.equal(stock.totalStock,6);assert.equal(stock.spaceAccessMode,'all_spaces');
});
test('four held operations survive forced sync/reload unchanged while a new sale syncs',async()=>{
 const p=await pipeline(seller),held=[];
 for(let n=0;n<4;n++){const row=structuredClone(p.packet);row.queueId=crypto.randomUUID();row.operationId=crypto.randomUUID();row.status='error';row.lastErrorCode='permission-denied';row.lastErrorMessage='Missing or insufficient permissions.';row.attempts=n+1;const s=row.payload.writes.find(w=>w.entityType==='sales');s.entityId=crypto.randomUUID();s.data.id=s.entityId;s.data.operationId=row.operationId;held.push(row);}
 const snapshot=JSON.stringify(held);p.setQueue([...held,p.packet]);const result=await p.run();assert.equal(result.sent,1);assert.equal(result.reviewHeld,4);assert.equal(JSON.stringify(p.queue()),snapshot);assert.equal((await read('products',p.p.id)).data().estoqueAtual,2);
 p.setQueue(JSON.parse(snapshot));await p.run();assert.equal(JSON.stringify(p.queue()),snapshot);for(const row of held){assert.equal((await read('sales',row.payload.writes.find(w=>w.entityType==='sales').entityId)).exists(),false);assert.equal((await read('processedOperations',row.operationId)).exists(),false);}
});
for(const uid of [seller,cashier])test(`${uid}: new five-product sale commits atomically with five movements`,async()=>{
 const p=await pipeline(uid,{productCount:5});const result=await p.run();assert.equal(result.sent,1,JSON.stringify(p.queue().map(q=>q.lastErrorMessage)));assert.equal(p.queue().length,0);await p.commit();
 for(const product of p.data.produtos)assert.equal((await read('products',product.id)).data().estoqueAtual,2);
 assert.equal((await list('stockMovements')).docs.filter(s=>s.data().operationId===p.sale.operationId).length,5);
});
