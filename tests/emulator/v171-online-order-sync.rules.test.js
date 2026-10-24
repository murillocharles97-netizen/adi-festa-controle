'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json')),{initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {onlineStoreService}=require('../../functions/src/services/online-store-service'),{onlineOrderService}=require('../../functions/src/services/online-order-service'),{onlineStoreStockProjection}=require('../../functions/src/services/online-store-stock-projection');
const {operationalCommitService}=require('../../functions/src/services/operational-commit-service');
const source=fs.readFileSync('js/firebase/sync.js','utf8'),section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const stamp=Date.now().toString(36),bid=`v171-${stamp}`,owner=`owner-${stamp}`,seller=`seller-${stamp}`,a=`a-${stamp}`,b=`b-${stamp}`;
let env,app,db,stores,orders,sanitizer,seq=0;
const root=()=>db.doc('businesses/'+bid),request=(data,uid=owner)=>({auth:{uid},data:{businessId:bid,workspaceGeneration:0,...data}});
async function seedProduct(variable=false,space=a){
 const id=`product-${++seq}`,p={id,businessId:bid,ownerId:owner,nome:'QA V171',preco:25,estoqueAtual:variable?2:2,estoque:2,totalStock:2,ativo:true,active:true,schemaVersion:3,itemKind:'product',productType:variable?'variable':'simple',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space};
 const data={produtos:[p],variacoesProdutos:[]};
 if(variable){for(const color of ['red','blue']){const v={id:`${id}-${color}`,businessId:bid,ownerId:owner,parentProductId:id,displayName:color,attributeValues:{Cor:color},stock:1,price:25,active:true,catalogVisible:true,schemaVersion:3};data.variacoesProdutos.push(v);await root().collection('productVariants').doc(v.id).set(v);}const c={window:{},structuredClone,Date,DB:{carregar:()=>data},Utils:{uuid:crypto.randomUUID}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/product-variations.js','utf8'),c);c.ProductVariations.recomputeInData(data,id);p.schemaVersion=3;}
 await root().collection('products').doc(id).set(p);return id;
}
async function submit(id,{variable=false,space=a}={}){
 let store=(await stores.load(request({spaceId:space}))).store;
 if(!store)store=(await stores.save(request({spaceId:space,action:'activate',confirmed:true,slug:`qa-${space}`,settings:{publicName:'QA'},productIds:[]}))).store;
 store=(await stores.save(request({spaceId:space,revision:store.revision,action:'publish',confirmed:true,slug:`qa-${space}`,settings:{publicName:'QA',checkoutEnabled:true,pickupEnabled:true},productIds:[id]}))).store;
 const payload={id:`order-${stamp}-${++seq}`,catalogToken:store.publicToken,workspaceGeneration:0,orderAccessToken:crypto.randomBytes(24).toString('hex'),customerName:'QA V171',customerPhone:'11999999999',serviceModeId:'pickup',paymentPreference:'dinheiro',expectedTotal:25,items:[{catalogItemId:`catalog-${id}${variable?'::'+id+'-red':''}`,quantity:1}]};
 await orders.submit({data:payload});let order=(await root().collection('catalogOrders').doc(payload.id).get()).data();return{order,payload,store};
}
async function ready(order,uid=owner){for(const status of ['confirmado','preparando','separando'])order=(await orders.change(request({id:order.id,revision:order.revision,status},uid))).order;return(await orders.claim(request({id:order.id,revision:order.revision,saleStatus:'pago',paymentMethod:'dinheiro'},uid))).order;}
// Convert only plain objects across VM realms; preserve actual SDK sentinels.
function bridge(x){if(x instanceof Date)return x;if(Array.isArray(x))return Array.from(x,bridge);if(x&&typeof x==='object'&&Object.prototype.toString.call(x)==='[object Object]'&&!x._methodName&&typeof x.toDate!=='function')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,bridge(v)]));return x;}
async function pipeline(order,uid=owner,{v170=false,stripProof=false}={}){
 const data={config:{},produtos:[],variacoesProdutos:[],clientes:[],vendas:[],movimentacoes:[],movimentacoesEstoque:[]};
 for(const productId of new Set(order.items.map(i=>i.productId))){data.produtos.push((await root().collection('products').doc(productId).get()).data());data.variacoesProdutos.push(...(await root().collection('productVariants').where('parentProductId','==',productId).get()).docs.map(s=>s.data()));}
 const before=structuredClone(data),client=env.authenticatedContext(uid).firestore(),origin=Object.freeze({businessId:bid,workspaceGeneration:0,uid});
 const c={console,structuredClone,Date,crypto,TextEncoder,Utils:{uuid:crypto.randomUUID},db:client,doc:sdk.doc,deleteField:sdk.deleteField,serverTimestamp:sdk.serverTimestamp,increment:sdk.increment,currentUser:{uid},currentPath:'',activeBusinessId:()=>bid,stableLegacyOperationId:i=>i.operationId,legacyReconciliationOperationId:id=>`legacy_reconciliation:${id}`,normalizeText:x=>String(x||'').toLowerCase(),sanitizeForFirestore:x=>sanitizer(bridge(x)),queuePreflight:()=>({ok:true}),IDEMPOTENT_EVENT_NAMES:new Set(['sales','stockMovements']),SOURCES:{products:{key:'produtos'},productVariants:{key:'variacoesProdutos'},sales:{key:'vendas'},stockMovements:{key:'movimentacoesEstoque'}},sourceItems:(d,n)=>d[({products:'produtos',productVariants:'variacoesProdutos',sales:'vendas',stockMovements:'movimentacoesEstoque'})[n]]||[],now:()=>new Date().toISOString(),DB:{getBusinessId:()=>bid,carregar:()=>data,alterar:fn=>fn(data)},TeamAccess:{has:p=>p!=='cost.view',actor:()=>({actorUid:uid,actorNameSnapshot:'QA',actorRoleSnapshot:uid===owner?'owner':'seller'})},SpaceContext:{requireSalesSpace:id=>id||order.spaceId,stockMovementOrigin:(_p,id)=>({businessId:bid,spaceId:id||order.spaceId})},Campanhas:{aplicarVendaNoBanco:()=>[]},WorkspaceRuntime:{capture:()=>origin},dispatchEvent(){},CustomEvent:class{}};
 c.window=c;vm.createContext(c);
 for(const file of ['functions/src/shared/online-order.js','js/product-variations.js','js/vendas.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
 const vmSdk={...sdk,runTransaction:(database,fn)=>sdk.runTransaction(database,tx=>fn({get:r=>tx.get(r),set:(r,d,o)=>tx.set(r,bridge(d),o),update:(r,d)=>tx.update(r,bridge(d)),delete:r=>tx.delete(r)}))};
 const writer=require('../../js/workspace-writer.js').create({sdk:vmSdk,runtime:()=>c.WorkspaceRuntime});c.runTransaction=writer.runTransaction;
 Object.assign(c,{syncSessionGeneration:1,auth:{currentUser:{uid}},errorCode:e=>String(e.code||'unknown').replace(/^functions\//,''),FirebaseCallable:async(name,data)=>{assert.equal(name,'commitOperationalSync');return{data:await operationalCommitService(db).commit({auth:{uid},data})};}});
 vm.runInContext(fs.readFileSync('js/firebase/product-import-fence.js','utf8').replace('export ',''),c);
 vm.runInContext(section('function enrich(','function archiveQueue(')+section('function changedFields(','function captureChanges(')+section('function financialEffectFromWrites(','const readSignalVersions')+section('async function commitQueueItem(','async function verifySaleQueueCommit('),c);
 const sale=c.Vendas.registrar({id:order.saleId,operationId:order.finalizationOperationId,businessId:bid,spaceId:order.spaceId,onlineOrderId:order.id,onlineOrderItems:order.items,status:'pago',formaPagamento:'dinheiro',itens:order.items.map(i=>({produtoId:i.productId,variantId:i.variantId,quantidade:i.quantity,precoOriginal:25,precoFinalUnitario:25}))});
 const writes=bridge(c.diffWrites(before,data));if(v170)for(const w of writes)if(w.entityType==='stockMovements'){delete w.data.spaceId;delete w.data.businessId;}
 const packet={operationId:sale.operationId,businessId:bid,userId:uid,payloadVersion:4,payload:{eventKind:'sale',writes}};
 if(stripProof)delete packet.payload.writes.find(w=>w.entityType==='sales').data.onlineOrderId;
 return{packet,client,commit:()=>c.commitQueueItem(structuredClone(packet))};
}
test.before(async()=>{env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'adi-festa-variations-test'},'v171-'+stamp);db=getFirestore(app);stores=onlineStoreService(db);orders=onlineOrderService(db);sanitizer=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js','utf8')))).sanitizeForFirestore;await root().set({ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});for(const uid of [owner,seller]){await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role:uid===owner?'owner':'seller'});await root().collection('members').doc(uid).set({uid,status:'active',role:uid===owner?'owner':'seller',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:uid===owner?[]:[a],permissions:{'sales.create':true,'sales.viewAll':true,'sales.cancel':true,'products.view':true,'inventory.view':true}});}for(const id of [a,b])await db.doc('financialSpaces/'+id).set({businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{sales:true,products:true,inventory:true,finance:false,goals:true}});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
for(const variable of [false,true])test(`real Vendas + diff + Sync transaction + serializer + Rules: ${variable?'variant':'simple'}, reload/retry and one debit`,async()=>{
 const id=await seedProduct(variable),{order:fresh,store}=await submit(id,{variable}),order=await ready(fresh),p=await pipeline(order,owner,{v170:variable});
 const persisted=structuredClone(p.packet);await Promise.all([p.commit(),p.commit()]);await p.commit();assert.deepEqual(p.packet,persisted,'Uploader must not mutate the durable request');
 await orders.acknowledge(request({id:order.id}));await orders.acknowledge(request({id:order.id}));
 assert.equal((await root().collection('sales').where('onlineOrderId','==',order.id).get()).size,1);
 assert.equal((await root().collection('products').doc(id).get()).data().estoqueAtual,1);
 const receipts=await root().collection('stockMovements').where('operationId','==',order.finalizationOperationId).get();assert.equal(receipts.size,1);assert.equal(receipts.docs[0].data().spaceId,a);assert.equal(receipts.docs[0].data().quantidade,-1);
 if(variable){const v=(await root().collection('productVariants').doc(id+'-red').get()).data();assert.equal(v.stock,0);assert.equal(v.onlineReservedStock,0);assert.equal((await root().collection('productVariants').doc(id+'-blue').get()).data().stock,1);}
 const projector=onlineStoreStockProjection(db);await projector.project({businessId:bid,productId:id,source:(await root().collection('products').doc(id).get()).data()});
 const publicCatalog=(await db.doc('publicCatalogs/'+store.publicToken).get()).data();assert.equal(publicCatalog.items.find(i=>i.productId===id).availableQuantity,1);
 assert.equal((await root().collection('catalogOrders').doc(order.id).get()).data().reservationStatus,'consumed');
});
for(const variable of [false,true])test(`restricted seller can finalize ${variable?'variant':'simple'} only in own space`,async()=>{
 const id=await seedProduct(variable),{order:fresh}=await submit(id,{variable}),order=await ready(fresh,seller),p=await pipeline(order,seller);await p.commit();await orders.acknowledge(request({id:order.id},seller));const receipt=(await root().collection('stockMovements').where('operationId','==',order.finalizationOperationId).get()).docs[0];assert.equal((await sdk.getDoc(sdk.doc(p.client,receipt.ref.path))).data().spaceId,a);
});
test('other-space stock receipts remain denied for read/update/delete',async()=>{
 const other=await root().collection('stockMovements').add({businessId:bid,spaceId:b,produtoId:'foreign',quantidade:-1});const client=env.authenticatedContext(seller).firestore();await assertFails(sdk.getDoc(sdk.doc(client,other.path)));await assertFails(sdk.updateDoc(sdk.doc(client,other.path),{spaceId:a}));await assertFails(sdk.deleteDoc(sdk.doc(client,other.path)));
 await assertFails(sdk.getDocs(sdk.collection(client,'businesses',bid,'stockMovements')));
 const own=await sdk.getDocs(sdk.query(sdk.collection(client,'businesses',bid,'stockMovements'),sdk.where('spaceId','==',a)));assert.ok(own.size>0);assert.ok(own.docs.every(s=>s.data().spaceId===a));
 const legacy=await root().collection('stockMovements').add({businessId:bid,produtoId:'legacy',quantidade:1});
 assert.equal((await sdk.getDoc(sdk.doc(env.authenticatedContext(owner).firestore(),legacy.path))).exists(),true);await assertFails(sdk.getDoc(sdk.doc(client,legacy.path)));
});
for(const variable of [false,true])test(`authorized gateway rejects missing canonical reservation claim atomically: ${variable?'variant':'simple'}`,async()=>{
 const id=await seedProduct(variable),{order:fresh}=await submit(id,{variable}),order=await ready(fresh),p=await pipeline(order,owner,{stripProof:true});
 // Simple has two units; reserve the second too, so a missing proof must fail.
 if(!variable)await submit(id,{variable});
 await assert.rejects(p.commit(),{code:'online-stock-reserved'});assert.equal((await root().collection('sales').doc(order.saleId).get()).exists,false);assert.equal((await root().collection('stockMovements').where('operationId','==',order.finalizationOperationId).get()).size,0);assert.equal((await root().collection('products').doc(id).get()).data().estoqueAtual,2);
});
test('recovery refuses an explicit wrong-space receipt and leaves durable packet/reservation intact',async()=>{
 const id=await seedProduct(true),{order:fresh}=await submit(id,{variable:true}),order=await ready(fresh),p=await pipeline(order);
 const receipt=p.packet.payload.writes.find(w=>w.entityType==='stockMovements');receipt.data.spaceId=b;
 await assert.rejects(p.commit(),{code:'online-stock-scope-mismatch'});assert.equal(receipt.data.spaceId,b);assert.equal((await root().collection('sales').doc(order.saleId).get()).exists,false);assert.equal((await root().collection('productVariants').doc(id+'-red').get()).data().onlineReservedStock,1);
});
test('restricted stock-only sale cannot edit variant prices or catalog ownership',async()=>{
 const id=await seedProduct(true),{order:fresh}=await submit(id,{variable:true}),order=await ready(fresh,seller),p=await pipeline(order,seller);
 const write=p.packet.payload.writes.find(w=>w.entityType==='productVariants');write.data.price=1;
 await assertFails(p.commit());assert.equal((await root().collection('sales').doc(order.saleId).get()).exists,false);
 delete write.data.price;await p.commit();const parent=(await root().collection('products').doc(id).get()).data(),variant=(await root().collection('productVariants').doc(id+'-red').get()).data();assert.equal(parent.ownerId,owner);assert.equal(parent.schemaVersion,3);assert.equal(variant.ownerId,owner);assert.equal(variant.price,25);await orders.acknowledge(request({id:order.id},seller));
});
for(const mode of ['item','method','customer'])test(`online frozen finalization rejects ${mode} replacement BEFORE any sale/stock effect`,async()=>{
 const id=await seedProduct(false),{order:fresh}=await submit(id),order=await ready(fresh),p=await pipeline(order),sale=p.packet.payload.writes.find(w=>w.entityType==='sales');
 if(mode==='item')sale.data.itens[0].produtoId=await seedProduct(false);
 if(mode==='method')sale.data.formaPagamento='pix';
 if(mode==='customer'){await root().collection('clients').doc('qa-other-client').set({businessId:bid,active:true,saldo:0});sale.data.clienteId='qa-other-client';}
 await assert.rejects(p.commit(),{code:'permission-denied'});assert.equal((await root().collection('sales').doc(order.saleId).get()).exists,false);assert.equal((await root().collection('products').doc(id).get()).data().estoqueAtual,2);assert.equal((await root().collection('stockMovements').where('operationId','==',order.finalizationOperationId).get()).size,0);
});
