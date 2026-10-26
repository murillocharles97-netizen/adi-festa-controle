'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module'),crypto=require('node:crypto');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required; no production');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore'),req=createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,FieldValue}=req('firebase-admin/firestore'),{saleRecoveryService}=require('../../functions/src/services/sale-recovery-service'),{operationalCommitService}=require('../../functions/src/services/operational-commit-service'),{financialIncomeService}=require('../../functions/src/services/financial-income-service'),f=require('../helpers/customer-recovery-v205.cjs');
let app,db,env,service,seq=0;
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-veconi-v205',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-veconi-v205'},'customer-recovery');db=getFirestore(app);service=saleRecoveryService(db,{FieldValue});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup({finance=false,stock=6}={}){
 const bid='qa-customer-recovery-'+(++seq),owner='qa-owner-'+seq,seller='qa-seller-'+seq,space='qa-space-'+seq,other='qa-other-'+seq,root=db.doc('businesses/'+bid);
 await root.set({active:true,ownerId:owner,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const [uid,role]of [[owner,'owner'],[seller,'seller']]){await db.doc('users/'+uid).set({uid,businessId:bid,role,active:true});await root.collection('members').doc(uid).set({uid,role,status:'active',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[space],permissions:{'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true}});}
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{sales:true,products:true,inventory:true,finance},automation:{enabled:true,activatedAt:'2026-01-01T00:00:00Z',autoIncome:{sales:true}}});
 const sample=f.sample(0),original=JSON.parse(JSON.stringify(sample.original).replaceAll(f.bid,bid).replaceAll(f.spaceId,space).replaceAll(f.seller,seller)),dependency=original.clientDependencies[0];
 for(const id of original.localSale.itens.map(i=>i.produtoId))await root.collection('products').doc(id).set({id,businessId:bid,estoqueAtual:stock,estoque:stock,totalStock:stock,active:true,productType:'simple',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space});
 const request=(data,uid=owner)=>({auth:{uid},data:{businessId:bid,workspaceGeneration:0,...data}}),envelope=()=>({...f.envelope(original),businessId:bid});
 const upload=()=>service.submit(request(envelope(),seller));
 const decide=(action,extra={},uid=owner)=>service.decide(request({saleId:original.localSale.id,contentHash:envelope().contentHash,revision:0,action,confirmation:action==='approve_client'?'APROVAR_CADASTRO':'RECUPERAR',...(action==='recover_original'?{operationalEvidence:{goodsDelivered:true,paymentReceived:true,notRecreated:true}}:{}),...extra},uid));
 return{bid,owner,seller,space,other,root,original,dependency,request,upload,decide,envelope};
}
const count=async(c,col)=>(await c.root.collection(col).get()).size;
// Two simultaneous Firestore transactions may abort one request. Explicitly
// retry that SAME decision, never synthesize another recovery identity.
async function concurrentDecision(work){
 const first=await Promise.allSettled([work(),work()]),results=[];
 for(const r of first){if(r.status==='fulfilled')results.push(r.value);else{assert.ok([3,10,'aborted'].includes(r.reason.code),String(r.reason));results.push(await work());}}
 return results;
}
test('seller real shape: denied customer + dependent sale, no receipt or stock; owner approval never changes seller grants',async()=>{
 const c=await setup(),svc=operationalCommitService(db),p=c.dependency.packet,grants=await c.root.collection('members').doc(c.seller).get(),original=JSON.stringify(c.original);
 await assert.rejects(svc.commit(c.request({item:p},c.seller)),/Sem permissão para editar/);
 await assert.rejects(svc.commit(c.request({item:c.original.packet},c.seller)),/Cliente não confirmado/);
 assert.equal(await count(c,'sales'),0);assert.equal(await count(c,'stockMovements'),0);assert.equal(await count(c,'processedOperations'),0);
 await c.upload();await assert.rejects(c.decide('approve_client',{},c.seller),{code:'permission-denied'});
 const r=await c.decide('approve_client');assert.equal(r.clientId,p.payload.writes[0].entityId);assert.equal(await count(c,'clients'),1);assert.equal(await count(c,'sales'),0);assert.equal(await count(c,'stockMovements'),0);assert.equal(await count(c,'balanceEvents'),0);assert.equal((await c.root.collection('members').doc(c.seller).get()).updateTime.toMillis(),grants.updateTime.toMillis());assert.equal(JSON.stringify(c.original),original);
});
test('approval lost response/concurrent click and retry of same sale: one client, sale, movement and financial income',async()=>{
 const c=await setup({finance:true}),before=JSON.stringify(c.original);await c.upload();
 const approvals=await concurrentDecision(()=>c.decide('approve_client'));assert.equal(approvals.filter(r=>!r.idempotent).length,1);assert.equal((await c.decide('approve_client')).idempotent,true);
 const results=await concurrentDecision(()=>c.decide('recover_original'));assert.equal(results.filter(r=>!r.idempotent).length,1);assert.equal((await c.decide('recover_original')).idempotent,true);
 assert.equal(await count(c,'sales'),1);assert.equal(await count(c,'stockMovements'),1);assert.equal(await count(c,'clients'),1);assert.equal(await count(c,'processedOperations'),2);
 const sale=(await c.root.collection('sales').doc(c.original.localSale.id).get()).data(),client=(await c.root.collection('clients').get()).docs[0].data();
 assert.equal(sale.operationId,c.original.packet.operationId);assert.equal(sale.actorUid,c.seller);assert.equal(sale.clienteId,c.dependency.packet.payload.writes[0].entityId);assert.equal(client.saldo,0);assert.equal(client.totalComprado,c.original.localSale.valorFinal);assert.equal(client.quantidadeVendas,1);
 const p=(await c.root.collection('products').doc('shared-product').get()).data();assert.equal(p.estoqueAtual,5);assert.equal(await count(c,'payments'),0);assert.equal(await count(c,'balanceEvents'),0);
 const income=financialIncomeService(db);await Promise.all([income.projectSale(c.bid,sale.id,sale),income.projectSale(c.bid,sale.id,sale)]);assert.equal((await db.collection(`financialSpaces/${c.space}/entries`).get()).size,1);assert.equal((await db.collection(`financialSpaces/${c.other}/entries`).get()).size,0);
 assert.equal(JSON.stringify(c.original),before);assert.equal((await c.root.collection('saleRecoveryReviews').doc(sale.id).collection('original').doc('payload').get()).data().originalJson,c.envelope().originalJson);
 const evidence=(await c.root.collection('saleRecoveryReviews').doc(sale.id).collection('decisions').doc('1').get()).data();assert.equal(evidence.operationalEvidence.paymentReceived,true);assert.equal(evidence.paymentEvidenceSource,'explicit_owner_attestation_no_collection');
});
test('manual original customer and sale replay remain blocked even after owner approved them',async()=>{const c=await setup();await c.upload();await c.decide('approve_client');await c.decide('recover_original');const svc=operationalCommitService(db);for(const item of [c.dependency.packet,c.original.packet])await assert.rejects(svc.commit(c.request({item},c.seller)),{code:'failed-precondition'});assert.equal(await count(c,'sales'),1);});
test('possible duplicate by phone, email or normalized name blocks creation; no automatic merge/remap',async()=>{
 for(const field of ['telefone','email','nome']){const c=await setup(),data=c.dependency.packet.payload.writes[0].data;if(field==='email')data.email='qa@example.test';await c.root.collection('clients').doc('existing-different-id').set({businessId:c.bid,nome:field==='nome'?'PESSOA FICTÍCIA 0':'Outra QA',...(field==='telefone'?{telefone:'+55 '+data.telefone}:{}),...(field==='email'?{email:'QA@example.test'}:{})});await c.upload();await assert.rejects(c.decide('approve_client'),e=>e.details?.reason==='customer-possible-duplicate');assert.equal(await count(c,'clients'),1);assert.equal(await count(c,'processedOperations'),0);}
});
test('stock shortage, missing dependency approval and real side effect all stop before sale creation',async()=>{
 const missing=await setup();await missing.upload();await assert.rejects(missing.decide('recover_original'),/Confirme primeiro/);assert.equal(await count(missing,'sales'),0);
 const shortage=await setup({stock:0});await shortage.upload();await shortage.decide('approve_client');await assert.rejects(shortage.decide('recover_original'),/insuficiente/);assert.equal(await count(shortage,'sales'),0);assert.equal(await count(shortage,'stockMovements'),0);
 const effect=await setup();await effect.upload();await effect.decide('approve_client');await effect.root.collection('balanceEvents').doc('unexpected').set({operationId:effect.original.packet.operationId,businessId:effect.bid});await assert.rejects(effect.decide('recover_original'),/efeito financeiro/);assert.equal(await count(effect,'sales'),0);
});
test('explicit payment/fulfilment/nonduplicate decision is mandatory; Fiado and extra effects stay blocked',async()=>{
 const c=await setup();await c.upload();await c.decide('approve_client');await assert.rejects(c.decide('recover_original',{operationalEvidence:{goodsDelivered:true,paymentReceived:false,notRecreated:true}}),/Confirme explicitamente/);assert.equal(await count(c,'sales'),0);
 for(const change of [o=>o.packet.payload.writes[0].data.formaPagamento='fiado',o=>o.packet.payload.writes.find(w=>w.entityType==='clients').data.saldo=-10]){const d=await setup();change(d.original);await d.upload();await d.decide('approve_client');await assert.rejects(d.decide('recover_original'));assert.equal(await count(d,'sales'),0);}
});
test('resolution endpoint confirms both IDs/hash, cannot acknowledge foreign actor, changed hash or other space',async()=>{
 const c=await setup();await c.upload();await c.decide('approve_client');await c.decide('recover_original');const p=c.dependency.packet,check={kind:'client_dependency',operationId:p.operationId,clientId:p.payload.writes[0].entityId,payloadHash:require('../../functions/src/services/sale-recovery-customer').hash(p.payload)};
 const ack=await service.list(c.request({resolutionChecks:[check]},c.seller));assert.equal(ack.items[0].status,'client_confirmed');assert.equal(ack.items[0].actorUid,c.seller);assert.equal(ack.items[0].operationId,p.operationId);
 await assert.rejects(service.list(c.request({resolutionChecks:[{...check,payloadHash:'a'.repeat(64)}]},c.seller)),{code:'permission-denied'});await assert.rejects(service.list(c.request({resolutionChecks:[check]},c.owner)),{code:'permission-denied'});
 await assertFails(sdk.getDoc(sdk.doc(env.authenticatedContext(c.seller).firestore(),`financialSpaces/${c.space}/entries/private`)));
 const original=await c.root.collection('saleRecoveryReviews').doc(c.original.localSale.id).collection('original').doc('payload').get();assert.equal(original.data().originalJson,c.envelope().originalJson);
});
test('seven fictitious originals: four denied customers, three dependent sales, explicit sequential recovery preserves all seven identities',async()=>{
 const c=await setup(),raw=JSON.stringify(c.original),packets=[];
 const deps=Array.from({length:4},(_,n)=>{const d=structuredClone(c.dependency),w=d.packet.payload.writes[0];d.packet.operationId='qa-four-client-op-'+n;w.entityId='qa-four-client-'+n;w.data.id=w.entityId;w.data.nome='Pessoa sintética '+n;w.data.telefone='1197777'+String(n).padStart(4,'0');return d;});
 for(let n=1;n<=3;n++){
  const o=JSON.parse(raw.replaceAll(c.original.localSale.id,'qa-three-sale-'+n).replaceAll(c.original.packet.operationId,'qa-three-operation-'+n).replaceAll('movement-0-0','qa-three-movement-'+n).replaceAll(c.dependency.packet.payload.writes[0].entityId,deps[n].packet.payload.writes[0].entityId));
  o.clientDependencies=structuredClone(deps);for(const sale of [o.localSale,o.packet.payload.writes[0].data])sale.data=sale.createdAt=`2026-10-25T18:0${n}:00.000Z`;o.packet.createdAtLocal=o.localSale.data;
  const customer=o.packet.payload.writes.find(w=>w.entityType==='clients');customer.before=structuredClone(deps[n].packet.payload.writes[0].data);customer.data.ultimaCompra=o.localSale.data;packets.push(o);
 }
 const before=JSON.stringify(packets),env=o=>({...f.envelope(o),businessId:c.bid});
 const decide=(o,action,extra={})=>service.decide(c.request({saleId:o.localSale.id,contentHash:env(o).contentHash,revision:0,action,confirmation:action==='approve_client'?'APROVAR_CADASTRO':'RECUPERAR',operationalEvidence:{goodsDelivered:true,paymentReceived:true,notRecreated:true},...extra}));
 for(const o of packets)await service.submit(c.request(env(o),c.seller));assert.equal(await count(c,'sales'),0);assert.equal(await count(c,'clients'),0);
 for(const d of deps)await decide(packets[0],'approve_client',{clientOperationId:d.packet.operationId});
 assert.equal(await count(c,'clients'),4);assert.equal(await count(c,'sales'),0);assert.equal(await count(c,'balanceEvents'),0);
 await assert.rejects(decide(packets[2],'recover_original'),/Resolva primeiro/);
 for(const o of packets){await decide(o,'recover_original');assert.equal((await decide(o,'recover_original')).idempotent,true);}
 assert.equal(await count(c,'sales'),3);assert.equal(await count(c,'stockMovements'),3);assert.equal(await count(c,'processedOperations'),7);assert.equal((await c.root.collection('products').doc('shared-product').get()).data().estoqueAtual,3);
 for(const o of packets){assert.equal((await c.root.collection('sales').doc(o.localSale.id).get()).data().operationId,o.packet.operationId);assert.equal((await c.root.collection('saleRecoveryReviews').doc(o.localSale.id).collection('original').doc('payload').get()).data().originalJson,env(o).originalJson);}
 const confirmations=await service.list(c.request({resolutionChecks:deps.map(d=>({kind:'client_dependency',operationId:d.packet.operationId,clientId:d.packet.payload.writes[0].entityId,payloadHash:require('../../functions/src/services/sale-recovery-customer').hash(d.packet.payload)}))},c.seller));assert.equal(confirmations.items.length,4);assert.ok(confirmations.items.every(i=>i.status==='client_confirmed'));
 assert.equal(JSON.stringify(packets),before);assert.equal(await count(c,'payments'),0);assert.equal(await count(c,'balanceAdjustments'),0);assert.equal(await count(c,'balanceEvents'),0);
 const signal=(await c.root.collection('syncMetadata').doc('last-sync').get()).data();assert.ok(signal.sourceSessionId.startsWith('server:'));assert.ok(signal.collectionVersions.clients);
});
