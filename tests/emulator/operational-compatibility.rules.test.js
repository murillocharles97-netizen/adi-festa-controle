'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const operationalSource=process.env.VECONI_TEST_FUNCTION_SOURCE;
const readerSource=process.env.VECONI_TEST_READER_SOURCE;
const {operationalCommitService}=operationalSource
 ?require(require('node:path').resolve(operationalSource,'src/services/operational-commit-service'))
 :require('../../functions/src/services/operational-commit-service');
const {financialMaintenanceService}=require('../../functions/src/services/financial-maintenance-service');
const {harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required, never production');
let env,app,db,svc,maintenance,seq=0;
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-veconi-compatibility-v202',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-veconi-compatibility-v202'},'operational-compatibility');db=getFirestore(app);svc=operationalCommitService(db);maintenance=financialMaintenanceService(db);});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup(){
 const bid='compat-'+(++seq),space='space-'+bid,other='other-'+bid,owner='owner-'+bid,seller='seller-'+bid,root=db.doc('businesses/'+bid),permissions={'sales.create':true,'sales.cancel':true,'customers.view':true,'customers.receiveDebt':true,'products.view':true,'inventory.view':true};
 await root.set({businessId:bid,ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const uid of [owner,seller]){await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role:uid===owner?'owner':'cashier'});await root.collection('members').doc(uid).set({uid,status:'active',role:uid===owner?'owner':'seller',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:uid===owner?[]:[space],permissions});}
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,active:true,type:'business',ownerUid:owner,capabilities:{sales:true,inventory:true,products:true,finance:true}});
 const h=harness({businessId:bid,spaceId:space,uid:seller});
 for(const [col,rows]of [['clients',h.data().clientes],['products',h.data().produtos]])for(const row of rows)await root.collection(col).doc(row.id).set(row);
 const read=async(col,id)=>(await root.collection(col).doc(id).get()).data(),set=(col,id,value)=>root.collection(col).doc(id).set(value);
 const packet=(before,op=crypto.randomUUID(),eventKind='simple',uid=seller)=>({operationId:op,businessId:bid,userId:uid,workspaceGeneration:0,payload:{eventKind,writes:bridge(h.c.diffWrites(before,h.data()))}});
 const commit=p=>svc.commit({auth:{uid:p.userId},data:{businessId:bid,item:p}});
 const admin=(command,more,uid=owner)=>maintenance.commit({auth:{uid},data:{businessId:bid,workspaceGeneration:0,command,confirmed:true,clientId:'qa-client',expectedBalance:-12,expectedFinancialVersion:12,...more}});
 const directory=(data,uid=owner)=>svc.commit({auth:{uid},data:{kind:'customer_directory',businessId:bid,workspaceGeneration:0,...data}});
 return{bid,space,other,owner,seller,root,h,read,set,packet,commit,admin,permissions,directory};
}
function domains(c){for(const p of ['js/campaign-engine-v2.js','js/customer-subscriptions.js'])vm.runInContext(fs.readFileSync(p,'utf8'),c.h.c);Object.assign(c.h.c.SOURCES,{campaigns:{key:'campanhas'},campaignProgress:{key:'progressosCampanha'},campaignEvents:{key:'eventosCampanha'},campaignRedemptions:{key:'resgatesCampanha'},customerSubscriptions:{key:'customerSubscriptions'},customerSubscriptionEvents:{key:'customerSubscriptionEvents'}});c.h.c.Campanhas={aplicarVendaNoBanco:(data,sale)=>{const r=c.h.c.CampaignEngineV2.applySale(data,sale);sale.campaignEvents=r.events.map(e=>e.id);return r.snapshots;},reverterVendaNoBanco:(data,sale)=>c.h.c.CampaignEngineV2.reverseSale(data,sale)};}

test('customer directory saves the active space and optional links without duplicates on retry',async()=>{
 const c=await setup();
 const create=(customerId,activeSpaceId,spaceIds)=>({action:'create',customerId,activeSpaceId,spaceIds,customer:{nome:'Cliente QA'}});
 for(const [id,space,spaces] of [['qa-iptv',c.other,[c.other]],['qa-festa',c.space,[c.space]],['qa-shared',c.other,[c.other,c.space]]]){
  const request=create(id,space,spaces);
  assert.equal((await c.directory(request)).status,'created');
  assert.equal((await c.directory(request)).clientId,id);
  const record=await c.read('clients',id);
  assert.equal(record.spaceId,space);assert.deepEqual(record.customerSpaceIds,spaces);
  assert.equal(record.saldo,0);assert.equal(record.financialVersion,0);
 }
 assert.equal((await c.root.collection('clients').get()).size,4);
});

test('customer directory detects a formatted legacy WhatsApp and links only the same client after confirmation',async()=>{
 const c=await setup(),id='qa-legacy-phone',phone='5511987654321';
 const record={id,businessId:c.bid,spaceId:c.space,telefone:'(11) 98765-4321',nome:'Cliente original',saldo:-81,financialVersion:3};
 await c.set('clients',id,record);
 const subscription={id:'qa-sub',businessId:c.bid,clientId:id,spaceId:c.space,expiresAt:'2096-02-29'};
 const sale={id:'qa-old-sale',businessId:c.bid,clienteId:id,spaceId:c.space,valorFinal:81};
 await c.set('customerSubscriptions',subscription.id,subscription);
 await c.set('sales',sale.id,sale);
 const create={action:'create',customerId:'qa-candidate',activeSpaceId:c.other,spaceIds:[c.other],customer:{nome:'Dados do formulário',telefone:'+55 11 98765-4321'}};
 assert.deepEqual(await c.directory(create),{status:'duplicate',clientId:id,canLink:true});
 const link={action:'link',customerId:id,activeSpaceId:c.other,phone};
 await assert.rejects(c.directory(link),/Confirme o vínculo/);
 await assert.rejects(c.directory({...link,customerId:'qa-wrong',confirmed:true}),/associado ao WhatsApp mudou/);
 assert.deepEqual(await c.read('clients',id),record);
 assert.equal((await c.directory({...link,confirmed:true})).status,'linked');
 assert.equal((await c.directory({...link,confirmed:true})).status,'already-linked');
 assert.equal((await c.directory(create)).status,'already-linked');
 assert.deepEqual(await c.read('clients',id),{...record,customerSpaceIds:[c.other]});
 assert.deepEqual(await c.read('customerSubscriptions',subscription.id),subscription);
 assert.deepEqual(await c.read('sales',sale.id),sale);
 assert.equal(await c.read('clients','qa-candidate'),undefined);
});

test('customer directory serializes concurrent creates for a WhatsApp across spaces',async()=>{
 const c=await setup(),customer={nome:'Cliente concorrente QA',telefone:'(11) 98765-4321'};
 const replies=await Promise.all([c.space,c.other].map((space,i)=>c.directory({
  action:'create',customerId:'qa-concurrent-'+i,activeSpaceId:space,spaceIds:[space],customer,
 })));
 assert.deepEqual(replies.map(reply=>reply.status).sort(),['created','duplicate']);
 assert.equal(replies[0].clientId,replies[1].clientId);
 assert.equal((await c.root.collection('clients').where('normalizedPhone','==','5511987654321').get()).size,1);
 assert.equal((await c.root.collection('customerPhoneKeys').get()).size,1);
});

test('customer directory accepts a queued legacy registration with 3001 existing customers',async()=>{
 const c=await setup(),id='queued-customer',phone='5511987654321',operationId=crypto.randomUUID();
 const clients=c.root.collection('clients');
 for(let start=0;start<3000;start+=450){
  const batch=db.batch();
  for(let i=start;i<Math.min(start+450,3000);i++)batch.set(clients.doc('existing-'+i),{businessId:c.bid,nome:'Cliente QA',ativo:true});
  await batch.commit();
 }
 assert.equal((await clients.count().get()).data().count,3001);
 const item={operationId,businessId:c.bid,userId:c.owner,workspaceGeneration:0,payloadVersion:4,
  payload:{eventKind:'simple',writes:[{entityType:'clients',entityId:id,operation:'create',data:{
   id,businessId:c.bid,nome:'Cadastro pendente QA',telefone:'(11) 98765-4321',normalizedPhone:phone,ativo:true,saldo:0,financialVersion:0,
  }}]}};
 const before=structuredClone(item);
 await c.commit(item);
 assert.equal((await c.commit(item)).replayed,true);
 assert.deepEqual(item,before);
 assert.equal((await c.read('clients',id)).saldo,0);
 const duplicate={action:'create',customerId:'qa-duplicate',activeSpaceId:c.space,spaceIds:[c.space],customer:{nome:'Outro QA',telefone:'+55 11 98765-4321'}};
 assert.equal((await c.directory(duplicate)).clientId,id);
 const oldDuplicate={...item,operationId:crypto.randomUUID(),payload:{...item.payload,writes:[{
  ...item.payload.writes[0],entityId:duplicate.customerId,data:{...item.payload.writes[0].data,id:duplicate.customerId},
 }]}};
 await assert.rejects(c.commit(oldDuplicate),{code:'already-exists'});
 assert.equal((await clients.where('normalizedPhone','==',phone).get()).size,1);
 assert.equal((await c.root.collection('customerPhoneKeys').get()).size,1);
});

test('customer directory rejects foreign targets and redacts an inaccessible source',async()=>{
 const c=await setup(),phone='5511987654321',id='qa-hidden-source';
 await c.root.collection('members').doc(c.seller).update({permissions:{...c.permissions,'customers.create':true,'customers.edit':true}});
 await c.set('clients',id,{id,businessId:c.bid,spaceId:c.other,nome:'Privado',telefone:phone,saldo:-80});
 const create={action:'create',customerId:'qa-attempt',activeSpaceId:c.space,spaceIds:[c.space],customer:{nome:'QA',telefone:phone}};
 assert.deepEqual(await c.directory(create,c.seller),{status:'duplicate-private'});
 await assert.rejects(c.directory({...create,spaceIds:[c.space,c.other]},c.seller),/Espaço não autorizado/);
 assert.deepEqual(await c.directory({action:'link',customerId:id,activeSpaceId:c.space,phone,confirmed:true},c.seller),{status:'duplicate-private'});
 assert.equal(await c.read('clients','qa-attempt'),undefined);
 assert.equal((await c.read('clients',id)).customerSpaceIds,undefined);
});

test('customer directory checkout reads only the selected linked space, with the original customer ID', {skip:!readerSource}, async()=>{
 const c=await setup(),id='qa-shared-directory';
 const {operationalReadService}=require(require('node:path').resolve(readerSource,'src/services/operational-read-service'));
 const gateway=operationalReadService(db);
 await c.root.collection('members').doc(c.seller).update({permissionsVersion:3,allowedSpaceIds:[c.space,c.other]});
 await c.directory({action:'create',customerId:id,activeSpaceId:c.other,spaceIds:[c.other,c.space],customer:{nome:'QA',telefone:'11987654321'}});
 await c.root.collection('clients').doc(id).update({saldo:-81,financialVersion:3,observacoes:'Privado'});
 for(const spaceId of [c.other,c.space])await c.set('customerSubscriptions',spaceId,{businessId:c.bid,spaceId,clientId:id,expiresAt:'2096-02-29'});
 const read=(spaceId,extra)=>gateway.read({auth:{uid:c.seller},data:{businessId:c.bid,workspaceGeneration:0,collection:'clients',spaceId,...extra}});
 const first=(await read(c.space,{mode:'get',id})).record;
 assert.equal(first.customerDirectoryOnly,true);
 assert.equal(first.saldo,undefined);assert.equal(first.financialVersion,undefined);assert.equal(first.observacoes,undefined);
 assert.deepEqual(first.customerSpaceIds,[c.other,c.space]);
 assert.equal((await read(c.space,{mode:'page',limit:100})).items.find(row=>row.id===id).customerDirectoryOnly,true);
 const original=(await read(c.other,{mode:'get',id})).record;
 assert.equal(original.customerDirectoryOnly,false);assert.equal(original.saldo,-81);
 const checkout=(spaceId,purpose='checkout',customerId=id)=>read(spaceId,{mode:'customer_context',purpose,customerId});
 const added=await checkout(c.space),initial=await checkout(c.other);
 assert.equal(added.client.id,id);assert.equal(initial.client.id,id);
 assert.equal(added.client.saldo,undefined);assert.equal(added.client.financialVersion,undefined);assert.equal(added.client.spaceId,undefined);
 assert.equal(initial.client.saldo,-81);
 assert.deepEqual(added.customerSubscriptions.map(row=>row.spaceId),[c.space]);
 assert.deepEqual(initial.customerSubscriptions.map(row=>row.spaceId),[c.other]);
 await assert.rejects(checkout(c.space,'payment'),{code:'permission-denied'});
 await assert.rejects(read(c.space,{mode:'last_payment',customerId:id}),/fora do espaço autorizado/);
 await c.root.collection('members').doc(c.seller).update({allowedSpaceIds:[c.space]});
 assert.deepEqual((await read(c.space,{mode:'get',id})).record.customerSpaceIds,[c.space]);
 assert.equal((await checkout(c.space)).client.id,id);
 await assert.rejects(checkout(c.other),/Espaço não autorizado/);
 const unlinked='qa-unlinked';
 await c.set('clients',unlinked,{id:unlinked,businessId:c.bid,spaceId:c.other,customerSpaceIds:[c.space],nome:'QA'});
 await assert.rejects(checkout(c.space,'checkout',unlinked),{code:'permission-denied'});
 await assert.rejects(read(c.space,{mode:'get',id:unlinked}),{code:'permission-denied'});
 await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(c.seller).firestore(),c.root.path+'/customerDirectoryLinks/'+unlinked),{clientId:unlinked,spaceIds:[c.space]}));
 await c.root.collection('members').doc(c.seller).update({permissions:{...c.permissions,'customers.view':false}});
 await assert.rejects(checkout(c.space),{code:'permission-denied'});
});

test('customer directory paid checkout commits stock and counters once without exposing or changing debt', {skip:!readerSource}, async()=>{
 const c=await setup(),id='qa-client';
 await c.root.collection('members').doc(c.seller).update({permissionsVersion:3});
 await c.root.collection('clients').doc(id).update({spaceId:c.other,telefone:'11987654321'});
 await c.directory({action:'link',customerId:id,activeSpaceId:c.space,phone:'5511987654321',confirmed:true});
 const {operationalReadService}=require(require('node:path').resolve(readerSource,'src/services/operational-read-service'));
 const {client}=await operationalReadService(db).read({auth:{uid:c.seller},data:{
  businessId:c.bid,workspaceGeneration:0,spaceId:c.space,mode:'customer_context',purpose:'checkout',customerId:id,
 }});
 assert.equal(client.customerDirectoryOnly,true);
 c.h.data().clientes[0]=client;
 const {sale,packet}=c.h.sell({status:'pago',formaPagamento:'pix'});
 assert.equal(packet.payload.writes.some(w=>w.entityType==='clients'),false);
 await c.commit(packet);
 assert.equal((await c.commit(packet)).replayed,true);
 const saved=await c.read('clients',id);
 assert.equal(saved.saldo,-12);assert.equal(saved.financialVersion,12);
 assert.equal(saved.totalComprado,26);assert.equal(saved.quantidadeVendas,2);
 assert.equal((await c.read('sales',sale.id)).clienteId,id);
 assert.equal((await c.read('products','qa-product')).estoqueAtual,2);
 assert.equal((await c.root.collection('stockMovements').get()).size,1);
});
async function campaign(c){domains(c);const value={id:'qa-campaign',businessId:c.bid,type:'buy_get',name:'Campanha fictícia',status:'active',active:true,startsAt:'2020-01-01',qualification:{productIds:['qa-product']},rule:{requiredQuantity:1,multipleCycles:true},rewards:[{id:'reward',type:'product',productId:'qa-product',quantity:1}],updatedAt:'2026-01-01'};c.h.data().campanhas=[value];await c.set('campaigns',value.id,value);return value;}

test('owner reconciles only-local balance exactly once; original event/queue evidence and no stock/sale effects',async()=>{
 const c=await setup(),sale={id:'local',operationId:'local-op',businessId:c.bid,spaceId:c.space,clienteId:'qa-client',valorFinal:14},intent={operationId:'legacy_reconciliation:local',sale,reason:'Reconciliação explícita fictícia',targetBalance:-10},saved=structuredClone(intent);
 await c.admin('reconcile_only_local_balance',intent);await c.admin('reconcile_only_local_balance',intent);
 assert.deepEqual(intent,saved);assert.equal((await c.read('clients','qa-client')).saldo,-10);assert.equal((await c.root.collection('sales').get()).size,0);assert.equal((await c.root.collection('stockMovements').get()).size,0);assert.equal((await c.root.collection('balanceEvents').get()).size,1);assert.equal((await c.root.collection('financialMaintenanceAudits').get()).size,1);
 await assertFails(sdk.getDoc(sdk.doc(env.authenticatedContext(c.owner).firestore(),c.root.path+'/financialMaintenanceAudits/'+intent.operationId)));
});
for(const command of ['reconcile_only_local_balance','recover_only_local_sale','reconcile_balances','reverse_duplicate_payment'])test(`seller never gains administrative repair permission: ${command}`,async()=>{const c=await setup();await assert.rejects(c.admin(command,{operationId:'unauthorized'},c.seller),{code:'permission-denied'});assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.root.collection('processedOperations').get()).size,0);});
test('manual balance repair rejects stale version, changed request, foreign space and already-recorded source',async()=>{
 const c=await setup(),sale={id:'local',operationId:'local-op',businessId:c.bid,spaceId:c.space,clienteId:'qa-client'},intent={operationId:'legacy_reconciliation:local',sale,reason:'Ajuste fictício QA',targetBalance:-10};
 await assert.rejects(c.admin('reconcile_only_local_balance',{...intent,expectedFinancialVersion:11}));await c.set('sales','local',{...sale,status:'pago'});await assert.rejects(c.admin('reconcile_only_local_balance',intent));assert.equal((await c.read('clients','qa-client')).saldo,-12);
});
test('recover missing Fiado sale requires existing original stock movements and does not reapply stock',async()=>{
 const c=await setup(),{sale}=c.h.sell(),moves=c.h.data().movimentacoesEstoque;
 const intent={operationId:sale.operationId,sale:bridge(sale)};
 await assert.rejects(c.admin('recover_only_local_sale',intent),/Baixas originais/);
 for(const m of moves)await c.set('stockMovements',m.id,bridge(m));await c.set('products','qa-product',bridge(c.h.data().produtos[0]));
 const before=await c.read('products','qa-product');await Promise.all([c.admin('recover_only_local_sale',intent),c.admin('recover_only_local_sale',intent)]);assert.equal((await c.read('clients','qa-client')).saldo,-26);assert.deepEqual(await c.read('products','qa-product'),before);assert.equal((await c.root.collection('sales').get()).size,1);assert.equal((await c.root.collection('stockMovements').get()).size,1);assert.equal((await c.read('sales',sale.id)).status,'fiado');
});
test('paid anonymous only-local sale can be preserved after proving original stock, without any balance write',async()=>{
 const c=await setup(),{sale}=c.h.sell({status:'pago'});sale.clienteId=null;sale.customerId=null;for(const m of c.h.data().movimentacoesEstoque)await c.set('stockMovements',m.id,bridge(m));const before=await c.read('clients','qa-client');const intent={operationId:sale.operationId,sale:bridge(sale),clientId:null};await c.admin('recover_only_local_sale',intent);assert.deepEqual(await c.read('clients','qa-client'),before);assert.equal((await c.root.collection('balanceEvents').get()).size,0);assert.equal((await c.read('sales',sale.id)).status,'pago');
});
test('new preview after lost admin response acknowledges the same target, not another repair',async()=>{
 const c=await setup(),sale={id:'local',operationId:'local-op',businessId:c.bid,spaceId:c.space,clienteId:'qa-client'},intent={operationId:'legacy_reconciliation:local',sale,reason:'Reconciliação explícita fictícia',targetBalance:-10};await c.admin('reconcile_only_local_balance',intent);const replay=await c.admin('reconcile_only_local_balance',{...intent,expectedBalance:-10,expectedFinancialVersion:13});assert.equal(replay.idempotent,true);await assert.rejects(c.admin('reconcile_only_local_balance',{...intent,targetBalance:-9,expectedBalance:-10,expectedFinancialVersion:13}),{code:'already-exists'});assert.equal((await c.read('clients','qa-client')).saldo,-10);
});
test('reconcile balances derives the missing effect from canonical sources, not submitted deltas',async()=>{
 const c=await setup(),{sale}=c.h.sell();await c.set('sales',sale.id,bridge(sale));const intent={operationId:'balance-reconcile:qa',targetBalance:-26,effectIds:['credit_sale:'+sale.id]};
 await assert.rejects(c.admin('reconcile_balances',{...intent,targetBalance:100}));await c.admin('reconcile_balances',intent);await c.admin('reconcile_balances',intent);assert.equal((await c.read('clients','qa-client')).saldo,-26);assert.equal((await c.read('clients','qa-client')).financialVersion,13);assert.equal((await c.root.collection('balanceEvents').get()).size,1);
});
test('effect backfill leaves an already-applied balance and counters untouched',async()=>{
 const c=await setup(),{sale}=c.h.sell();await c.set('sales',sale.id,bridge(sale));await c.set('clients','qa-client',bridge(c.h.data().clientes[0]));const before=await c.read('clients','qa-client');await c.admin('reconcile_balances',{operationId:'balance-reconcile:backfill',expectedBalance:-26,expectedFinancialVersion:13,targetBalance:-26,effectIds:['credit_sale:'+sale.id]});assert.deepEqual(await c.read('clients','qa-client'),before);assert.equal((await c.root.collection('balanceEvents').get()).size,1);
});
test('reconciliation effect-ID collision never overwrites an event belonging to another customer',async()=>{
 const c=await setup(),{sale}=c.h.sell();await c.set('sales',sale.id,bridge(sale));const effect={id:'credit_sale:'+sale.id,customerId:'another-client',balanceDelta:-999,status:'applied'};await c.set('balanceEvents',effect.id,effect);
 await assert.rejects(c.admin('reconcile_balances',{operationId:'balance-reconcile:collision',targetBalance:-26,effectIds:[effect.id]}));assert.deepEqual(await c.read('balanceEvents',effect.id),effect);assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.root.collection('financialMaintenanceAudits').get()).size,0);
});
async function duplicate(c){await c.root.collection('clients').doc('qa-client').update({saldo:-2,financialVersion:14});for(const id of ['legitimate','duplicate'])await c.set('payments',id,{id,businessId:c.bid,spaceId:c.space,clienteId:'qa-client',valor:5,status:'applied',operationId:id});const e={id:'payment_received:duplicate',businessId:c.bid,spaceId:c.space,type:'payment_received',customerId:'qa-client',sourceDocumentId:'duplicate',sourceCollection:'payments',amount:5,balanceDelta:5,status:'applied'};await c.set('balanceEvents',e.id,e);return{operationId:'duplicate-payment-reversal:duplicate',legitimatePaymentId:'legitimate',duplicatePaymentId:'duplicate',reason:'Duplicação fictícia confirmada',expectedBalance:-2,expectedFinancialVersion:14,targetBalance:-7};}
test('duplicate reversal emits one compensation and never rewrites the original financial event',async()=>{const c=await setup(),intent=await duplicate(c),effect=await c.read('balanceEvents','payment_received:duplicate');await Promise.all([c.admin('reverse_duplicate_payment',intent),c.admin('reverse_duplicate_payment',intent)]);assert.deepEqual(await c.read('balanceEvents','payment_received:duplicate'),effect);assert.equal((await c.read('clients','qa-client')).saldo,-7);assert.equal((await c.read('payments','duplicate')).status,'reversed');assert.equal((await c.root.collection('balanceEvents').get()).size,2);});
test('duplicate reversal blocks allocations and changed canonical state atomically',async()=>{const c=await setup(),intent=await duplicate(c);await c.set('paymentAllocations','allocated',{paymentId:'duplicate',saleId:'a',amount:5});await assert.rejects(c.admin('reverse_duplicate_payment',intent));assert.equal((await c.read('clients','qa-client')).saldo,-2);assert.equal((await c.read('payments','duplicate')).status,'applied');});
test('legitimate unapplied payment conflict may be dismissed without rewriting an applied payment',async()=>{
 const c=await setup();await c.set('payments','conflict-id',{id:'conflict-id',operationId:'original-payment',businessId:c.bid,spaceId:c.space,clienteId:'qa-client',valor:5,status:'conflict',financialAppliedAt:null});const p={operationId:crypto.randomUUID(),businessId:c.bid,userId:c.seller,payload:{eventKind:'simple',writes:[{entityType:'payments',entityId:'conflict-id',operation:'update',before:await c.read('payments','conflict-id'),data:{status:'cancelled',applicationStatus:'not_applied',cancelledAt:new Date().toISOString(),resolutionOperationId:'payment-conflict-cancel:conflict-id'}}]}};await c.commit(p);await c.commit(p);assert.equal((await c.read('payments','conflict-id')).status,'cancelled');assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.root.collection('balanceEvents').get()).size,0);
 p.operationId=crypto.randomUUID();p.payload.writes[0].data.status='applied';await assert.rejects(c.commit(p));
});
test('real Fiados conflict/explicit confirmation works without sales.create; one true payment effect',async()=>{
 const c=await setup();vm.runInContext(fs.readFileSync('js/fiados.js','utf8'),c.h.c);
 await c.root.collection('members').doc(c.seller).update({permissions:{'customers.receiveDebt':true,'customers.view':true}});
 await c.root.collection('clients').doc('qa-client').update({saldo:0,financialVersion:13});
 const before=structuredClone(c.h.data()),first=c.h.c.Fiados.receber('qa-client',5,'Recebimento fictício',{spaceId:c.space});
 const original=c.packet(before,first.operationId,'payment'),outcome=await c.commit(original);assert.equal(outcome.outcome.status,'financial_conflict');assert.equal((await c.read('clients','qa-client')).saldo,0);assert.equal((await c.root.collection('balanceEvents').get()).size,0);
 c.h.data().clientes[0]=await c.read('clients','qa-client');c.h.data().pagamentos[0]=await c.read('payments',first.id);
 const next=structuredClone(c.h.data()),confirmed=c.h.c.Fiados.confirmarConflito(first.id),packet=c.packet(next,confirmed.operationId,'payment');
 await c.commit(packet);await c.commit(packet);assert.equal((await c.read('clients','qa-client')).saldo,5);assert.equal((await c.read('payments',first.id)).applicationStatus,'superseded_by_confirmation');assert.equal((await c.root.collection('balanceEvents').get()).size,1);assert.equal((await c.read('payments',confirmed.id)).status,'applied');
});

test('campaign create/update/close retain history and idempotence, seller cannot manage campaigns',async()=>{
 const c=await setup(),config=await campaign(c);await c.root.collection('campaigns').doc(config.id).delete();const create={businessId:c.bid,userId:c.owner,operationId:crypto.randomUUID(),payload:{eventKind:'simple',writes:[{entityType:'campaigns',entityId:config.id,operation:'create',data:config}]}};
 await c.commit(create);await c.commit(create);for(const status of ['paused','active','ended']){const before=await c.read('campaigns',config.id),p=structuredClone(create);p.operationId=crypto.randomUUID();p.payload.writes=[{entityType:'campaigns',entityId:config.id,operation:'update',before,data:{status,active:status!=='ended',updatedAt:new Date().toISOString()}}];await c.commit(p);}assert.equal((await c.read('campaigns',config.id)).status,'ended');const bad=structuredClone(create);bad.operationId=crypto.randomUUID();bad.userId=c.seller;await assert.rejects(c.commit(bad));
});
test('seller campaign earning/redemption works without inventory.adjust or financial access; stock once',async()=>{
 const c=await setup();await campaign(c);const {packet}=c.h.sell({status:'pago'});await c.commit(packet);assert.equal((await c.read('campaignProgress','qa-campaign__qa-client')).availableRewards,1);
 const before=structuredClone(c.h.data()),op=crypto.randomUUID();c.h.c.CampaignEngineV2.redeem(c.h.data(),'qa-campaign','qa-client','reward',{operationId:op,businessId:c.bid});const p=c.packet(before,op,'campaign_redemption');await c.commit(p);await c.commit(p);
 assert.equal((await c.read('products','qa-product')).estoqueAtual,1);assert.equal((await c.root.collection('campaignRedemptions').get()).size,1);assert.equal((await c.root.collection('stockMovements').get()).size,2);assert.equal((await c.read('clients','qa-client')).saldo,-12);await assertFails(sdk.getDocs(sdk.collection(env.authenticatedContext(c.seller).firestore(),c.root.path+'/balanceEvents')));
});
test('forged campaign progress/redemption never authorizes arbitrary stock or financial changes',async()=>{
 const c=await setup();await campaign(c);const before=structuredClone(c.h.data());c.h.data().progressosCampanha=[{id:'qa-campaign__qa-client',campaignId:'qa-campaign',clientId:'qa-client',businessId:c.bid,availableRewards:99,confirmedProgress:99}];await assert.rejects(c.commit(c.packet(before)));assert.equal((await c.root.collection('campaignProgress').get()).size,0);
});
test('campaign/renewal ledgers and projections cannot be forged directly, even by owner',async()=>{
 const c=await setup();for(const uid of [c.owner,c.seller])for(const col of ['campaigns','campaignEvents','campaignProgress','campaignRedemptions','customerSubscriptions','customerSubscriptionEvents'])await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(uid).firestore(),c.root.path+'/'+col+'/forged'),{id:'forged',businessId:c.bid,clientId:'qa-client',engineVersion:2,campaignId:'qa-campaign',availableRewards:99,spaceId:c.space}));
});
test('lost response, new service instance and retry retain the SAME sale, debit, movement and immutable receipt',async()=>{
 const c=await setup(),{packet}=c.h.sell(),original=JSON.stringify(packet);
 await assert.rejects((async()=>{await c.commit(packet);throw Object.assign(Error('Synthetic lost response'),{code:'unavailable'});})(),{code:'unavailable'});
 const first=await c.read('processedOperations',packet.operationId);const replay=await operationalCommitService(db).commit({auth:{uid:c.seller},data:{businessId:c.bid,item:packet}});assert.equal(replay.replayed,true);assert.deepEqual(await c.read('processedOperations',packet.operationId),first);assert.equal(JSON.stringify(packet),original);assert.equal((await c.root.collection('sales').get()).size,1);assert.equal((await c.root.collection('stockMovements').get()).size,1);assert.equal((await c.root.collection('balanceEvents').get()).size,1);
});
test('receipt is scoped, read-only and cannot acknowledge a sale from a different authorized space',async()=>{
 const c=await setup(),{sale,packet}=c.h.sell();await c.commit(packet);const request={auth:{uid:c.seller},data:{businessId:c.bid,spaceId:c.space,saleId:sale.id,operationId:sale.operationId}};assert.equal((await svc.receipt(request)).confirmed,true);await assert.rejects(svc.receipt({...request,data:{...request.data,spaceId:c.other}}));await c.root.collection('members').doc(c.seller).update({allowedSpaceIds:[c.other]});await assert.rejects(svc.receipt(request));assert.equal((await c.root.collection('processedOperations').get()).size,1);
});
test('campaign config preserves plan entitlements and rejects reward variants from another product',async()=>{
 const c=await setup(),config=await campaign(c);await c.root.collection('campaigns').doc(config.id).delete();await c.root.update({subscription:{planId:'essential',status:'active'}});const p={operationId:crypto.randomUUID(),businessId:c.bid,userId:c.owner,payload:{eventKind:'simple',writes:[{entityType:'campaigns',entityId:config.id,operation:'create',data:config}]}};await assert.rejects(c.commit(p),{code:'permission-denied'});await c.root.update({subscription:{planId:'internal',status:'active'}});await c.set('productVariants','foreign-variant',{parentProductId:'other-product'});p.payload.writes[0].data.rewards[0].variantId='foreign-variant';await assert.rejects(c.commit(p));assert.equal((await c.root.collection('campaigns').get()).size,0);
});
test('campaign Fiado stays pending; receipt settles allocation and confirmation exactly once',async()=>{
 const c=await setup();await campaign(c);Object.assign(c.h.c.SOURCES,{paymentAllocations:{key:'alocacoesPagamento'}});const {packet,sale}=c.h.sell();await c.commit(packet);const before=structuredClone(c.h.data()),data=c.h.data(),op=crypto.randomUUID(),payment={id:op,operationId:op,businessId:c.bid,spaceId:c.space,clienteId:'qa-client',valor:14,status:'applied',saldoAnterior:-26,saldoNovo:-12,expectedBalance:-26,expectedFinancialVersion:13,financialStateDependent:true,paymentMode:'partial',data:new Date().toISOString()};
 data.pagamentos.push(payment);data.clientes[0].saldo=-12;data.clientes[0].financialVersion=14;const allocations=c.h.c.CampaignEngineV2.allocatePayment(data,'qa-client',14,op,payment.data);c.h.c.CampaignEngineV2.confirmSettledSales(data,payment,allocations);const p=c.packet(before,op,'payment');await c.root.collection('members').doc(c.seller).update({permissions:{'customers.receiveDebt':true,'customers.view':true}});await c.commit(p);await c.commit(p);assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.read('sales',sale.id)).creditSettled,true);assert.equal((await c.read('campaignProgress','qa-campaign__qa-client')).availableRewards,1);
});
test('cancel-only permission reverses earned campaign effects, never grants campaign management',async()=>{
 const c=await setup();await campaign(c);const {packet,sale}=c.h.sell({status:'pago'});await c.commit(packet);await c.root.collection('members').doc(c.seller).update({permissions:{'sales.cancel':true}});const undo=c.h.undo(sale.id).packet;await c.commit(undo);await c.commit(undo);assert.equal((await c.read('campaignProgress','qa-campaign__qa-client')).availableRewards,0);assert.equal((await c.read('products','qa-product')).estoqueAtual,3);assert.equal((await c.root.collection('campaignEvents').get()).size,2);
});

test('recurring activation, renewal and manual close work with immutable transition events',async()=>{
 const c=await setup();domains(c);Object.assign(c.h.data().produtos[0],{productType:'recurring',itemKind:'service',durationValue:30,durationUnit:'days',renewalLabel:'Plano QA'});await c.set('products','qa-product',bridge(c.h.data().produtos[0]));const {packet}=c.h.sell({status:'pago'});await c.commit(packet);const sub=c.h.data().customerSubscriptions[0];assert.equal((await c.read('customerSubscriptions',sub.id)).status,'active');
 const before=structuredClone(c.h.data()),op=crypto.randomUUID(),sale=c.h.c.Vendas.registrar({operationId:op,businessId:c.bid,spaceId:c.space,clienteId:'qa-client',status:'pago',formaPagamento:'dinheiro',itens:[{produtoId:'qa-product',quantidade:1,precoFinalUnitario:14,precoOriginal:14,recurringActivation:{subscriptionId:sub.id,durationValue:30,durationUnit:'days'}}]});const renew=c.packet(before,op,'sale');assert.equal(sale.subscriptionUpdates[0].action,'renewal');await c.commit(renew);await c.commit(renew);assert.equal((await c.read('customerSubscriptions',sub.id)).renewalCount,1);
 const prior=structuredClone(c.h.data());c.h.c.CustomerSubscriptions.changeStatus(sub.id,'cancelled','Encerramento QA');const close=c.packet(prior);await c.commit(close);await c.commit(close);assert.equal((await c.read('customerSubscriptions',sub.id)).status,'cancelled');assert.equal((await c.root.collection('customerSubscriptionEvents').get()).size,3);
});
test('subscription cannot be created/extended without its legitimate sale or status transition',async()=>{
 const c=await setup();domains(c);const before=structuredClone(c.h.data());c.h.data().customerSubscriptions=[{id:'forged',businessId:c.bid,clientId:'qa-client',spaceId:c.space,productId:'qa-product',status:'active',expiresAt:'2099-01-01'}];await assert.rejects(c.commit(c.packet(before)));assert.equal((await c.root.collection('customerSubscriptions').get()).size,0);
});
test('legacy offline renewal keeps the original calculation and authorization without a policy marker', async () => {
 const c = await setup();
 domains(c);
 const product = Object.assign(c.h.data().produtos[0], { productType: 'recurring', itemKind: 'service', durationValue: 1, durationUnit: 'months' });
 await c.set('products', 'qa-product', bridge(product));
 await c.commit(c.h.sell({ status: 'pago' }).packet);
 const sub = c.h.data().customerSubscriptions[0];
 const legacy = { expiresAt: '2096-01-31T15:00:00.000Z', financialSpaceId: c.other };
 Object.assign(sub, legacy);
 await c.root.collection('customerSubscriptions').doc(sub.id).update(legacy);
 const before = structuredClone(c.h.data()), operationId = crypto.randomUUID();
 c.h.c.Vendas.registrar({ operationId, businessId: c.bid, spaceId: c.space, clienteId: 'qa-client', status: 'pago', formaPagamento: 'pix',
   itens: [{ produtoId: 'qa-product', quantidade: 1, precoFinalUnitario: 14, precoOriginal: 14, recurringActivation: {
     subscriptionId: sub.id, durationValue: 1, durationUnit: 'months',
   } }],
 });
 const packet = c.packet(before, operationId, 'sale');
 packet.payloadVersion = 4;
 await c.commit(packet);
 await c.commit(packet);
 const saved = await c.read('customerSubscriptions', sub.id);
 assert.equal(saved.expiresAt, '2096-03-02T15:00:00.000Z');
 assert.equal(saved.spaceId, c.space);
 assert.equal(saved.financialSpaceId, c.other);
 assert.equal(saved.renewalCalendarAnchor, undefined);
 assert.equal(saved.renewalCount, 1);
 assert.equal((await c.root.collection('sales').get()).size, 2);
 assert.equal((await c.root.collection('customerSubscriptionEvents').get()).size, 2);
});
test('versioned renewal persists the selected contract and calendar anchor once', async () => {
 const c = await setup();
 domains(c);
 const product = Object.assign(c.h.data().produtos[0], { productType: 'recurring', itemKind: 'service', durationValue: 1, durationUnit: 'months' });
 await c.set('products', 'qa-product', bridge(product));
 const { packet } = c.h.sell({ status: 'pago' });
 await c.commit(packet);
 const sub = c.h.data().customerSubscriptions[0];
 sub.expiresAt = '2096-01-31T15:00:00.000Z';
 await c.root.collection('customerSubscriptions').doc(sub.id).update({ expiresAt: sub.expiresAt });
 const other = { ...sub, id: 'qa-other-contract' };
 await c.set('customerSubscriptions', other.id, bridge(other));
 c.h.data().customerSubscriptions.push(other);
 const before = structuredClone(c.h.data()), operationId = crypto.randomUUID();
 const domain = c.h.c.CustomerSubscriptions;
 const sale = c.h.c.Vendas.registrar({ operationId, businessId: c.bid, spaceId: c.space, clienteId: 'qa-client', status: 'pago', formaPagamento: 'pix',
   itens: [{ produtoId: 'qa-product', quantidade: 1, precoFinalUnitario: 14, precoOriginal: 14, recurringActivation: {
     subscriptionId: sub.id, durationValue: 1, durationUnit: 'months', renewalPolicyVersion: domain.renewalPolicyVersion,
     expectedSubscription: domain.renewalSnapshot(sub),
   } }],
 });
 const renewal = c.packet(before, operationId, 'sale');
 const saleWrite = packet => packet.payload.writes.find(write => write.entityType === 'sales');
 const substituted = structuredClone(renewal);
 saleWrite(substituted).data.itens[0].recurringActivation.subscriptionId = other.id;
 await assert.rejects(c.commit(substituted), /identificador da vigência/);
 saleWrite(substituted).data.itens[0].subscriptionId = other.id;
 await assert.rejects(c.commit(substituted), /identificador da vigência/);
 const stripped = structuredClone(renewal);
 delete saleWrite(stripped).data.itens[0].recurringActivation.renewalPolicyVersion;
 await assert.rejects(c.commit(stripped), /Política de renovação inválida/);
 delete saleWrite(stripped).data.itens[0].recurringActivation.expectedSubscription;
 await assert.rejects(c.commit(stripped), /referência de vencimento exige/);
 const omitted = structuredClone(renewal);
 omitted.payload.writes = omitted.payload.writes.filter(write => !write.entityType.startsWith('customerSubscription'));
 await assert.rejects(c.commit(omitted), /gravação da vigência e do evento/);
 const storedRef = c.root.collection('customerSubscriptions').doc(sub.id);
 await storedRef.update({ spaceId: c.other });
 await assert.rejects(c.commit(renewal), /Espaço não autorizado/);
 await storedRef.update({ spaceId: null, financialSpaceId: c.space });
 await assert.rejects(c.commit(renewal), /Espaço inválido/);
 await storedRef.update({ spaceId: c.space, financialSpaceId: c.other });
 await assert.rejects(c.commit(renewal), /vigência mudou em outra sessão/i);
 await storedRef.update({ financialSpaceId: null });
 assert.equal((await c.root.collection('sales').get()).size, 1);
 await c.commit(renewal);
 await c.commit(renewal);
 const saved = await c.read('customerSubscriptions', sub.id);
 assert.equal(saved.spaceId, c.space);
 assert.equal(saved.expiresAt, '2096-02-29T15:00:00.000Z');
 assert.deepEqual(saved.renewalCalendarAnchor, { day: 31, expiresAt: saved.expiresAt });
 assert.equal(saved.renewalCount, 1);
 assert.equal((await c.read('customerSubscriptions', other.id)).expiresAt, '2096-01-31T15:00:00.000Z');
 assert.equal((await c.root.collection('customerSubscriptionEvents').get()).size, 2);
 assert.equal((await c.root.collection('sales').get()).size, 2);
 const cancellation = c.h.undo(sale.id);
 await c.commit(cancellation.packet);
 const restored = await c.read('customerSubscriptions', sub.id);
 assert.equal(restored.expiresAt, '2096-01-31T15:00:00.000Z');
 assert.equal(restored.renewalCalendarAnchor, null);
 assert.equal((await c.root.collection('customerSubscriptionEvents').get()).size, 3);
});
for(const mode of ['explicit','foreign','ambiguous'])test(`all_spaces initial stock origin captured before upload: ${mode}`,async()=>{
 // A restricted editor may not publish a new product to every space. The
 // positive path uses explicit all-space authorization, not a scope bypass.
 const c=await setup();await c.root.collection('members').doc(c.seller).update({permissions:{...c.permissions,'products.edit':true},...(mode==='explicit'?{spaceAccess:'all',allowedSpaceIds:[]}:{} )});const p={operationId:crypto.randomUUID(),businessId:c.bid,userId:c.seller,payload:{eventKind:'simple',writes:[{entityType:'products',entityId:'new',operation:'create',...(mode==='ambiguous'?{}:{initialStockSpaceId:mode==='foreign'?c.other:c.space}),data:{id:'new',businessId:c.bid,nome:'QA initial',spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,estoqueAtual:4,estoque:4,totalStock:4,active:true}}]}};
 if(mode==='explicit'){await c.commit(p);await c.commit(p);const moves=await c.root.collection('stockMovements').get();assert.equal(moves.size,1);assert.equal(moves.docs[0].data().spaceId,c.space);assert.equal(moves.docs[0].data().quantidade,4);}else{await assert.rejects(c.commit(p));assert.equal((await c.root.collection('products').doc('new').get()).exists,false);}
});
test('legacy orphan product recovery never invents an initial stock origin/movement',async()=>{
 const c=await setup(),p={operationId:crypto.randomUUID(),businessId:c.bid,userId:c.owner,source:'recovery_local_orphan',payload:{eventKind:'recovery_local_orphan',writes:[{entityType:'products',entityId:'old-product',operation:'create',data:{id:'old-product',businessId:c.bid,nome:'Histórico fictício',spaceAccessMode:'single_space',allowedSpaceIds:[c.space],defaultSpaceId:c.space,estoqueAtual:4,estoque:4,totalStock:4}}]}};
 await assert.rejects(c.commit(p),/nenhuma entrada inicial será inventada/);assert.equal((await c.root.collection('stockMovements').get()).size,0);assert.equal((await c.root.collection('products').doc('old-product').get()).exists,false);
});
