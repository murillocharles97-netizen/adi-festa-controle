'use strict';

// QA only: load the immutable release candidate to seed committed/preserved
// operations, then exercise the containment services against those same IDs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createRequire,wrap}=require('node:module');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const root=path.resolve(__dirname,'../..'),candidate='c1f8b08bb141ba5feb9c4b2b6288fb6db4fd0293';
const requireFunctions=createRequire(path.join(root,'functions/package.json'));
const {initializeApp,deleteApp}=requireFunctions('firebase-admin/app'),{getFirestore}=requireFunctions('firebase-admin/firestore');
const {saleExchangeService}=require('../../functions/src/services/sale-exchange-service');
const {creditService}=require('../../functions/src/services/exchange-credit-service');
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');
const originalSource=file=>execFileSync('git',['-c','core.bare=false','show',`${candidate}:${file}`],{cwd:root,encoding:'utf8'});
function originalModule(file){
  const filename=path.join(root,file),module={exports:{}};
  const load=vm.runInThisContext(wrap(originalSource(file)),{filename:`${filename} [immutable V194]`});
  load(module.exports,createRequire(filename),module,filename,path.dirname(filename));
  return module.exports;
}
const originalExchangeFactory=originalModule('functions/src/services/sale-exchange-service.js').saleExchangeService;
const originalCreditFactory=originalModule('functions/src/services/exchange-credit-service.js').creditService;
const enabled=/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
const t=(name,fn)=>test(name,{skip:!enabled},fn);
let env,app,db,exchanges,credits,originalExchanges,originalCredits,serial=0;
test.before(async()=>{
  if(!enabled)return;
  env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync(path.join(root,'firestore.rules'),'utf8')}});
  app=initializeApp({projectId:'adi-festa-variations-test'},'compatible-exchange-rollback');db=getFirestore(app);
  exchanges=saleExchangeService(db);credits=creditService(db);originalExchanges=originalExchangeFactory(db);originalCredits=originalCreditFactory(db);
});
test.after(async()=>{if(enabled){await env.cleanup();await deleteApp(app);}});

async function setup({seller=false}={}){
  const bid=`rollback-ex-${Date.now()}-${++serial}`,spaceId=`space-${bid}`,owner=`owner-${bid}`,sellerUid=`seller-${bid}`,uid=seller?sellerUid:owner;
  const business=db.doc(`businesses/${bid}`);
  await business.set({ownerId:owner,active:true,workspaceGeneration:0,subscription:{status:'active',planId:'professional'}});
  for(const [id,role]of [[owner,'owner'],[sellerUid,'seller']]){
    await db.doc(`users/${id}`).set({uid:id,businessId:bid,active:true,role});
    await business.collection('members').doc(id).set({uid:id,role,status:'active',spaceAccess:'selected',allowedSpaceIds:[spaceId],permissions:{'sales.view':true,'sales.create':true,'sales.cancel':true,'customers.view':true,'products.view':true,'finance.view':false}});
  }
  await db.doc(`financialSpaces/${spaceId}`).set({id:spaceId,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,type:'business',capabilities:{finance:true,sales:true},automation:{enabled:true,activatedAt:'2020-01-01T00:00:00Z',defaultIncomeFinancialAccountId:'cash',autoIncome:{sales:true}}});
  await db.doc(`financialSpaces/${spaceId}/financialAccounts/cash`).set({ownerUid:owner,active:true,accessMode:'single_space',defaultFinancialSpaceId:spaceId,currentBalanceCents:0});
  await business.collection('clients').doc('client-one').set({id:'client-one',businessId:bid,spaceId,workspaceGeneration:0,nome:'QA rollback',active:true,saldo:175});
  for(const [id,stock,price]of [['original-item',0,80],['replacement-item',20,50],['future-item',20,30]])await business.collection('products').doc(id).set({id,businessId:bid,nome:`QA ${id}`,active:true,productType:'simple',estoqueAtual:stock,estoque:stock,totalStock:stock,preco:price,spaceAccessMode:'selected_spaces',allowedSpaceIds:[spaceId]});
  await business.collection('sales').doc('original-sale').set({id:'original-sale',businessId:bid,spaceId,workspaceGeneration:0,status:'pago',formaPagamento:'dinheiro',clienteId:'client-one',valorFinal:80,itens:[{produtoId:'original-item',nome:'QA original',quantidade:1,precoUnitario:80}]});
  const auth={uid},scope={businessId:bid,spaceId,workspaceGeneration:0,clientId:'client-one'};
  const quote={auth,data:{businessId:bid,workspaceGeneration:0,saleId:'original-sale',reason:'QA rollback',returns:[{line:0,quantity:1,restock:true}],replacements:[{productId:'replacement-item',quantity:1}],paymentMethod:'dinheiro'}};
  const plan=await originalExchanges.quote(quote),exchangeRequest={auth,data:{...quote.data,operationId:'original-exchange',fingerprint:plan.fingerprint}};
  return {bid,spaceId,owner,sellerUid,uid,business,auth,scope,exchangeRequest};
}
async function snapshot(c){
  const rows=[];
  async function walk(ref){
    const row=await ref.get();
    if(row.exists)rows.push({path:ref.path,data:row.data(),updatedAt:row.updateTime.toDate().toISOString(),seconds:row.updateTime.seconds,nanoseconds:row.updateTime.nanoseconds});
    for(const collection of await ref.listCollections())for(const child of await collection.listDocuments())await walk(child);
  }
  await walk(c.business);await walk(db.doc(`financialSpaces/${c.spaceId}`));
  await walk(db.doc(`users/${c.owner}`));await walk(db.doc(`users/${c.sellerUid}`));
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
async function seedExchange(c){await originalExchanges.confirm(c.exchangeRequest);}
async function creditRequest(c){
  const request={auth:c.auth,data:{...c.scope,saleId:'future-sale',operationId:'future-sale-operation',items:[{productId:'future-item',quantity:1}],creditCents:1000,paymentMethod:'dinheiro'}};
  const quote=await originalCredits.quote(request);request.data.fingerprint=quote.fingerprint;return request;
}
const paused=error=>error.code==='failed-precondition'&&error.details?.reason==='exchange_new_commits_paused';

test('containment preserves candidate Rules and canonical financial/reset helpers byte-for-byte',()=>{
  for(const file of ['firestore.rules','functions/src/services/financial-income-service.js','functions/src/services/workspace-reset-policy.js'])assert.equal(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n'),originalSource(file).replace(/\r\n/g,'\n'),file);
});
t('new or preserved exchange cannot commit in containment: owner and seller, zero writes and no request override',async()=>{
  for(const seller of [false,true]){
    const c=await setup({seller}),before=await snapshot(c);
    await assert.rejects(exchanges.confirm({...c.exchangeRequest,data:{...c.exchangeRequest.data,newCommitsEnabled:true,rollbackOverride:true}}),paused);
    assert.deepEqual(await snapshot(c),before);
    const lookup=await exchanges.lookup(c.exchangeRequest);assert.equal(lookup.found,false);
    assert.deepEqual(await snapshot(c),before);
  }
});
t('new or preserved credit sale cannot commit: original IDs/credit remain intact, owner and seller',async()=>{
  for(const seller of [false,true]){
    const c=await setup({seller});await seedExchange(c);const request=await creditRequest(c),before=await snapshot(c);
    await assert.rejects(credits.confirm({...request,data:{...request.data,newCommitsEnabled:true,rollbackOverride:true}}),paused);
    assert.equal((await credits.status(request)).committed,false);
    assert.equal((await credits.available({auth:c.auth,data:c.scope})).availableCents,3000);
    assert.deepEqual(await snapshot(c),before);
  }
});
t('committed exchange replay, lookup, history and economics are read-only and still authorized',async()=>{
  const c=await setup({seller:true});await seedExchange(c);const before=await snapshot(c);
  for(let i=0;i<2;i++)assert.equal((await exchanges.confirm(JSON.parse(JSON.stringify(c.exchangeRequest)))).replayed,true);
  assert.equal((await exchanges.lookup(c.exchangeRequest)).found,true);
  assert.equal((await exchanges.list(c.exchangeRequest)).items.length,1);
  assert.equal((await exchanges.adjustments({auth:c.auth,data:c.scope})).items[0].differenceCents,-3000);
  await assert.rejects(exchanges.confirm({...c.exchangeRequest,data:{...c.exchangeRequest.data,reason:'different content'}}),error=>error.code==='already-exists');
  assert.deepEqual(await snapshot(c),before);
});
t('committed credit sale replay/status/ledger remain read-only; another actor cannot claim its receipt',async()=>{
  const c=await setup();await seedExchange(c);const request=await creditRequest(c);await originalCredits.confirm(request);const before=await snapshot(c);
  for(let i=0;i<2;i++)assert.equal((await credits.confirm(JSON.parse(JSON.stringify(request)))).replayed,true);
  assert.equal((await credits.status(request)).committed,true);
  assert.equal((await credits.available({auth:c.auth,data:c.scope})).availableCents,2000);
  await assert.rejects(credits.confirm({...request,auth:{uid:c.sellerUid}}),error=>error.code==='already-exists');
  assert.deepEqual(await snapshot(c),before);
});
t('specific cancellation stays active, restores credit/stock once and reverses only R$20, not Fiado',async()=>{
  const c=await setup({seller:true});await seedExchange(c);const request=await creditRequest(c);await originalCredits.confirm(request);
  const saleRef=c.business.collection('sales').doc('future-sale'),sale=(await saleRef.get()).data(),finance=financialIncomeService(db);
  await finance.projectSale(c.bid,sale.id,sale);
  const cancel={auth:c.auth,data:{...c.scope,saleId:sale.id,operationId:'future-sale-cancel'}};
  assert.equal((await credits.cancel(cancel)).replayed,false);
  const cancelled=(await saleRef.get()).data();await finance.projectSale(c.bid,cancelled.id,cancelled,{before:sale});
  const beforeReplay=await snapshot(c);assert.equal((await credits.cancel(cancel)).replayed,true);assert.deepEqual(await snapshot(c),beforeReplay);
  assert.equal((await credits.available({auth:c.auth,data:c.scope})).availableCents,3000);
  assert.equal((await c.business.collection('products').doc('future-item').get()).data().estoqueAtual,20);
  assert.equal((await c.business.collection('sales').get()).size,2);
  assert.equal((await c.business.collection('stockMovements').where('vendaId','==',sale.id).get()).size,2);
  assert.equal((await c.business.collection('clients').doc('client-one').get()).data().saldo,175);
  for(const collection of ['payments','balanceEvents','balanceAdjustments'])assert.equal((await c.business.collection(collection).get()).size,0);
  const entries=(await db.collection(`financialSpaces/${c.spaceId}/entries`).get()).docs.map(doc=>doc.data());
  assert.equal(entries.length,2);assert.ok(entries.every(entry=>entry.amountCents===2000));
  assert.equal(entries.filter(entry=>entry.direction==='out').length,1);
  assert.equal((await db.doc(`financialSpaces/${c.spaceId}/financialAccounts/cash`).get()).data().currentBalanceCents,0);
});
