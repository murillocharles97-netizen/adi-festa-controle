'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,FieldValue}=req('firebase-admin/firestore');
const {saleRecoveryService}=require('../../functions/src/services/sale-recovery-service');
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');
const fixture=require('../fixtures/retained-sale-recovery.cjs');
const enabled=/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
const t=(name,fn)=>test(name,{skip:!enabled},fn);let app,db,env,service;
test.before(async()=>{if(!enabled)return;env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'adi-festa-variations-test'},'recovery-decisions');db=getFirestore(app);service=saleRecoveryService(db,{FieldValue});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup(label,{finance=false,stock=3}={}){
 const bid='decision-'+label,owner='owner-'+label,seller='seller-'+label,a='space-'+label+'-a',b='space-'+label+'-b',root=db.doc('businesses/'+bid);
 await root.set({id:bid,active:true,ownerId:owner,workspaceGeneration:0,subscription:{planId:'internal',status:'active',isInternal:true}});
 for(const [uid,role]of [[owner,'owner'],[seller,'seller']]){
  await db.doc('users/'+uid).set({uid,businessId:bid,role,active:true,name:'QA '+role});await root.collection('members').doc(uid).set({uid,role,status:'active',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[a],permissions:{'sales.create':true,'inventory.view':true,'financial.view':false}});
 }
 for(const space of [a,b])await db.doc('financialSpaces/'+space).set({id:space,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,type:'business',capabilities:{sales:true,products:true,inventory:true,finance},automation:{enabled:true,activatedAt:'2026-01-01T00:00:00.000Z',autoIncome:{sales:true}}});
 const originals=Array.from({length:4},(_,n)=>JSON.parse(JSON.stringify(fixture.sample(n).original).replaceAll(fixture.bid,bid).replaceAll(fixture.spaceId,a).replaceAll(fixture.seller,seller)));
 for(const id of new Set(originals.flatMap(o=>o.localSale.itens.map(i=>i.produtoId))))await root.collection('products').doc(id).set({id,businessId:bid,estoqueAtual:stock,estoque:stock,active:true,productType:'simple',spaceAccessMode:'single_space',allowedSpaceIds:[a],defaultSpaceId:a,workspaceGeneration:0});
 const request=(data,uid=owner)=>({auth:uid?{uid}:null,data:{businessId:bid,workspaceGeneration:0,...data}});
 const upload=async(n=0)=>{const data=fixture.envelope(originals[n]);return service.submit(request({...data,businessId:bid},seller));};
 const decision=async(n=0,action='recover_original',extra={})=>{
  const review=(await root.collection('saleRecoveryReviews').doc(originals[n].localSale.id).get()).data();
  return service.decide(request({saleId:review.saleId,contentHash:review.contentHash,revision:review.revision??0,action,confirmation:{recover_original:'RECUPERAR',link_existing:'VINCULAR',dismiss_match:'NAO_E_A_MESMA',close_without_effects:'ENCERRAR_SEM_EFEITOS'}[action],...extra}));
 };
 const manager=async(n=0,id='manager-sale')=>{await root.collection('sales').doc(id).set({...originals[n].localSale,id,actorUid:owner,data:'2026-10-17T18:59:26.000Z'});return id;};
 return{bid,owner,seller,a,b,root,originals,request,upload,decision,manager};
}
async function effects(c){
 const names=['sales','stockMovements','products','productVariants','processedOperations','saleFinancials','financialIncomeRoutes','clients','balanceEvents','campaignProgress','settings'];const result={};
 for(const name of names)result[name]=(await c.root.collection(name).get()).docs.map(d=>({id:d.id,value:d.data(),time:d.updateTime.toMillis()}));
 for(const space of [c.a,c.b])result[space]=(await db.collection(`financialSpaces/${space}/entries`).get()).docs.map(d=>({id:d.id,value:d.data(),time:d.updateTime.toMillis()}));return result;
}
const count=async(c,kind)=>(await c.root.collection(kind).get()).size;

t('incident equivalent: close 306.50 with zero effects, recover partial 59.90 patch 6 to 5 once, preserve resolved 24.90/243.60',async()=>{
 const c=await setup('minimal-hotfix',{stock:6,finance:true});
 await c.root.collection('products').doc('marrom').update({totalStock:6});
 for(const [n,total]of [[0,24.9],[1,306.5],[2,243.6],[3,59.9]]){
  const o=c.originals[n];
  for(const sale of [o.localSale,o.packet.payload.writes.find(w=>w.entityType==='sales').data]){
   sale.valorFinal=total;sale.formaPagamento=n?'cartao':'dinheiro';for(const item of sale.itens)item.precoFinalUnitario=total/sale.itens.length;
  }
  for(const w of o.packet.payload.writes.filter(w=>w.entityType==='products')){w.before={estoqueAtual:6,estoque:6,totalStock:6};w.data={estoqueAtual:5,estoque:5};}
  for(const m of [...o.localMovements,...o.packet.payload.writes.filter(w=>w.entityType==='stockMovements').map(w=>w.data)]){m.estoqueAnterior=6;m.estoqueNovo=5;}
  await c.upload(n);
 }
 for(const n of [0,2])await c.decision(n,'link_existing',{linkedSaleId:await c.manager(n,'manager-'+n)});
 const protectedRefs=[0,2].map(n=>c.root.collection('saleRecoveryReviews').doc(c.originals[n].localSale.id));
 const protectedBefore=await Promise.all(protectedRefs.map(r=>r.get()));
 const raws=await Promise.all(c.originals.map(o=>c.root.collection('saleRecoveryReviews').doc(o.localSale.id).collection('original').doc('payload').get()));
 const originalSnapshot=JSON.stringify(c.originals),before=await effects(c);
 const closed=await c.decision(1,'close_without_effects');assert.equal(closed.status,'closed_without_effects');assert.equal(closed.linkedSaleId,null);
 assert.equal((await c.decision(1,'close_without_effects')).idempotent,true);assert.deepEqual(await effects(c),before);
 const review=(await c.root.collection('saleRecoveryReviews').doc(c.originals[1].localSale.id).get()).data();
 assert.equal(review.commercialEffectsApplied,false);assert.equal(review.resolvedByUid,c.owner);assert.ok(review.resolvedAt);assert.deepEqual(review.movementIds,[]);
 assert.equal((await c.root.collection('saleRecoveryReviews').doc(review.saleId).collection('decisions').get()).size,1);
 await assert.rejects(c.decision(1),{code:'failed-precondition'});
 const result=await Promise.all([c.decision(3),c.decision(3)]);assert.equal(result.filter(r=>!r.idempotent).length,1);
 const sale=(await c.root.collection('sales').doc(c.originals[3].localSale.id).get()).data();assert.equal(sale.valorFinal,59.9);assert.equal(sale.operationId,c.originals[3].packet.operationId);assert.equal(sale.actorUid,c.seller);
 const movement=(await c.root.collection('stockMovements').doc('movement-3-0').get()).data();assert.equal(movement.estoqueAnterior,6);assert.equal(movement.estoqueNovo,5);
 assert.equal((await c.root.collection('products').doc('marrom').get()).data().estoqueAtual,5);assert.equal(await count(c,'sales'),3);assert.equal(await count(c,'stockMovements'),1);assert.equal(await count(c,'processedOperations'),1);
 assert.equal((await c.root.collection('products').doc('marrom').get()).data().totalStock,5);
 const income=financialIncomeService(db);await income.projectSale(c.bid,sale.id,sale);await income.projectSale(c.bid,sale.id,sale);
 assert.equal((await db.collection(`financialSpaces/${c.a}/entries`).get()).size,1);assert.equal((await db.collection(`financialSpaces/${c.b}/entries`).get()).size,0);
 for(const [i,r]of protectedRefs.entries())assert.equal((await r.get()).updateTime.toMillis(),protectedBefore[i].updateTime.toMillis());
 for(const r of raws){const now=await r.ref.get();assert.equal(now.updateTime.toMillis(),r.updateTime.toMillis());assert.deepEqual(now.data(),r.data());}
 assert.equal(JSON.stringify(c.originals),originalSnapshot);
 const seller=await service.list(c.request({spaceId:c.a,view:'resolved'},c.seller));assert.equal(seller.items.length,4);assert.ok(seller.items.some(r=>r.status==='closed_without_effects'));assert.ok(seller.items.some(r=>r.status==='recovered'));
 const client=env.authenticatedContext(c.seller).firestore();await assertFails(sdk.setDoc(sdk.doc(client,'businesses',c.bid,'sales',review.saleId),c.originals[1].localSale));
});

t('close without effects requires owner/confirmation and rejects pre-existing commercial evidence atomically',async()=>{
 for(const mode of ['sale','movement','financial','marker']){
  const c=await setup('close-block-'+mode);await c.upload();const o=c.originals[0];
  if(mode==='sale')await c.root.collection('sales').doc(o.localSale.id).set(o.localSale);
  if(mode==='movement')await c.root.collection('stockMovements').doc('unexpected-id').set(o.localMovements[0]);
  if(mode==='marker')await c.root.collection('processedOperations').doc(o.packet.operationId).set({status:'processed'});
  if(mode==='financial')await db.doc(`financialSpaces/${c.a}/entries/sale_${o.localSale.id}`).set({amountCents:2490});
  const before=await effects(c);await assert.rejects(c.decision(0,'close_without_effects'),{code:'failed-precondition'});assert.deepEqual(await effects(c),before);
  assert.equal((await c.root.collection('saleRecoveryReviews').doc(o.localSale.id).get()).data().status,'awaiting_review');
 }
 const c=await setup('close-access');await c.upload();const data={saleId:c.originals[0].localSale.id,contentHash:fixture.envelope(c.originals[0]).contentHash,revision:0,action:'close_without_effects',confirmation:'ENCERRAR_SEM_EFEITOS'};
 await assert.rejects(service.decide(c.request(data,c.seller)),{code:'permission-denied'});await assert.rejects(service.decide(c.request({...data,confirmation:''})),{code:'invalid-argument'});
});

t('four synthetic originals: link A without effects, recover B/C/D chronologically with exact original IDs, immutable payload and unchanged local queues',async()=>{
 const c=await setup('four'),copy=JSON.stringify(c.originals);for(let n=0;n<4;n++)await c.upload(n);
 const manager=await c.manager();await c.root.collection('products').doc('shared-product').update({estoqueAtual:0,estoque:0});
 const historic=db.doc(`financialSpaces/${c.a}/entries/historical-25`);await historic.set({amountCents:2500,description:'preserve'});const historical=await historic.get();
 const before=await effects(c),raws=await Promise.all(c.originals.map(o=>c.root.collection('saleRecoveryReviews').doc(o.localSale.id).collection('original').doc('payload').get()));
 assert.equal((await c.decision(0,'link_existing',{linkedSaleId:manager})).status,'already_recreated');assert.deepEqual(await effects(c),before);
 await assert.rejects(c.decision(2),/Resolva primeiro/);
 for(const n of [1,2,3]){const r=await c.decision(n);assert.equal(r.status,'recovered');assert.equal((await c.decision(n)).idempotent,true);}
 assert.equal(await count(c,'sales'),4);assert.equal(await count(c,'stockMovements'),10);assert.equal(await count(c,'processedOperations'),3);
 assert.equal((await c.root.collection('products').doc('wine').get()).data().estoqueAtual,1);
 assert.equal((await c.root.collection('products').doc('shared-product').get()).data().estoqueAtual,0);
 for(const n of [1,2,3]){
  const original=c.originals[n],sale=(await c.root.collection('sales').doc(original.localSale.id).get()).data();assert.equal(sale.operationId,original.packet.operationId);assert.equal(sale.actorUid,c.seller);assert.equal(sale.spaceId,c.a);assert.equal(sale.data,original.localSale.data);assert.equal(sale.itens.some(i=>'custoUnitario'in i),false);
  for(const m of original.localMovements){const receipt=(await c.root.collection('stockMovements').doc(m.id).get()).data();assert.equal(receipt.operationId,original.packet.operationId);assert.equal(receipt.quantidade,m.quantidade);assert.equal(receipt.estoqueAnterior-receipt.estoqueNovo,1);}
  const projected=await financialIncomeService(db).projectSale(c.bid,sale.id,sale);assert.equal(projected.skipped,'finance-disabled');
 }
 for(const [i,s]of raws.entries()){const now=await s.ref.get();assert.equal(now.data().originalJson,s.data().originalJson);assert.equal(now.updateTime.toMillis(),s.updateTime.toMillis());assert.equal((await c.upload(i)).duplicate,true);}
 assert.equal(JSON.stringify(c.originals),copy);assert.equal((await historic.get()).updateTime.toMillis(),historical.updateTime.toMillis());
 const resolved=await service.list(c.request({spaceId:c.a,view:'resolved'}));assert.equal(resolved.items.length,4);assert.ok(resolved.items.every(r=>r.resolvedAt&&r.resolvedByUid===c.owner&&r.linkedSaleId));
 const own=await service.list(c.request({spaceId:c.a,view:'resolved'},c.seller));assert.equal(own.items.length,4);assert.ok(own.items.every(r=>!('originalJson'in r)));
});

t('link is idempotent after lost response; competing link/recover cannot both win; manager sale is untouched',async()=>{
 const c=await setup('race'),manager=await c.manager();await c.upload();const before=await c.root.collection('sales').doc(manager).get();
 const results=await Promise.allSettled([c.decision(0,'link_existing',{linkedSaleId:manager}),c.decision()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const review=(await c.root.collection('saleRecoveryReviews').doc('retained-sale-0').get()).data();
 if(review.status==='already_recreated'){assert.equal((await c.decision(0,'link_existing',{linkedSaleId:manager})).idempotent,true);assert.equal(await count(c,'stockMovements'),0);assert.equal(await count(c,'processedOperations'),0);}
 else{assert.equal(review.status,'recovered');assert.equal((await c.decision()).idempotent,true);assert.equal(await count(c,'stockMovements'),1);}
 assert.equal((await before.ref.get()).updateTime.toMillis(),before.updateTime.toMillis());
 await assert.rejects(c.decision(0,'link_existing',{linkedSaleId:'other-sale'}),{code:'failed-precondition'});
});

t('two concurrent recovery clicks and repeated event delivery create one sale, one stock decrease and one correctly routed revenue',async()=>{
 const c=await setup('finance',{finance:true}),serviceIncome=financialIncomeService(db);await c.upload();
 const result=await Promise.all([c.decision(),c.decision()]);assert.equal(result.filter(r=>!r.idempotent).length,1);assert.equal(await count(c,'sales'),1);assert.equal(await count(c,'stockMovements'),1);
 const sale=(await c.root.collection('sales').doc('retained-sale-0').get()).data();const projected=await Promise.all([serviceIncome.projectSale(c.bid,sale.id,sale),serviceIncome.projectSale(c.bid,sale.id,sale)]);
 assert.equal(projected.filter(r=>r.created).length,1);assert.equal((await db.collection(`financialSpaces/${c.a}/entries`).get()).size,1);assert.equal((await db.collection(`financialSpaces/${c.b}/entries`).get()).size,0);assert.equal(await count(c,'financialIncomeRoutes'),1);
 assert.equal((await c.root.collection('products').doc('shared-product').get()).data().estoqueAtual,2);assert.equal((await c.decision()).idempotent,true);
});

t('insufficient stock, online reservation and existing partial/mismatched receipts stop atomically, leaving review pending',async()=>{
 for(const mode of ['empty','reserved','partial','marker','foreign-id','sale']){
  const c=await setup('blocked-'+mode,{stock:mode==='empty'?0:1});await c.upload();
  if(mode==='reserved'){
   const {stockKey}=require('../../functions/src/services/online-stock-reservation');await c.root.collection('products').doc('shared-product').update({onlineReservedStock:1});await c.root.collection('onlineStockReservations').doc(stockKey({productId:'shared-product'})).set({businessId:c.bid,workspaceGeneration:0,quantity:1});
  }
  if(mode==='partial'||mode==='foreign-id')await c.root.collection('stockMovements').doc(mode==='partial'?'movement-0-0':'unexpected-id').set({...c.originals[0].localMovements[0]});
  if(mode==='marker')await c.root.collection('processedOperations').doc('retained-operation-0').set({status:'processed'});
  if(mode==='sale')await c.root.collection('sales').doc('retained-sale-0').set(c.originals[0].localSale);
  const before=await effects(c);await assert.rejects(c.decision(),{code:'failed-precondition'});assert.deepEqual(await effects(c),before);assert.equal((await c.root.collection('saleRecoveryReviews').doc('retained-sale-0').get()).data().status,'awaiting_review');
 }
});

t('dismiss match only records the explicit hint decision; no commercial effects, later original recovery allowed',async()=>{
 const c=await setup('dismiss'),manager=await c.manager();await c.upload();const before=await effects(c);
 assert.equal((await c.decision(0,'dismiss_match',{linkedSaleId:manager})).status,'awaiting_review');assert.equal((await c.decision(0,'dismiss_match',{linkedSaleId:manager})).idempotent,true);assert.deepEqual(await effects(c),before);
 const listed=await service.list(c.request({spaceId:c.a,view:'pending'}));assert.equal(listed.items[0].possibleMatches.length,0);
 assert.equal((await c.decision()).status,'recovered');assert.equal(await count(c,'sales'),2);
});

t('owner-only decisions enforce confirmation/hash/revision, business, space, epoch and original actor permissions',async()=>{
 const c=await setup('access');await c.upload();const data={saleId:'retained-sale-0',contentHash:fixture.envelope(c.originals[0]).contentHash,revision:0,action:'recover_original',confirmation:'RECUPERAR'};
 for(const [change,uid,code]of [[{},null,'unauthenticated'],[{},c.seller,'permission-denied'],[{confirmation:''},c.owner,'invalid-argument'],[{contentHash:'bad'},c.owner,'failed-precondition'],[{revision:1},c.owner,'aborted'],[{businessId:'foreign-business'},c.owner,'permission-denied'],[{workspaceGeneration:1},c.owner,'failed-precondition']])await assert.rejects(service.decide(c.request({...data,...change},uid)),{code});
 const before=await effects(c);await c.root.collection('members').doc(c.seller).update({permissions:{'sales.create':false}});await assert.rejects(c.decision(),{code:'failed-precondition'});assert.deepEqual(await effects(c),before);
 await c.root.collection('members').doc(c.seller).update({permissions:{'sales.create':true}});await c.root.collection('products').doc('shared-product').update({allowedSpaceIds:[c.b]});await assert.rejects(c.decision(),{code:'failed-precondition'});
});

t('variable recovery uses current variant stock and parent aggregate, with original movement IDs and zero second decrease',async()=>{
 const c=await setup('variant');const o=c.originals[0],sale=o.localSale;sale.itens[0].variantId='variant-blue';o.packet.payload.writes[0].data.itens[0].variantId='variant-blue';o.localMovements[0].variantId='variant-blue';o.packet.payload.writes.find(w=>w.entityType==='stockMovements').data.variantId='variant-blue';
 o.packet.payload.writes.push({entityType:'productVariants',entityId:'variant-blue',operation:'update',before:{stock:2},data:{stock:1,businessId:c.bid}});
 // A variable parent is a projection, not a second physical stock source.
 const p=o.packet.payload.writes.find(w=>w.entityType==='products');p.before={estoqueAtual:2,estoque:2,totalStock:2};p.data={estoqueAtual:1,estoque:1,totalStock:1};
 await c.root.collection('products').doc('shared-product').update({productType:'variable'});
 for(const [id,stock]of [['variant-blue',3],['variant-red',4]])await c.root.collection('productVariants').doc(id).set({id,businessId:c.bid,parentProductId:'shared-product',active:true,stock});
 await c.upload();await c.decision();await c.decision();assert.equal((await c.root.collection('productVariants').doc('variant-blue').get()).data().stock,2);assert.equal((await c.root.collection('productVariants').doc('variant-red').get()).data().stock,4);assert.equal((await c.root.collection('products').doc('shared-product').get()).data().totalStock,6);assert.equal(await count(c,'stockMovements'),1);
});

t('Rules fence old clients at pending/resolved reviews without financial permission or exposing the review payload',async()=>{
 const c=await setup('fence');await c.upload();
 const client=env.authenticatedContext(c.seller).firestore(),sale={...c.originals[0].localSale};sale.itens=sale.itens.map(({custoUnitario,...i})=>i);
 // Since V202 all commercial writes require the authorized gateway, even when
 // no recovery review exists. This control must no longer allow a direct sale.
 await assertFails(sdk.setDoc(sdk.doc(client,'businesses',c.bid,'sales','control-sale'),{...sale,id:'control-sale',operationId:'control-operation'}));
 for(const phase of ['pending','resolved']){
  if(phase==='resolved')await c.decision(0,'link_existing',{linkedSaleId:await c.manager()});
  const batch=sdk.writeBatch(client);batch.set(sdk.doc(client,'businesses',c.bid,'sales',sale.id),sale);batch.update(sdk.doc(client,'businesses',c.bid,'products','shared-product'),{estoqueAtual:2,estoque:2});
  await assertFails(batch.commit());await assertFails(sdk.setDoc(sdk.doc(client,'businesses',c.bid,'stockMovements','movement-0-0'),{...c.originals[0].localMovements[0],tipo:'saida_venda'}));
  await assertFails(sdk.getDoc(sdk.doc(client,'businesses',c.bid,'saleRecoveryReviews',sale.id)));
 }
 assert.equal((await c.root.collection('products').doc('shared-product').get()).data().estoqueAtual,3);assert.equal((await c.root.collection('sales').doc(sale.id).get()).exists,false);
});

t('unknown campaign/client/debt/integrated effects fail closed instead of silently dropping them',async()=>{
 for(const mode of ['campaign','client','credit','terminal']){
  const c=await setup('unsupported-'+mode),o=c.originals[0];
  if(mode==='campaign')o.packet.payload.writes.push({entityType:'campaignProgress',entityId:'campaign-progress',operation:'update',before:{confirmedProgress:0},data:{confirmedProgress:1}});
  if(mode==='client')o.packet.payload.writes.push({entityType:'clients',entityId:'customer-original',operation:'update',before:{totalComprado:0},data:{totalComprado:24.9}});
  if(mode==='credit')o.packet.payload.writes[0].data.status='fiado';
  if(mode==='terminal')o.packet.payload.writes[0].data.paymentIntentId='terminal-intent';
  await c.upload();const before=await effects(c);await assert.rejects(c.decision(),{code:'failed-precondition'});assert.deepEqual(await effects(c),before);
 }
});
