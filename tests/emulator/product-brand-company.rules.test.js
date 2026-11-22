'use strict';
// Marca por EMPRESA: regra do servidor no cadastro comum (commitOperationalSync) e na planilha. Dados fictícios.
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
const pid='demo-veconi-brand-company';
test.before(async()=>{env=await initializeTestEnvironment({projectId:pid,firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});app=initializeApp({projectId:pid},'product-brand-company');db=getFirestore(app);service=operationalCommitService(db);});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup(){
 const bid='brand-qa-'+(++n),space='space-'+bid,other='other-'+bid,owner='owner-'+bid,seller='seller-'+bid,editor='editor-'+bid,cancel='cancel-'+bid,receiver='receiver-'+bid,legacy='legacy-'+bid,root=db.doc('businesses/'+bid);
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

const packetFor=(c,uid,eventKind,writes)=>({businessId:c.bid,userId:uid,operationId:crypto.randomUUID(),workspaceGeneration:0,payload:{eventKind,writes}});
const {productSpreadsheetService}=require('../../functions/src/services/product-spreadsheet-service');
const {FieldValue}=req('firebase-admin/firestore');
const rule=(c,on)=>c.root.collection('settings').doc('default').set({productRules:{brandRequired:on}},{merge:true});
const create=(c,uid,id,space,extra={})=>packetFor(c,uid,'simple',[{entityType:'products',entityId:id,operation:'create',data:{id,businessId:c.bid,nome:'Produto fictício '+id,preco:10,estoqueAtual:0,estoque:0,totalStock:0,defaultSpaceId:space,spaceAccessMode:'single_space',allowedSpaceIds:[space],...extra}}]);
const rejectsBrand=p=>assert.rejects(p,e=>e.code==='failed-precondition'&&/exige Marca/.test(e.message));
test('empresa A exige Marca e empresa B não: só A recusa produto novo sem marca',async()=>{
 const a=await setup(),b=await setup();await rule(a,true);
 await rejectsBrand(service.commit(a.request(create(a,a.editor,'a-sem',a.space))));
 assert.equal(await read(a,'products','a-sem'),undefined);assert.equal((await a.root.collection('processedOperations').get()).size,0);
 await service.commit(a.request(create(a,a.editor,'a-com',a.space,{marca:'Acme'})));assert.equal((await read(a,'products','a-com')).marca,'Acme');
 await service.commit(b.request(create(b,b.editor,'b-sem',b.space)));assert.equal((await read(b,'products','b-sem')).nome,'Produto fictício b-sem');
});
test('todos os espaços da empresa obedecem à mesma regra',async()=>{
 const c=await setup();await rule(c,true);
 for(const space of [c.space,c.other])await rejectsBrand(service.commit(c.request(create(c,c.owner,'p-'+space,space))));
 await service.commit(c.request(create(c,c.owner,'p-ok',c.other,{marca:'Acme'})));
});
test('cliente antigo não contorna: sem campo, marca em branco ou inválida',async()=>{
 const c=await setup();await rule(c,true);
 await rejectsBrand(service.commit(c.request(create(c,c.editor,'old-1',c.space))));
 await rejectsBrand(service.commit(c.request(create(c,c.editor,'old-2',c.space,{marca:'   '}))));
 await assert.rejects(service.commit(c.request(create(c,c.editor,'old-3',c.space,{marca:{x:1}}))),e=>e.code==='invalid-argument');
 await assert.rejects(service.commit(c.request(create(c,c.editor,'old-4',c.space,{marca:'x'.repeat(81)}))),e=>e.code==='invalid-argument');
});
test('produto antigo sem marca continua editável e vendável com a regra ativa',async()=>{
 const c=await setup();await rule(c,true);const before=await read(c,'products','qa-product');assert.equal(before.marca,undefined);
 await service.commit(c.request(packetFor(c,c.editor,'simple',[{entityType:'products',entityId:'qa-product',operation:'update',before,data:{nome:'Produto QA revisado'}}])));
 assert.equal((await read(c,'products','qa-product')).nome,'Produto QA revisado');
 const h=harness({businessId:c.bid,spaceId:c.space,uid:c.seller}),{packet}=h.sell();
 await service.commit(c.request(packet));assert.equal((await read(c,'products','qa-product')).estoqueAtual,2,'venda e estoque não mudam com a regra');
});
test('retentativa de operação já confirmada antes da ativação é reconhecida pelo recibo, sem duplicar',async()=>{
 const c=await setup(),item=create(c,c.editor,'antes',c.space,{estoqueAtual:3,estoque:3,totalStock:3});
 await service.commit(c.request(item));await rule(c,true);
 const replay=await service.commit(c.request(item));assert.equal(replay.replayed,true);
 assert.equal((await c.root.collection('processedOperations').get()).size,1);assert.equal((await c.root.collection('stockMovements').where('produtoId','==','antes').get()).size,1);
});
test('planilha: com a regra ativa, criação sem coluna Marca é recusada sem gravações; atualização segue pelo cadastro comum',async()=>{
 const c=await setup();const sheet=productSpreadsheetService(db,{FieldValue});
 await c.root.update({subscription:{planId:'internal',status:'active'}});
 const req=rows=>({auth:{uid:c.owner},data:{businessId:c.bid,spaceId:c.space,workspaceGeneration:0,rows:rows.map((data,i)=>({line:i+2,data}))}});
 const ok=await sheet.createProducts(req([{nome:'Planilha livre',codigo:'SHEET-1'}]));assert.equal(ok.results[0].ok,true);
 await rule(c,true);
 const blocked=await sheet.createProducts(req([{nome:'Planilha A',codigo:'SHEET-2'},{nome:'Planilha B',codigo:'SHEET-3',estoqueAtual:2}]));
 assert.deepEqual(blocked.results.map(r=>r.ok),[false,false]);assert.match(blocked.results[0].message,/exige Marca/);
 assert.equal((await c.root.collection('products').where('codigo','in',['SHEET-2','SHEET-3']).get()).size,0);
 assert.equal((await c.root.collection('stockMovements').where('observacao','==','Estoque inicial — importação VECONI').get()).size,0);
 const replay=await sheet.createProducts(req([{nome:'Planilha livre',codigo:'SHEET-1'}]));assert.equal(replay.results[0].replayed,true,'recibo anterior à ativação continua valendo');
});
