'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore Emulator required; never production');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const path=require('node:path'),functionSource=process.env.VECONI_TEST_FUNCTION_SOURCE||path.resolve('functions');
const {operationalCommitService}=require(path.resolve(functionSource,'src/services/operational-commit-service'));
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');
const {harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs'),M=require('../../functions/src/shared/flexible-service');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const projectId='demo-veconi-v238',runId=crypto.randomUUID().slice(0,8);let app,db,svc,env,seq=0;
test.before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(process.env.VECONI_TEST_RULES||'firestore.rules','utf8')}});app=initializeApp({projectId},'v238-services');db=getFirestore(app);svc=operationalCommitService(db);});
test.after(async()=>{await env?.cleanup();await db?.terminate();if(app)await deleteApp(app);});
async function setup(){
 const bid='services-'+runId+'-'+(++seq),space='space-'+bid,other='other-'+bid,owner='owner-'+bid,seller='seller-'+bid,root=db.doc('businesses/'+bid);
 await root.set({businessId:bid,ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const uid of [owner,seller]){await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role:uid===owner?'owner':'seller'});await root.collection('members').doc(uid).set({uid,status:'active',role:uid===owner?'owner':'seller',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:uid===owner?[]:[space],permissions:{'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true,'cost.view':false}});}
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,active:true,type:'business',ownerUid:owner,automation:{enabled:true,activatedAt:'2026-01-01T00:00:00Z'},capabilities:{sales:true,inventory:true,products:true,finance:true}});
 const makeHarness=uid=>{const h=harness({businessId:bid,spaceId:space,uid});vm.runInContext(fs.readFileSync('functions/src/shared/flexible-service.js','utf8'),h.c);Object.assign(h.data().produtos[0],{itemKind:'service',productType:'simple',controlaEstoque:false,semControleEstoque:true,serviceConfig:{version:1,id:'config-ride-001',pricingModel:'km'},serviceCostConfig:{model:'km',rate:.75,feePercent:10}});return h;};
 const h=makeHarness(owner),p=bridge(h.data().produtos[0]);await root.collection('clients').doc('qa-client').set(bridge(h.data().clientes[0]));delete p.custo;delete p.serviceCostConfig;
 await root.collection('products').doc(p.id).set(p);await root.collection('productFinancials').doc(p.id).set({productId:p.id,businessId:bid,custo:.75,serviceCostConfigs:{'config-ride-001':{model:'km',rate:.75,feePercent:10,pricingModel:'km',priceRate:3}}});
 const read=async(col,id)=>(await root.collection(col).doc(id).get()).data();
 const commit=(packet,uid=owner)=>svc.commit({auth:{uid},data:{businessId:bid,item:packet}});
 const sell=(harness=h,price=40,options={})=>{const before=bridge(harness.data()),e={version:1,id:crypto.randomUUID(),configurationId:'config-ride-001',pricingSnapshot:{model:'km',rate:3},km:12,minutes:30,source:'aplicativo'},snapshot=M.estimate({model:'km',rate:.75,feePercent:10},e,price,2),id=crypto.randomUUID(),operationId=crypto.randomUUID();
   const isOwner=harness===h;const sale=harness.c.Vendas.registrar({id,operationId,spaceId:space,status:'pago',formaPagamento:'pix',...options,itens:[{produtoId:p.id,nome:'Corrida QA',quantidade:1,precoOriginal:price,precoFinalUnitario:price,serviceExecution:e,...(isOwner?{serviceCostSnapshot:snapshot,custoUnitario:snapshot.estimatedCost}:{})}]});
   return{sale:bridge(sale),packet:{operationId,businessId:bid,userId:isOwner?owner:seller,workspaceGeneration:0,payloadVersion:4,payload:{eventKind:'sale',writes:bridge(harness.c.diffWrites(before,harness.data()))}}};};
 return{bid,space,other,owner,seller,root,h,makeHarness,p,read,commit,sell};
}
test('atomic service sale, private cost, receipt/idempotency and one financial income, no stock movement or cash expense',async()=>{
 const c=await setup(),{sale,packet}=c.sell();await c.commit(packet);
 const remote=await c.read('sales',sale.id),financial=await c.read('saleFinancials',sale.id);
 assert.equal(remote.valorFinal,40);assert.equal(remote.itens[0].serviceExecution.km,12);assert.equal(remote.itens[0].serviceCostSnapshot,undefined);
 assert.equal(financial.custoTotal,15);assert.equal(financial.lucro,25);assert.equal(financial.itemCosts[0].serviceCostSnapshot.additionalCosts,2);
 assert.equal((await c.commit(packet)).replayed,true);assert.equal((await c.root.collection('sales').get()).size,1);
 assert.equal((await c.root.collection('stockMovements').get()).size,0);assert.equal((await c.read('products',c.p.id)).estoqueAtual,3);
 const income=financialIncomeService(db),first=await income.projectSale(c.bid,sale.id,remote);await income.projectSale(c.bid,sale.id,remote);
 assert.ok(first);const entries=await db.collection(`financialSpaces/${c.space}/entries`).get();assert.equal(entries.size,1);assert.equal(entries.docs[0].data().amountCents,4000);
 assert.ok(await c.read('processedOperations',packet.operationId));
});
test('two devices can commit different executions concurrently without stock or balance conflicts',async()=>{
 const c=await setup(),a=c.sell(),b=c.sell(c.makeHarness(c.seller),25);await Promise.all([c.commit(a.packet),c.commit(b.packet,c.seller)]);
 assert.equal((await c.root.collection('sales').get()).size,2);assert.equal((await c.root.collection('processedOperations').get()).size,2);
 assert.equal((await c.read('saleFinancials',b.sale.id)).custoTotal,11.5);assert.equal((await c.root.collection('stockMovements').get()).size,0);
});
test('offline original configuration remains valid after configuration changes; replay never recomputes costs',async()=>{
 const c=await setup(),a=c.sell();await c.root.collection('products').doc(c.p.id).update({preco:99,serviceConfig:{version:1,id:'config-ride-002',pricingModel:'fixed'}});
 await c.root.collection('productFinancials').doc(c.p.id).set({custo:500,serviceCostConfigs:{'config-ride-002':{model:'fixed',rate:500,feePercent:0,pricingModel:'fixed',priceRate:99}}},{merge:true});
 await c.commit(a.packet);assert.equal((await c.read('saleFinancials',a.sale.id)).custoTotal,15);
 await c.root.collection('productFinancials').doc(c.p.id).update({custo:999});assert.equal((await c.commit(a.packet)).replayed,true);assert.equal((await c.read('saleFinancials',a.sale.id)).custoTotal,15);
});
test('seller cannot forge additional costs, execute another space, or act for another business',async()=>{
 const c=await setup(),h=c.makeHarness(c.seller),a=c.sell(h);const sales=a.packet.payload.writes.find(w=>w.entityType==='sales');
 const bad=bridge(a.packet);bad.payload.writes.find(w=>w.entityType==='sales').data.itens[0].serviceCostSnapshot={additionalCosts:100};
 await assert.rejects(c.commit(bad,c.seller),/Custos adicionais/);
 const outside=bridge(a.packet);outside.payload.writes.find(w=>w.entityType==='sales').data.spaceId=c.other;await assert.rejects(c.commit(outside,c.seller));
 const foreign=bridge(a.packet);foreign.businessId='foreign-tenant';await assert.rejects(c.commit(foreign,c.seller));
 assert.equal((await c.root.collection('sales').get()).size,0);assert.ok(sales);
});
test('legacy PWA cannot accidentally sell a new per-km service as a fixed unit; normal physical sales still work',async()=>{
 const c=await setup(),h=c.makeHarness(c.owner);const old=h.sell({status:'pago',formaPagamento:'dinheiro'});await assert.rejects(c.commit(old.packet),/Atualize o aplicativo/);
 const next={...c.p,itemKind:'product',controlaEstoque:true,semControleEstoque:false};delete next.serviceConfig;await c.root.collection('products').doc(next.id).set(next);
 const h2=harness({businessId:c.bid,spaceId:c.space,uid:c.owner});const normal=h2.sell({status:'pago',formaPagamento:'dinheiro'});await c.commit(normal.packet);
 assert.equal((await c.read('products',next.id)).estoqueAtual,2);assert.equal((await c.root.collection('stockMovements').get()).size,1);
});
test('missing original config blocks safely, and duplicate execution in one sale is rejected atomically',async()=>{
 const c=await setup(),a=c.sell();a.packet.payload.writes.find(w=>w.entityType==='sales').data.itens[0].serviceExecution.configurationId='unknown-config-001';
 await assert.rejects(c.commit(a.packet),/Configuração original/);assert.equal((await c.root.collection('sales').get()).size,0);
 const b=c.sell();b.packet.payload.writes.find(w=>w.entityType==='sales').data.itens[0].quantidade=2;await assert.rejects(c.commit(b.packet));assert.equal((await c.root.collection('sales').get()).size,0);
});
test('catalog persists private configuration versions atomically and refuses to rewrite an existing version',async()=>{
 const c=await setup(),build=require('../../functions/src/shared/product-model').build,id='qa-created-service';
 const make=(configId,rate)=>({operationId:crypto.randomUUID(),businessId:c.bid,userId:c.owner,payloadVersion:4,payload:{eventKind:'simple',writes:[{entityType:'products',entityId:id,operation:configId==='created-config-001'?'create':'update',data:{id,businessId:c.bid,...build({nome:'Motoboy QA',itemKind:'service',preco:20,custo:rate,serviceConfig:{version:1,id:configId,pricingModel:'fixed'},serviceCostConfig:{model:'fixed',rate,feePercent:5}})}}]}});
 const a=make('created-config-001',3);await c.commit(a);
 const p=await c.read('products',id),financial=await c.read('productFinancials',id);assert.equal(p.serviceCostConfig,undefined);assert.equal(financial.serviceCostConfigs['created-config-001'].rate,3);
 const b=make('created-config-002',5);await c.commit(b);const versions=(await c.read('productFinancials',id)).serviceCostConfigs;assert.equal(versions['created-config-001'].rate,3);assert.equal(versions['created-config-002'].rate,5);
 const forged=make('created-config-001',999);forged.payload.writes[0].operation='update';await assert.rejects(c.commit(forged),/reescrita/);
 assert.equal((await c.read('productFinancials',id)).serviceCostConfigs['created-config-001'].rate,3);
});
test('Rules preserve authorized public product access, deny private costs and cross-company access, and forbid public cost configuration',async()=>{
 const c=await setup(),owner=env.authenticatedContext(c.owner).firestore(),seller=env.authenticatedContext(c.seller).firestore(),foreign=env.authenticatedContext('foreign-owner').firestore();
 const p=db=>sdk.doc(db,`businesses/${c.bid}/products/${c.p.id}`);
 await assertSucceeds(sdk.getDoc(p(seller)));
 await assertFails(sdk.getDoc(sdk.doc(seller,`businesses/${c.bid}/productFinancials/${c.p.id}`)));
 await assertFails(sdk.getDoc(p(foreign)));
 await assertSucceeds(sdk.updateDoc(p(owner),{nome:'Corrida renomeada QA'}));
 await assertFails(sdk.updateDoc(p(owner),{serviceCostConfig:{model:'fixed',rate:99,feePercent:0}}));
 await assert.rejects(svc.commit({data:{businessId:c.bid,item:c.sell().packet}}));
});
test('service supports existing cash/card methods and Fiado without inventing received cash for credit',async()=>{
 for(const formaPagamento of ['dinheiro','cartao','fiado']){
  const c=await setup(),credit=formaPagamento==='fiado',a=c.sell(c.h,40,{formaPagamento,status:credit?'fiado':'pago',...(credit?{clienteId:'qa-client'}:{})});
  await c.commit(a.packet);const remote=await c.read('sales',a.sale.id);assert.equal(remote.formaPagamento,formaPagamento);
  assert.equal((await c.root.collection('stockMovements').get()).size,0);
  const income=financialIncomeService(db);await income.projectSale(c.bid,a.sale.id,remote);await income.projectSale(c.bid,a.sale.id,remote);
  assert.equal((await db.collection(`financialSpaces/${c.space}/entries`).get()).size,credit?0:1);
  if(credit){assert.equal((await c.read('clients','qa-client')).saldo,-52);assert.equal((await c.read('clients','qa-client')).financialVersion,13);}
 }
});
test('mixed basket keeps physical stock movement and service estimate independent, once',async()=>{
 const c=await setup(),physical={...harness({businessId:c.bid,spaceId:c.space,uid:c.owner}).data().produtos[0],id:'qa-bottle',preco:5,custo:2};c.h.data().produtos.push(physical);
 const stored=bridge(physical);delete stored.custo;await c.root.collection('products').doc(physical.id).set(stored);await c.root.collection('productFinancials').doc(physical.id).set({custo:2});
 const before=bridge(c.h.data()),e=M.execution({version:1,id:crypto.randomUUID(),configurationId:'config-ride-001',pricingSnapshot:{model:'km',rate:3},km:12,minutes:30,source:'particular'}),cost=M.estimate({model:'km',rate:.75,feePercent:10},e,40,2),operationId=crypto.randomUUID();
 const sale=c.h.c.Vendas.registrar({id:crypto.randomUUID(),operationId,spaceId:c.space,status:'pago',formaPagamento:'dinheiro',itens:[{produtoId:c.p.id,nome:'Corrida',quantidade:1,precoOriginal:40,precoFinalUnitario:40,serviceExecution:e,serviceCostSnapshot:cost,custoUnitario:15},{produtoId:physical.id,nome:'Água',quantidade:1,precoOriginal:5,precoFinalUnitario:5,custoUnitario:2}]});
 const packet={operationId,businessId:c.bid,userId:c.owner,payloadVersion:4,payload:{eventKind:'sale',writes:bridge(c.h.c.diffWrites(before,c.h.data()))}};
 await c.commit(packet);assert.equal((await c.commit(packet)).replayed,true);
 assert.equal((await c.read('products',physical.id)).estoqueAtual,2);assert.equal((await c.read('products',c.p.id)).estoqueAtual,3);
 assert.equal((await c.root.collection('stockMovements').get()).size,1);assert.equal((await c.read('saleFinancials',sale.id)).custoTotal,17);
});
async function physicalCase(){const c=await setup(),p={...c.p,itemKind:'product',controlaEstoque:true,semControleEstoque:false};delete p.serviceConfig;await c.root.collection('products').doc(p.id).set(p);return{...c,physicalHarness:()=>harness({businessId:c.bid,spaceId:c.space,uid:c.owner})};}
test('00022-jim aliases: original legacy aliases survive later sales, forged aliases stay blocked and retry is immutable',async()=>{
 const c=await physicalCase(),a=c.physicalHarness().sell({status:'pago'}),w=a.packet.payload.writes.find(w=>w.entityType==='products');
 w.data.totalStock=w.before.totalStock;w.data.estoque=w.before.estoque;
 await c.root.collection('products').doc(c.p.id).update({estoqueAtual:2,estoque:2,totalStock:2});
 await c.commit(a.packet);const snapshot=await c.read('processedOperations',a.packet.operationId);
 assert.deepEqual([...(await Promise.all(['estoqueAtual','estoque','totalStock'].map(async k=>(await c.read('products',c.p.id))[k])))],[1,1,1]);
 assert.equal((await c.commit(a.packet)).replayed,true);assert.deepEqual(await c.read('processedOperations',a.packet.operationId),snapshot);
 const b=c.physicalHarness().sell({status:'pago'});b.packet.payload.writes.find(w=>w.entityType==='products').data.totalStock=99;
 await assert.rejects(c.commit(b.packet),/Alias de estoque divergente/);assert.equal((await c.root.collection('sales').get()).size,1);
});
test('00022-jim physical stock concurrency never oversells the last unit',async()=>{
 const c=await physicalCase();await c.root.collection('products').doc(c.p.id).update({estoqueAtual:1,estoque:1,totalStock:1});
 const a=c.physicalHarness().sell({status:'pago'}),b=c.physicalHarness().sell({status:'pago'}),results=await Promise.allSettled([c.commit(a.packet),c.commit(b.packet)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await c.read('products',c.p.id)).estoqueAtual,0);assert.equal((await c.root.collection('stockMovements').get()).size,1);
});
test('prepared containment rollback keeps receipts, normal sales and snapshots, but fences new flexible executions',{skip:!process.env.VECONI_TEST_ROLLBACK_SOURCE},async()=>{
 const rollback=operational=>require(path.resolve(process.env.VECONI_TEST_ROLLBACK_SOURCE,'src/services/operational-commit-service')).operationalCommitService(operational),svc=rollback(db),c=await setup(),a=c.sell();
 await c.commit(a.packet);const marker=await c.read('processedOperations',a.packet.operationId);
 assert.equal((await svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,item:a.packet}})).replayed,true);assert.deepEqual(await c.read('processedOperations',a.packet.operationId),marker);
 const b=c.sell();await assert.rejects(svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,item:b.packet}}),/temporariamente pausadas/);assert.equal((await c.root.collection('sales').get()).size,1);
 const normal=await physicalCase(),p=normal.physicalHarness().sell({status:'pago'});await svc.commit({auth:{uid:normal.owner},data:{businessId:normal.bid,item:p.packet}});assert.equal((await normal.read('products',normal.p.id)).estoqueAtual,2);
});
test('active-source readers keep V224, private costs and company/space isolation for service projections',{skip:!process.env.VECONI_TEST_PERFORMANCE_SOURCE||!process.env.VECONI_TEST_READER_SOURCE},async()=>{
 const c=await setup(),a=c.sell();await c.commit(a.packet);
 const performance=require(path.resolve(process.env.VECONI_TEST_PERFORMANCE_SOURCE,'src/services/performance-read-service')).performanceReadService(db),reader=require(path.resolve(process.env.VECONI_TEST_READER_SOURCE,'src/services/operational-read-service')).operationalReadService(db);
 const range={businessId:c.bid,workspaceGeneration:0,from:'2020-01-01T00:00:00Z',to:'2021-01-01T00:00:00Z',spaceId:c.space},readInput={businessId:c.bid,spaceId:c.space,collection:'sales',mode:'get',id:a.sale.id};
 await c.root.collection('sales').doc(a.sale.id).update({data:'2020-05-01T12:00:00Z'});
 const page=await performance.page({auth:{uid:c.owner},data:range});assert.equal(page.rows.length,1);assert.equal(page.rows[0].itens[0].serviceExecution.km,12);
 const projected=await reader.read({auth:{uid:c.owner},data:readInput});assert.equal(projected.record.itens[0].serviceExecution.km,12);assert.equal(projected.record.itens[0].serviceCostSnapshot,undefined);
 await c.root.collection('members').doc(c.seller).update({permissionsVersion:3,permissions:{'sales.create':true,'sales.viewAll':true,'performance.daily':true,'performance.history':false,'reports.view':true,'products.view':true,'inventory.view':true}});
 await assert.rejects(performance.page({auth:{uid:c.seller},data:range}),{code:'permission-denied'});await assert.rejects(reader.read({auth:{uid:c.seller},data:readInput}),{code:'permission-denied'});
 await c.root.collection('members').doc(c.seller).update({permissions:{'sales.create':true,'sales.viewAll':true,'performance.daily':true,'performance.history':true,'reports.view':true,'products.view':true,'inventory.view':true}});
 const seller=await performance.page({auth:{uid:c.seller},data:{...range,spaceId:'all'}});assert.equal(seller.rows.length,1);assert.equal(seller.rows[0].custoTotal,undefined);assert.equal(seller.rows[0].lucro,undefined);
 await assert.rejects(performance.page({auth:{uid:c.seller},data:{...range,spaceId:c.other}}),{code:'permission-denied'});
 await assert.rejects(reader.read({auth:{uid:c.seller},data:{...readInput,spaceId:c.other}}),{code:'permission-denied'});
 await assert.rejects(performance.page({auth:{uid:'foreign-user'},data:range}),{code:'permission-denied'});
});
