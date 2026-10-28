'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),storageSdk=require('firebase/storage');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {operationalCommitService}=require('../../functions/src/services/operational-commit-service');
const {saleCancellationService}=require('../../functions/src/services/sale-cancellation-service');
const {harness}=require('../helpers/fiado-cancellation-harness.cjs');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required; production prohibited');
let env,app,db,service,n=0;
const pid='demo-veconi-security-v202';
test.before(async()=>{env=await initializeTestEnvironment({projectId:pid,firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});app=initializeApp({projectId:pid},'authorization-hardening');db=getFirestore(app);service=operationalCommitService(db);});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup(){
 const bid='security-qa-'+(++n),space='space-'+bid,other='other-'+bid,owner='owner-'+bid,seller='seller-'+bid,editor='editor-'+bid,cancel='cancel-'+bid,receiver='receiver-'+bid,legacy='legacy-'+bid,root=db.doc('businesses/'+bid);
 await root.set({active:true,ownerId:owner,workspaceGeneration:0,legacyAccessDisabled:false,subscription:{planId:'internal',status:'active'}});
 const p={'sales.create':true,'products.view':true,'inventory.view':true,'customers.view':true};
 for(const [uid,role,permissions]of [[owner,'owner',{}],[seller,'seller',p],[editor,'seller',{'customers.edit':true,'customers.view':true,'products.edit':true,'products.view':true}],[cancel,'seller',{'sales.cancel':true}],[receiver,'seller',{'customers.receiveDebt':true,'customers.view':true,'financial.view':true}],[legacy,'cashier',null]]){
  await db.doc('users/'+uid).set({uid,businessId:bid,role:role==='seller'?'cashier':role,active:true,email:uid+'@example.test',permissions:{}});
  if(permissions)await root.collection('members').doc(uid).set({uid,role,status:'active',spaceAccess:'selected',allowedSpaceIds:[space],permissions});
 }
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,type:'business',businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,capabilities:{sales:true,products:true,inventory:true,finance:true}});
 const h=harness({businessId:bid,spaceId:space,uid:seller});
 for(const [col,rows]of [['clients',h.data().clientes],['products',h.data().produtos]])for(const row of rows)await root.collection(col).doc(row.id).set(row);
 await root.collection('sales').doc('existing').set({id:'existing',operationId:'existing-op',businessId:bid,spaceId:space,actorUid:owner,valorFinal:14,status:'pago',active:true});
 await root.collection('sales').doc('cancelled').set({id:'cancelled',businessId:bid,spaceId:space,actorUid:owner,valorFinal:14,status:'cancelado',active:false});
 await root.collection('balanceEvents').doc('existing').set({id:'existing',businessId:bid,spaceId:space,type:'credit_sale',amount:14,balanceDelta:-14,status:'applied'});
 for(const [col,id]of [['payments','payment'],['paymentAllocations','allocation'],['balanceEvents','event'],['balanceAdjustments','adjustment']])await root.collection(col).doc(id).set({id,businessId:bid,spaceId:other,valor:14,amount:14});
 await db.doc(`financialSpaces/${other}/entries/entry`).set({financialSpaceId:other,ownerUid:owner,amountCents:1400});
 return{bid,space,other,owner,seller,editor,cancel,receiver,legacy,root,h,request:item=>({auth:{uid:item.userId},data:{businessId:bid,item}}),doc:(uid,col,id)=>sdk.doc(env.authenticatedContext(uid).firestore(),`businesses/${bid}/${col}/${id}`)};
}
const read=async(c,col,id)=>(await c.root.collection(col).doc(id).get()).data();
for(const role of ['owner','seller'])test(`V202 ${role} handshake is read-only, scoped and followed by authenticated protocol commit`,async()=>{
 const c=await setup(),uid=c[role];
 const before=(await c.root.collection('processedOperations').get()).size;
 const protocol=await service.receipt({auth:{uid},data:{businessId:c.bid,workspaceGeneration:0,kind:'sync_protocol'}});
 assert.deepEqual(protocol,{protocolVersion:1,permissionsVersion:2,minClientRelease:202,channel:'commitOperationalSync',businessId:c.bid,workspaceGeneration:0});assert.equal((await c.root.collection('processedOperations').get()).size,before);
 await assert.rejects(service.receipt({auth:{uid},data:{businessId:'other-company',kind:'sync_protocol'}}));
 const h=harness({businessId:c.bid,spaceId:c.space,uid}),{packet}=h.sell();
 const {operationalCallable}=require('../../functions/src/shared/operational-callable');const call=operationalCallable(r=>service.commit(r),{requireProtocol:true}),request=c.request(packet);
 await assert.rejects(call(request),e=>e.details?.reason==='sync-update-required');assert.equal((await c.root.collection('processedOperations').get()).size,before);
 request.data.syncProtocolVersion=1;request.data.clientRelease=202;await call(request);await call(request);assert.equal((await c.root.collection('processedOperations').get()).size,before+1);assert.equal((await read(c,'products','qa-product')).estoqueAtual,2);
 await assertFails(sdk.updateDoc(c.doc(uid,'products','qa-product'),{estoqueAtual:99}));
});
const packetFor=(c,uid,eventKind,writes)=>({businessId:c.bid,userId:uid,operationId:crypto.randomUUID(),workspaceGeneration:0,payload:{eventKind,writes}});
test('seller/editor and owner cannot directly overwrite balance/version, stock or financial ledger',async()=>{
 const c=await setup();for(const uid of [c.seller,c.editor,c.owner]){
  await assertFails(sdk.updateDoc(c.doc(uid,'clients','qa-client'),{saldo:999,financialVersion:0}));
  await assertFails(sdk.updateDoc(c.doc(uid,'products','qa-product'),{estoqueAtual:-99,estoque:-99,totalStock:-99}));
  await assertFails(sdk.updateDoc(c.doc(uid,'balanceEvents','existing'),{amount:999,balanceDelta:999}));
 }
});
test('customer/product editors retain metadata access without financial/stock changes',async()=>{
 const c=await setup();await assertSucceeds(sdk.updateDoc(c.doc(c.editor,'clients','qa-client'),{nome:'Nome fictício atualizado'}));await assertSucceeds(sdk.updateDoc(c.doc(c.editor,'products','qa-product'),{nome:'Produto fictício atualizado'}));
});
test('sales.cancel never creates sales, rewrites totals or resurrects cancelled sale',async()=>{const c=await setup();await assertFails(sdk.setDoc(c.doc(c.cancel,'sales','forged'),{id:'forged',businessId:c.bid,spaceId:c.space,actorUid:c.cancel,valorFinal:1,status:'pago'}));await assertFails(sdk.updateDoc(c.doc(c.cancel,'sales','existing'),{valorFinal:1}));await assertFails(sdk.updateDoc(c.doc(c.cancel,'sales','cancelled'),{status:'pago',active:true}));});
test('processed receipt cannot be forged, including by owner; direct movement is denied',async()=>{
 const c=await setup();for(const uid of [c.owner,c.seller]){await assertFails(sdk.setDoc(c.doc(uid,'processedOperations','invented'),{id:'invented',idempotencyKey:'invented',businessId:c.bid,ownerId:uid,status:'processed',eventKind:'sale',schemaVersion:3}));await assertFails(sdk.setDoc(c.doc(uid,'stockMovements','invented'),{id:'invented',businessId:c.bid,spaceId:c.space,produtoId:'qa-product',quantidade:-1}));}
});
test('seller cannot read financial auxiliary docs; receiver cannot cross selected spaces; owner retains access',async()=>{
 const c=await setup();for(const [col,id]of [['payments','payment'],['paymentAllocations','allocation'],['balanceEvents','event'],['balanceAdjustments','adjustment']]){await assertFails(sdk.getDoc(c.doc(c.seller,col,id)));await assertFails(sdk.getDoc(c.doc(c.receiver,col,id)));await assertSucceeds(sdk.getDoc(c.doc(c.owner,col,id)));}
 await c.root.collection('payments').doc('allowed').set({businessId:c.bid,spaceId:c.space,valor:14});await assertSucceeds(sdk.getDoc(c.doc(c.receiver,'payments','allowed')));
});
test('legacy profile cannot self-grant; preexisting untrusted grants cannot unlock financial entry',async()=>{
 const c=await setup(),s=env.authenticatedContext(c.legacy).firestore();await assertFails(sdk.updateDoc(sdk.doc(s,'users',c.legacy),{permissions:{'financial.view':true}}));
 await db.doc('users/'+c.legacy).update({permissions:{'financial.view':true}});await assertFails(sdk.getDoc(sdk.doc(s,`financialSpaces/${c.space}/entries/entry`)));
});
test('existing legacy bootstrap may initialize absent permissions to EMPTY only',async()=>{
 const c=await setup();await db.doc('users/'+c.legacy).update({permissions:req('firebase-admin/firestore').FieldValue.delete()});const profile=sdk.doc(env.authenticatedContext(c.legacy).firestore(),'users',c.legacy);await assertSucceeds(sdk.updateDoc(profile,{permissions:[]}));await assertFails(sdk.updateDoc(profile,{permissions:{'financial.view':true}}));
});
test('financial attachment permission and selected-space isolation; owner still reads',async()=>{
 const c=await setup(),ownerStorage=env.authenticatedContext(c.owner).storage(),url=`financialSpaces/${c.other}/entries/entry/proof.pdf`;
 await assertSucceeds(storageSdk.uploadBytes(storageSdk.ref(ownerStorage,url),new Uint8Array([37,80,68,70]),{contentType:'application/pdf',customMetadata:{financialSpaceId:c.other,entryId:'entry',ownerUid:c.owner,entityType:'financialAttachment'}}));
 await assertFails(storageSdk.getMetadata(storageSdk.ref(env.authenticatedContext(c.seller).storage(),url)));await assertFails(storageSdk.getMetadata(storageSdk.ref(env.authenticatedContext(c.receiver).storage(),url)));await assertSucceeds(storageSdk.getMetadata(storageSdk.ref(ownerStorage,url)));
});
for(const status of ['pago','fiado'])test(`legitimate seller ${status} sale via server: one sale, movement, debit; retry/double click safe`,async()=>{
 const c=await setup(),{sale,packet}=c.h.sell({status});packet.workspaceGeneration=0;
 await Promise.all([service.commit(c.request(packet)),service.commit(c.request(packet))]);assert.equal((await service.commit(c.request(packet))).replayed,true);
 const remote=await read(c,'sales',sale.id);assert.equal(remote.operationId,sale.operationId);assert.equal((await read(c,'products','qa-product')).estoqueAtual,2);
 assert.equal((await c.root.collection('stockMovements').where('operationId','==',packet.operationId).get()).size,1);assert.equal((await read(c,'clients','qa-client')).saldo,status==='fiado'?-26:-12);
 assert.equal((await c.root.collection('processedOperations').doc(packet.operationId).get()).data().requestHash.length,64);
 if(status==='fiado'){assert.equal((await read(c,'balanceEvents','credit_sale:'+sale.id)).balanceDelta,-14);assert.equal((await service.receipt({auth:{uid:c.seller},data:{businessId:c.bid,spaceId:c.space,saleId:sale.id,operationId:sale.operationId}})).confirmed,true);}
 await assertSucceeds(sdk.getDoc(c.doc(c.owner,'sales',sale.id)));await assertFails(sdk.getDoc(c.doc(c.seller,'balanceEvents','existing')));
});
test('forged server intent with wrong saldo delta, stock delta, sale total or cancel-only identity is atomic',async()=>{
 for(const mode of ['balance','stock','total','cancel-only','scope','actor','generation','empty-receipt']){
  const c=await setup(),{packet}=c.h.sell();
  if(mode==='balance')packet.payload.writes.find(w=>w.entityType==='clients').data.saldo=999;
  if(mode==='stock')packet.payload.writes.find(w=>w.entityType==='products').data.estoqueAtual=999;
  if(mode==='total')packet.payload.writes.find(w=>w.entityType==='sales').data.valorFinal=-99;
  if(mode==='cancel-only')packet.userId=c.cancel;
  if(mode==='scope')packet.payload.writes.find(w=>w.entityType==='sales').data.spaceId=c.other;
  if(mode==='actor')packet.payload.writes.find(w=>w.entityType==='sales').data.actorUid=c.owner;
  if(mode==='generation')packet.workspaceGeneration=1;
  if(mode==='empty-receipt')packet.payload.writes=[{entityType:'processedOperations',entityId:packet.operationId,operation:'create',data:{status:'processed'}}];
  await assert.rejects(service.commit(c.request(packet)),undefined,mode);assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);assert.equal((await read(c,'clients','qa-client')).saldo,-12);assert.equal((await c.root.collection('processedOperations').get()).size,0);
 }
});
test('same operationId with changed content rejects; original receipt/payload immutable',async()=>{const c=await setup(),{packet}=c.h.sell();await service.commit(c.request(packet));const original=await read(c,'processedOperations',packet.operationId),changed=structuredClone(packet);changed.payload.writes[0].data.observacao='Conteúdo diferente';await assert.rejects(service.commit(c.request(changed)));assert.deepEqual(await read(c,'processedOperations',packet.operationId),original);});
test('quarantine/review/archive cannot replay through normal OR forced entry point',async()=>{
 for(const mode of ['local-quarantine','archive','review','archived-receipt']){const c=await setup(),{packet}=c.h.sell();if(mode==='local-quarantine')packet.status='quarantined';if(mode==='archive')await c.root.collection('syncIncidentArchives').doc(packet.operationId).set({operationId:packet.operationId});if(mode==='review')await c.root.collection('saleRecoveryOperations').doc(packet.operationId).set({status:'closed_without_effects'});if(mode==='archived-receipt')await c.root.collection('processedOperations').doc(packet.operationId).set({status:'archived_without_effects'});await assert.rejects(service.commit(c.request(packet)));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);}
});
test('server customer edit cannot sneak balance changes; legitimate edit creates a linked receipt',async()=>{
 const c=await setup(),item={operationId:crypto.randomUUID(),businessId:c.bid,userId:c.editor,payload:{eventKind:'simple',writes:[{entityType:'clients',entityId:'qa-client',operation:'update',data:{nome:'Fictício'},before:await read(c,'clients','qa-client')}]}};
 await service.commit(c.request(item));assert.equal((await read(c,'clients','qa-client')).nome,'Fictício');item.operationId=crypto.randomUUID();item.payload.writes[0].data.saldo=200;await assert.rejects(service.commit(c.request(item)));assert.equal((await read(c,'clients','qa-client')).saldo,-12);
});
test('canonical V201 cancellation remains operational, immutable and exactly once',async()=>{
 const c=await setup(),{sale,packet}=c.h.sell();await service.commit(c.request(packet));const svc=saleCancellationService(db),base={auth:{uid:c.owner},data:{businessId:c.bid,spaceId:c.space,saleId:sale.id,workspaceGeneration:0}},p=await svc.preview(base),r={...base,data:{...base.data,operationId:p.operationId,fingerprint:p.fingerprint,reason:'Cancelamento fictício QA',confirmed:true,refundHandling:'not_applicable'}};
 await svc.confirm(r);await svc.confirm(r);assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);assert.equal((await read(c,'clients','qa-client')).saldo,-12);assert.equal((await read(c,'sales',sale.id)).status,'cancelado');
});
test('owner legitimate sale keeps canonical ledger, seller cannot impersonate owner',async()=>{
 const c=await setup(),h=harness({businessId:c.bid,spaceId:c.space,uid:c.owner}),{packet}=h.sell();await service.commit(c.request(packet));assert.equal((await read(c,'clients','qa-client')).saldo,-26);
});
test('authorized stock entry and adjustment have one matching movement; catalog editor alone cannot adjust',async()=>{
 for(const mode of ['entry','adjust','editor']){
  const c=await setup(),before=await read(c,'products','qa-product'),delta=mode==='adjust'?-1:2,uid=mode==='editor'?c.editor:c.owner,item=packetFor(c,uid,mode==='entry'?'stock_entry':'stock_adjustment',[]);
  item.payload.writes=[{entityType:'products',entityId:'qa-product',operation:'update',before,data:{estoqueAtual:before.estoqueAtual+delta,estoque:before.estoque+delta}},{entityType:'stockMovements',entityId:item.operationId,operation:'create',data:{id:item.operationId,businessId:c.bid,spaceId:c.space,operationId:item.operationId,produtoId:'qa-product',tipo:mode==='entry'?'entrada':'ajuste',quantidade:delta,estoqueAnterior:3,estoqueNovo:3+delta}}];
  if(mode==='editor')await assert.rejects(service.commit(c.request(item)));else{await service.commit(c.request(item));await service.commit(c.request(item));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3+delta);assert.equal((await c.root.collection('stockMovements').get()).size,1);}
 }
});
test('legitimate receipt and balance adjustment update debt/event once, without access escalation',async()=>{
 for(const mode of ['payment','adjust']){
  const c=await setup(),before=await read(c,'clients','qa-client'),uid=mode==='payment'?c.receiver:c.owner,item=packetFor(c,uid,mode==='payment'?'payment':'balance_adjustment',[]),source=mode==='payment'?'payments':'balanceAdjustments';
  const data={id:item.operationId,operationId:item.operationId,businessId:c.bid,spaceId:c.space,clienteId:'qa-client',valor:5,saldoAnterior:-12,saldoNovo:-7,expectedFinancialVersion:12,expectedBalance:-12,financialStateDependent:true,paymentMode:'partial',motivo:'Ajuste fictício autorizado',data:new Date().toISOString()};
  item.payload.writes=[{entityType:source,entityId:item.operationId,operation:'create',data},{entityType:'clients',entityId:'qa-client',operation:'update',before,data:{saldo:-7,financialVersion:13}}];
  await service.commit(c.request(item));await service.commit(c.request(item));assert.equal((await read(c,'clients','qa-client')).saldo,-7);assert.equal((await read(c,'clients','qa-client')).financialVersion,13);assert.equal((await c.root.collection('balanceEvents').where('operationId','==',item.operationId).get()).size,1);
 }
});
test('permanent permission failure has no receipt/effect; authorized membership change is checked on retry',async()=>{
 const c=await setup(),{packet}=c.h.sell(),member=(await c.root.collection('members').doc(c.seller).get()).data();await c.root.collection('members').doc(c.seller).update({permissions:{...member.permissions,'sales.create':false}});await assert.rejects(service.commit(c.request(packet)));assert.equal((await c.root.collection('processedOperations').get()).size,0);assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);
});
test('negative stock/reservations are enforced by authoritative state, not forged local before snapshot',async()=>{
 const c=await setup(),{packet}=c.h.sell();await c.root.collection('products').doc('qa-product').update({onlineReservedStock:3});await c.root.collection('onlineStockReservations').doc(require('../../functions/src/services/online-stock-reservation').stockKey({productId:'qa-product',variantId:null})).set({businessId:c.bid,quantity:3});await assert.rejects(service.commit(c.request(packet)));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);
});
test('reload/server read and fresh session do not create operations; stale UID cannot replay',async()=>{
 const c=await setup(),{sale,packet}=c.h.sell();await service.commit(c.request(packet));const before=(await c.root.collection('processedOperations').get()).size;
 for(let i=0;i<2;i++)await sdk.getDocFromServer(c.doc(c.seller,'sales',sale.id));await assert.rejects(service.commit({...c.request(packet),auth:{uid:c.owner}}));assert.equal((await c.root.collection('processedOperations').get()).size,before);
});
for(const cash of [false,true])test(`legitimate five minute undo (${cash?'cash':'Fiado'}) preserves original actor, reverses delta once`,async()=>{
 const c=await setup(),{sale,packet}=c.h.sell(cash?{status:'pago'}:{});await service.commit(c.request(packet));
 const actor=(await c.root.collection('members').doc(c.seller).get()).data();await c.root.collection('members').doc(c.seller).update({permissions:{...actor.permissions,'sales.cancel':true}});
 const undo=c.h.undo(sale.id).packet;await service.commit(c.request(undo));await service.commit(c.request(undo));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);assert.equal((await read(c,'clients','qa-client')).saldo,-12);const s=await read(c,'sales',sale.id);assert.equal(s.status,'cancelado');assert.equal(s.operationId,sale.operationId);assert.equal(s.actorUid,c.seller);
});
test('new product with initial stock creates a deterministic audit entry, no duplicate on retry',async()=>{
 const c=await setup(),item=packetFor(c,c.editor,'simple',[{entityType:'products',entityId:'new-product',operation:'create',data:{id:'new-product',businessId:c.bid,nome:'Produto fictício',preco:10,estoqueAtual:5,estoque:5,totalStock:5,defaultSpaceId:c.space,spaceAccessMode:'single_space',allowedSpaceIds:[c.space]}}]);
 await service.commit(c.request(item));await service.commit(c.request(item));assert.equal((await read(c,'products','new-product')).estoqueAtual,5);assert.equal((await c.root.collection('stockMovements').get()).size,1);
});
test('server rejects disguised historical sale edits and commercial receipts backed only by metadata',async()=>{
 const c=await setup();for(const uid of [c.owner,c.seller,c.cancel]){
  const rewrite=packetFor(c,uid,'simple',[{entityType:'sales',entityId:'existing',operation:'update',data:{valorFinal:1}}]);await assert.rejects(service.commit(c.request(rewrite)));
 }
 const disguised=packetFor(c,c.editor,'sale',[{entityType:'clients',entityId:'qa-client',operation:'update',data:{nome:'Fictício'}}]);await assert.rejects(service.commit(c.request(disguised)));assert.equal((await read(c,'sales','existing')).valorFinal,14);assert.equal((await c.root.collection('processedOperations').get()).size,0);
});
test('variable product sale and retry update the correct variant and recomputed parent only',async()=>{
 const c=await setup(),before={...await read(c,'products','qa-product'),productType:'variable',estoqueAtual:6,estoque:6,totalStock:6};await c.root.collection('products').doc('qa-product').set(before);
 const variant={id:'variant',parentProductId:'qa-product',businessId:c.bid,stock:2,price:10,active:true,displayName:'QA azul',attributeValues:{Cor:'Azul'}};
 await c.root.collection('productVariants').doc('variant').set(variant);await c.root.collection('productVariants').doc('other-variant').set({...variant,id:'other-variant',stock:4});
 const item=packetFor(c,c.seller,'sale',[]);item.payload.writes=[
  {entityType:'sales',entityId:'variant-sale',operation:'create',data:{id:'variant-sale',businessId:c.bid,spaceId:c.space,actorUid:c.seller,operationId:item.operationId,status:'pago',formaPagamento:'dinheiro',valorFinal:10,itens:[{produtoId:'qa-product',variantId:'variant',quantidade:1,precoFinalUnitario:10}],data:new Date().toISOString()}},
  {entityType:'products',entityId:'qa-product',operation:'update',before,data:{estoqueAtual:5,estoque:5,totalStock:5}},
  {entityType:'productVariants',entityId:'variant',operation:'update',before:variant,data:{stock:1}},
  {entityType:'stockMovements',entityId:'variant-move',operation:'create',data:{operationId:item.operationId,businessId:c.bid,spaceId:c.space,produtoId:'qa-product',variantId:'variant',vendaId:'variant-sale',tipo:'saida_venda',quantidade:-1,estoqueAnterior:2,estoqueNovo:1}},
 ];await service.commit(c.request(item));await service.commit(c.request(item));assert.equal((await read(c,'productVariants','variant')).stock,1);assert.equal((await read(c,'productVariants','other-variant')).stock,4);assert.equal((await read(c,'products','qa-product')).totalStock,5);
});
test('owner cannot use another-space product in an otherwise authorized space; forged movement actor rejected',async()=>{
 for(const mode of ['scope','actor']){const c=await setup(),{packet}=c.h.sell();if(mode==='scope')await c.root.collection('products').doc('qa-product').update({spaceAccessMode:'single_space',defaultSpaceId:c.other,allowedSpaceIds:[c.other]});else packet.payload.writes.find(w=>w.entityType==='stockMovements').data.actorUid=c.owner;await assert.rejects(service.commit(c.request(packet)));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);}
});
test('unauthenticated and foreign-company identities cannot commit another tenant envelope',async()=>{
 const c=await setup(),d=await setup(),{packet}=c.h.sell();await assert.rejects(service.commit({data:{businessId:c.bid,item:packet}}));const foreign={...packet,userId:d.seller};await assert.rejects(service.commit({auth:{uid:d.seller},data:{businessId:c.bid,item:foreign}}));assert.equal((await read(c,'products','qa-product')).estoqueAtual,3);assert.equal((await read(d,'products','qa-product')).estoqueAtual,3);
});
test('new variable catalog creates only variant stock entries, never a second physical parent entry',async()=>{
 const c=await setup(),pid='new-variable',item=packetFor(c,c.editor,'simple',[]);
 item.payload.writes=[{entityType:'products',entityId:pid,operation:'create',data:{id:pid,businessId:c.bid,nome:'Variável fictício',productType:'variable',spaceAccessMode:'single_space',defaultSpaceId:c.space,allowedSpaceIds:[c.space],estoqueAtual:5,estoque:5,totalStock:5}},...[2,3].map((stock,i)=>({entityType:'productVariants',entityId:'new-v-'+i,operation:'create',data:{id:'new-v-'+i,businessId:c.bid,parentProductId:pid,stock,price:10,active:true,displayName:'QA '+i,attributeValues:{Cor:'QA '+i}}}))];
 await service.commit(c.request(item));await service.commit(c.request(item));const moves=(await c.root.collection('stockMovements').get()).docs.map(d=>d.data());assert.equal(moves.length,2);assert.equal(moves.reduce((n,m)=>n+m.quantidade,0),5);assert.ok(moves.every(m=>m.variantId));assert.equal((await read(c,'products',pid)).totalStock,5);
});
