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

// ---- Auditoria Codex V242.7: P1 Rules, P1 recuperação offline, P2 regra confirmada, serviços ----
const direct=(c,uid,id,extra={})=>sdk.setDoc(c.doc(uid,'products',id),{id,businessId:c.bid,nome:'Direto '+id,preco:10,estoqueAtual:0,spaceAccessMode:'single_space',allowedSpaceIds:[c.space],defaultSpaceId:c.space,spaceScopeVersion:1,...extra});
test('P1 Rules: escrita direta autenticada sem Marca é recusada com a regra ativa, mesmo sem documento de controle da importação',async()=>{
 const a=await setup(),b=await setup();await rule(a,true);
 assert.equal((await a.root.collection('productImportIdentifiers').doc('catalog-revision').get()).exists,false,'sem documento de controle');
 await assertFails(direct(a,a.editor,'d-sem'));
 await assertFails(direct(a,a.editor,'d-branco',{marca:'   '}));
 await assertFails(direct(a,a.editor,'d-objeto',{marca:{x:1}}));
 await assertFails(direct(a,a.editor,'d-longa',{marca:'x'.repeat(81)}));
 await assertSucceeds(direct(a,a.editor,'d-com',{marca:'Acme'}));
 await assertSucceeds(direct(a,a.editor,'d-servico',{itemKind:'service',nome:'Corrida do Táxi'}));
 await assertFails(direct(a,a.seller,'d-sem-permissao',{marca:'Acme'}));
 await assertSucceeds(direct(b,b.editor,'b-sem'),'empresa B não exige');
 const fresh=await setup();await assertSucceeds(direct(fresh,fresh.editor,'f-sem'),'sem settings/default a regra está desligada');
 await assertSucceeds(sdk.updateDoc(a.doc(a.editor,'products','qa-product'),{nome:'Antigo editado'}),'produto antigo sem marca segue editável');
});
test('serviços sem Marca continuam aceitos no cadastro comum com a regra ativa',async()=>{
 const c=await setup();await rule(c,true);
 await service.commit(c.request(create(c,c.owner,'svc',c.space,{itemKind:'service',nome:'Corrida do Táxi',controlaEstoque:false})));
 const svc=await read(c,'products','svc');assert.equal(svc.itemKind,'service');assert.equal(svc.marca,undefined);
});
const rejected=item=>({...item,status:'error',lastErrorCode:'failed-precondition',lastErrorMessage:'Esta empresa exige Marca ao cadastrar produtos. Informe a marca e tente novamente.'});
const recover=(c,item,brands,extra={})=>service.commit({auth:{uid:item.userId},data:{businessId:c.bid,kind:'brand_recovery_apply',item,brands,confirmed:true,...extra}});
test('P1 recuperação: cadastro offline anterior à ativação é concluído com a marca informada, uma única vez e auditado',async()=>{
 const c=await setup(),item=create(c,c.editor,'offline',c.space,{estoqueAtual:3,estoque:3,totalStock:3});
 await rule(c,true);
 await rejectsBrand(service.commit(c.request(item)));
 const original=rejected(item);
 await assert.rejects(recover(c,original,{offline:'Acme'},{confirmed:false}),e=>e.code==='failed-precondition');
 await assert.rejects(recover(c,original,{outro:'Acme'}),e=>e.code==='invalid-argument');
 await assert.rejects(recover(c,original,{offline:'  '}),e=>e.code==='invalid-argument');
 await assert.rejects(recover(c,{...original,lastErrorCode:'permission-denied'},{offline:'Acme'}),e=>e.code==='failed-precondition');
 assert.equal(await read(c,'products','offline'),undefined,'nenhuma tentativa inválida gravou');
 const done=await recover(c,original,{offline:' Acme  Ltda '});assert.notEqual(done.replayed,true);
 const p=await read(c,'products','offline');assert.equal(p.marca,'Acme Ltda');assert.equal(p.estoqueAtual,3);
 const marker=await read(c,'processedOperations',item.operationId);assert.equal(marker.brandRecovery.version,1);assert.deepEqual(marker.brandRecovery.productIds,['offline']);
 const audit=await read(c,'auditLogs','brand_recovery_'+item.operationId);assert.equal(audit.type,'brand_required_recovery');assert.equal(audit.brands.offline,'Acme Ltda');assert.equal(audit.originalFailure,'failed-precondition');
 const again=await recover(c,original,{offline:'Acme Ltda'});assert.equal(again.replayed,true,'repetir a recuperação reconhece o recibo');
 const queued=await service.commit(c.request(item));assert.equal(queued.replayed,true,'o original da fila é reconhecido pelo mesmo recibo');
 assert.equal((await c.root.collection('processedOperations').get()).size,1);
 assert.equal((await c.root.collection('stockMovements').where('produtoId','==','offline').get()).size,1,'sem movimento duplicado');
 assert.equal((await read(c,'products','offline')).estoqueAtual,3);
});
test('P1 recuperação: operação já confirmada (resposta perdida) não é reaplicada nem alterada',async()=>{
 const c=await setup(),item=create(c,c.editor,'confirmado',c.space);
 await service.commit(c.request(item));await rule(c,true);
 const r=await recover(c,rejected(item),{confirmado:'Acme'});assert.equal(r.replayed,true);
 assert.equal((await read(c,'products','confirmado')).marca,undefined,'nada alterado');
 assert.equal((await c.root.collection('auditLogs').doc('brand_recovery_'+item.operationId).get()).exists,false);
});
const rules=(c,uid,data={})=>service.commit({auth:{uid},data:{businessId:c.bid,kind:'product_rules',...data}});
test('P2: regra lida e alterada pelo servidor; só quem gerencia configurações altera; outra empresa não muda',async()=>{
 const a=await setup(),b=await setup();
 assert.deepEqual([(await rules(a,a.owner)).brandRequired,(await rules(a,a.owner)).confirmed],[false,true],'sem documento: desligada e confirmada');
 await assert.rejects(rules(a,a.editor,{brandRequired:true}),e=>e.code==='permission-denied');
 await assert.rejects(rules(a,a.owner,{brandRequired:'sim'}),e=>e.code==='invalid-argument');
 const on=await rules(a,a.owner,{brandRequired:true});assert.equal(on.brandRequired,true);assert.ok(on.updatedAt);
 assert.equal((await read(a,'settings','default')).productRules.brandRequired,true);
 assert.deepEqual((await read(a,'syncMetadata','last-sync')).changedCollections,['settings']);
 assert.equal((await a.root.collection('auditLogs').where('type','==','product_rules_changed').get()).size,1);
 assert.equal((await rules(a,a.seller)).brandRequired,true,'qualquer membro lê o estado confirmado');
 assert.equal((await rules(b,b.owner)).brandRequired,false);
 await rejectsBrand(service.commit(a.request(create(a,a.editor,'x',a.space))));
});

test('V242.7 P2: tentativa identificada (attemptId) — recibo na mesma transação, leitura consulta a tentativa, reenvio não regrava',async()=>{
 const a=await setup(),id='a'.repeat(8)+crypto.randomBytes(8).toString('hex');
 const before=await rules(a,a.owner,{attemptId:id});
 assert.deepEqual([before.brandRequired,before.attemptId,before.attempt],[false,id,'absent'],'antes da gravação: ausente (não prova falha)');
 const on=await rules(a,a.owner,{brandRequired:true,attemptId:id});
 assert.deepEqual([on.brandRequired,on.attemptId,on.attempt,on.replayed],[true,id,'applied',undefined]);
 const audit=await a.root.collection('auditLogs').doc('product_rules_attempt_'+id).get();
 assert.equal(audit.data().type,'product_rules_changed');assert.equal(audit.data().attemptId,id);assert.equal(audit.data().actorUid,a.owner);
 const status=await rules(a,a.seller,{attemptId:id});
 assert.deepEqual([status.attempt,status.brandRequired],['applied',true],'leitura autorizada confirma a tentativa');
 await rules(a,a.owner,{brandRequired:false,attemptId:'b'.repeat(24)});
 const replay=await rules(a,a.owner,{brandRequired:true,attemptId:id});
 assert.deepEqual([replay.attempt,replay.replayed,replay.brandRequired],['applied',true,false],'reenvio da mesma tentativa não regrava; devolve o valor atual');
 assert.equal((await read(a,'settings','default')).productRules.brandRequired,false);
 assert.equal((await a.root.collection('auditLogs').where('type','==','product_rules_changed').get()).size,2,'um audit por tentativa');
 for(const bad of ['curto','x'.repeat(65),'com espaço aqui 123',12345])await assert.rejects(rules(a,a.owner,{brandRequired:true,attemptId:bad}),e=>e.code==='invalid-argument');
 const b=await setup();
 assert.equal((await rules(b,b.owner,{attemptId:id})).attempt,'absent','outra empresa não enxerga a tentativa');
 await assert.rejects(rules(a,a.editor,{brandRequired:true,attemptId:'c'.repeat(24)}),e=>e.code==='permission-denied');
 assert.equal((await rules(a,a.owner,{attemptId:'c'.repeat(24)})).attempt,'absent');
});
