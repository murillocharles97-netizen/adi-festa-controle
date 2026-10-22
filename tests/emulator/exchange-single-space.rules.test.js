'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app');
const {getFirestore,FieldValue}=req('firebase-admin/firestore');
const {saleExchangeService}=require('../../functions/src/services/sale-exchange-service');
const {creditService}=require('../../functions/src/services/exchange-credit-service');
const {stockKey}=require('../../functions/src/services/online-stock-reservation');

const enabled=/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
const t=(name,fn)=>test(name,{skip:!enabled},fn);
let env,app,db,exchanges,credits,sequence=0;

test.before(async()=>{
  if(!enabled)return;
  const projectId='adi-festa-variations-test';
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  app=initializeApp({projectId},'exchange-single-space-test');
  db=getFirestore(app);exchanges=saleExchangeService(db);credits=creditService(db);
});
test.after(async()=>{if(enabled){await env.cleanup();await deleteApp(app);}});

async function setup({role='owner',price=50,stock=6,variable=false,seedCredit=false}={}){
  const bid=`single-${Date.now()}-${++sequence}`,space=`space-${bid}`,otherSpace=`other-${bid}`;
  const owner=`owner-${bid}`,seller=`seller-${bid}`,uid=role==='owner'?owner:seller,root=db.doc(`businesses/${bid}`);
  await root.set({ownerId:owner,active:true,workspaceGeneration:0,subscription:{status:'active',planId:'professional'}});
  for(const [id,memberRole]of [[owner,'owner'],[seller,'seller']]){
    await db.doc(`users/${id}`).set({uid:id,businessId:bid,active:true,role:memberRole});
    await root.collection('members').doc(id).set({uid:id,role:memberRole,status:'active',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'sales.view':true,'sales.create':true,'sales.cancel':true,'products.view':true,'customers.view':true,'financial.view':false}});
  }
  await db.doc(`financialSpaces/${space}`).set({id:space,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,type:'business',capabilities:{finance:false,sales:true}});
  await db.doc(`financialSpaces/${otherSpace}`).set({id:otherSpace,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,type:'business',capabilities:{finance:false,sales:true}});
  const canonical={businessId:bid,workspaceGeneration:0,active:true,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceId:space,spaceScopeVersion:1};
  await root.collection('products').doc('old').set({...canonical,id:'old',nome:'QA original',productType:'simple',estoqueAtual:0,estoque:0,totalStock:0,preco:80});
  await root.collection('products').doc('new').set({...canonical,id:'new',nome:'QA substituto',productType:variable?'variable':'simple',estoqueAtual:stock,estoque:stock,totalStock:stock,preco:price});
  if(variable)await root.collection('productVariants').doc('blue').set({id:'blue',businessId:bid,workspaceGeneration:0,spaceId:space,parentProductId:'new',active:true,stock,price,displayName:'Azul / M'});
  const sale={id:'original',businessId:bid,spaceId:space,workspaceGeneration:0,status:'pago',formaPagamento:'dinheiro',clienteId:'client',valorFinal:80,itens:[{produtoId:'old',nome:'QA original',quantidade:1,precoUnitario:80}]};
  await root.collection('sales').doc('original').set(sale);
  await root.collection('clients').doc('client').set({id:'client',businessId:bid,workspaceGeneration:0,spaceId:space,nome:'QA cliente',active:true,saldo:175});
  if(seedCredit)await root.collection('exchangeCredits').doc('seed-credit').set({id:'seed-credit',businessId:bid,spaceId:space,workspaceGeneration:0,clientId:'client',exchangeId:'seed-exchange',amountCents:5000,remainingCents:5000,status:'issued',createdAt:new Date('2026-01-01')});
  const auth={uid};
  const exchange={auth,data:{businessId:bid,workspaceGeneration:0,saleId:'original',reason:'QA single_space',returns:[{line:0,quantity:1,restock:true}],replacements:[{productId:'new',variantId:variable?'blue':null,quantity:1}],paymentMethod:'dinheiro'}};
  const credit={auth,data:{businessId:bid,spaceId:space,workspaceGeneration:0,clientId:'client',saleId:'credit-sale',operationId:'credit-consume',items:[{productId:'new',variantId:variable?'blue':null,quantity:1}],creditCents:1000,paymentMethod:'dinheiro'}};
  return {bid,space,otherSpace,owner,seller,uid,root,sale,exchange,credit,variable};
}

const docs=async(c,name)=>(await c.root.collection(name).get()).docs.map(s=>({id:s.id,...s.data()}));
const product=async(c,id='new')=>(await c.root.collection('products').doc(id).get()).data();
const available=async c=>(await credits.available(c.credit)).availableCents;
async function quotedExchange(c,id='exchange-one'){
  const q=await exchanges.quote(c.exchange);
  return {...c.exchange,data:{...c.exchange.data,operationId:id,fingerprint:q.fingerprint}};
}
async function quotedCredit(c){
  const q=await credits.quote(c.credit);
  return {...c.credit,data:{...c.credit.data,fingerprint:q.fingerprint}};
}
async function snapshot(c){
  const names=['sales','products','productVariants','stockMovements','saleExchanges','saleExchangeMetrics','saleExchangeSummaries','exchangeCredits','exchangeCreditEvents','processedOperations','syncMetadata','clients','payments','balanceEvents','onlineStockReservations'];
  const result={};for(const name of names)result[name]=await docs(c,name);
  result.financialEntries=(await db.collection(`financialSpaces/${c.space}/entries`).get()).docs.map(s=>({id:s.id,...s.data()}));
  return result;
}
async function noDebtEffects(c){
  assert.equal((await c.root.collection('clients').doc('client').get()).data().saldo,175);
  assert.equal((await docs(c,'payments')).length,0);
  assert.equal((await docs(c,'balanceEvents')).length,0);
  assert.equal((await db.collection(`financialSpaces/${c.space}/entries`).get()).size,0);
}
async function reserve(c,quantity){
  const row={productId:'new',variantId:c.variable?'blue':null};
  const ref=c.root.collection(c.variable?'productVariants':'products').doc(c.variable?'blue':'new');
  await ref.update({onlineReservedStock:quantity});
  await c.root.collection('onlineStockReservations').doc(stockKey(row)).set({businessId:c.bid,spaceId:c.space,workspaceGeneration:0,quantity});
}

for(const role of ['owner','seller']){
  t(`single_space ${role}: troca igual preserva venda original e gera dois movimentos no espaço canônico`,async()=>{
    const c=await setup({role,price:80}),request=await quotedExchange(c);
    await exchanges.confirm(request);
    assert.deepEqual((await c.root.collection('sales').doc('original').get()).data(),c.sale);
    assert.equal((await product(c,'old')).estoqueAtual,1);
    assert.equal((await product(c)).estoqueAtual,5);
    assert.equal((await docs(c,'saleExchanges')).length,1);
    assert.equal((await docs(c,'exchangeCredits')).length,0);
    const movements=await docs(c,'stockMovements');assert.equal(movements.length,2);
    assert.ok(movements.every(m=>m.businessId===c.bid&&m.spaceId===c.space&&m.actorUid===c.uid));
    await noDebtEffects(c);
  });

  t(`single_space ${role}: emissão, consumo parcial e cancelamento restauram crédito e estoque uma única vez`,async()=>{
    const c=await setup({role}),exchange=await quotedExchange(c);
    await exchanges.confirm(exchange);assert.equal((await exchanges.confirm(JSON.parse(JSON.stringify(exchange)))).replayed,true);
    assert.equal(await available(c),3000);
    const buy=await quotedCredit(c);await credits.confirm(buy);
    assert.equal((await credits.confirm(JSON.parse(JSON.stringify(buy)))).replayed,true);
    assert.equal((await credits.status(buy)).committed,true);
    assert.equal(await available(c),2000);assert.equal((await product(c)).estoqueAtual,4);
    const sale=(await c.root.collection('sales').doc('credit-sale').get()).data();
    assert.equal(sale.exchangeCreditUsedCents,1000);assert.equal(sale.cashReceivedCents,4000);assert.equal(sale.actorUid,c.uid);
    const cancel={auth:c.credit.auth,data:{...c.credit.data,operationId:'credit-cancel'}};
    await credits.cancel(cancel);assert.equal((await credits.cancel(JSON.parse(JSON.stringify(cancel)))).replayed,true);
    assert.equal(await available(c),3000);assert.equal((await product(c)).estoqueAtual,5);
    assert.equal((await product(c,'old')).estoqueAtual,1);
    assert.equal((await docs(c,'sales')).length,2);
    assert.equal((await docs(c,'saleExchanges')).length,1);
    assert.equal((await docs(c,'stockMovements')).length,4);
    assert.deepEqual((await docs(c,'exchangeCreditEvents')).map(e=>e.kind).sort(),['consumed','issued','restored']);
    assert.deepEqual((await c.root.collection('sales').doc('original').get()).data(),c.sale);
    assert.equal((await c.root.collection('members').doc(c.seller).get()).data().permissions['financial.view'],false);
    await noDebtEffects(c);
  });
}

const invalidLinks=[
  ['vínculo canônico de outro espaço',c=>({defaultSpaceId:c.otherSpace,allowedSpaceIds:[c.otherSpace],spaceId:c.otherSpace})],
  ['defaultSpaceId aponta para outro espaço',c=>({defaultSpaceId:c.otherSpace})],
  ['allowedSpaceIds aponta para outro espaço',c=>({allowedSpaceIds:[c.otherSpace]})],
  ['allowedSpaceIds contém dois espaços',c=>({allowedSpaceIds:[c.space,c.otherSpace]})],
  ['allowedSpaceIds contém vínculo duplicado',c=>({allowedSpaceIds:[c.space,c.space]})],
  ['allowedSpaceIds vazio',()=>({allowedSpaceIds:[]})],
  ['spaceId direto conflitante',c=>({spaceId:c.otherSpace})],
  ['defaultSpaceId ausente',()=>({defaultSpaceId:FieldValue.delete()})],
  ['allowedSpaceIds ausente',()=>({allowedSpaceIds:FieldValue.delete()})],
  ['legacy sem spaceAccessMode',()=>({spaceAccessMode:FieldValue.delete()})],
  ['modo desconhecido',()=>({spaceAccessMode:'unknown_legacy'})],
  ['empresa conflitante',()=>({businessId:'another-business'})],
  ['geração conflitante',()=>({workspaceGeneration:1})],
];

for(const [label,patch]of invalidLinks){
  for(const flow of ['troca','consumo']){
    t(`single_space inválido: ${label} bloqueia ${flow} sem qualquer gravação`,async()=>{
      const c=await setup({role:'seller',seedCredit:flow==='consumo'});
      await c.root.collection('products').doc('new').update(patch(c));
      const before=await snapshot(c);
      await assert.rejects(flow==='troca'?exchanges.quote(c.exchange):credits.quote(c.credit),error=>error.code==='permission-denied');
      assert.deepEqual(await snapshot(c),before);
    });
  }
}

for(const role of ['owner','seller']){
  for(const flow of ['troca','consumo']){
    t(`single_space ${role}: vínculo alterado após cotação impede commit de ${flow} sem efeitos parciais`,async()=>{
      const c=await setup({role,seedCredit:flow==='consumo'});
      const request=flow==='troca'?await quotedExchange(c):await quotedCredit(c);
      await c.root.collection('products').doc('new').update({defaultSpaceId:c.otherSpace,allowedSpaceIds:[c.otherSpace],spaceId:c.otherSpace});
      const before=await snapshot(c);
      await assert.rejects(flow==='troca'?exchanges.confirm(request):credits.confirm(request),error=>error.code==='permission-denied');
      assert.deepEqual(await snapshot(c),before);
    });
  }
}

t('single_space canônico sem spaceId redundante continua aceito nos dois serviços',async()=>{
  const c=await setup();
  await c.root.collection('products').doc('old').update({spaceId:FieldValue.delete()});
  await c.root.collection('products').doc('new').update({spaceId:FieldValue.delete()});
  await exchanges.confirm(await quotedExchange(c));await credits.confirm(await quotedCredit(c));
  assert.equal(await available(c),2000);assert.equal((await product(c)).estoqueAtual,4);
});

t('owner também não pode contornar vínculo single_space de outro espaço',async()=>{
  const c=await setup({seedCredit:true});
  await c.root.collection('products').doc('new').update({defaultSpaceId:c.otherSpace,allowedSpaceIds:[c.otherSpace],spaceId:c.otherSpace});
  const before=await snapshot(c);
  await assert.rejects(exchanges.quote(c.exchange),error=>error.code==='permission-denied');
  await assert.rejects(credits.quote(c.credit),error=>error.code==='permission-denied');
  assert.deepEqual(await snapshot(c),before);
});

t('item devolvido single_space em outro espaço impede emissão de crédito sem efeitos',async()=>{
  const c=await setup();
  await c.root.collection('products').doc('old').update({defaultSpaceId:c.otherSpace,allowedSpaceIds:[c.otherSpace],spaceId:c.otherSpace});
  const before=await snapshot(c);await assert.rejects(exchanges.quote(c.exchange),error=>error.code==='permission-denied');
  assert.deepEqual(await snapshot(c),before);
});

t('seller restrito a outro espaço continua bloqueado nos dois serviços',async()=>{
  const c=await setup({role:'seller',seedCredit:true});
  await c.root.collection('members').doc(c.seller).update({allowedSpaceIds:[c.otherSpace]});
  const before=await snapshot(c);
  await assert.rejects(exchanges.quote(c.exchange),error=>error.code==='permission-denied');
  await assert.rejects(credits.quote(c.credit),error=>error.code==='permission-denied');
  assert.deepEqual(await snapshot(c),before);
});

t('single_space com variação e reserva: baixa apenas a variação, preserva reserva e restaura no cancelamento',async()=>{
  const c=await setup({role:'seller',variable:true,stock:4});await reserve(c,2);
  await exchanges.confirm(await quotedExchange(c));await credits.confirm(await quotedCredit(c));
  assert.equal((await c.root.collection('productVariants').doc('blue').get()).data().stock,2);
  assert.equal((await product(c)).totalStock,2);
  const reservation=c.root.collection('onlineStockReservations').doc(stockKey({productId:'new',variantId:'blue'}));
  assert.equal((await reservation.get()).data().quantity,2);
  await credits.cancel({auth:c.credit.auth,data:{...c.credit.data,operationId:'cancel-variant'}});
  assert.equal((await c.root.collection('productVariants').doc('blue').get()).data().stock,3);
  assert.equal((await product(c)).totalStock,3);assert.equal((await reservation.get()).data().quantity,2);
  assert.ok((await docs(c,'stockMovements')).filter(m=>m.produtoId==='new').every(m=>m.variantId==='blue'));
  await noDebtEffects(c);
});

for(const flow of ['troca','consumo']){
  t(`single_space: estoque reservado impede ${flow}, sem consumir crédito ou alterar a reserva`,async()=>{
    const c=await setup({stock:2,seedCredit:flow==='consumo'});await reserve(c,2);
    const before=await snapshot(c);
    await assert.rejects(flow==='troca'?exchanges.quote(c.exchange):credits.quote(c.credit),/insuficiente/);
    assert.deepEqual(await snapshot(c),before);
  });
}

t('single_space: item devolvido avariado não retorna ao disponível',async()=>{
  const c=await setup();c.exchange.data.returns[0].restock=false;
  await exchanges.confirm(await quotedExchange(c));
  assert.equal((await product(c,'old')).estoqueAtual,0);
  assert.equal((await product(c)).estoqueAtual,5);
  assert.equal((await docs(c,'stockMovements')).length,1);
  assert.equal(await available(c),3000);await noDebtEffects(c);
});

t('single_space: confirmação concorrente e replay preservam um evento e seus movimentos originais',async()=>{
  const c=await setup(),request=await quotedExchange(c);
  const attempts=await Promise.allSettled([exchanges.confirm(request),exchanges.confirm(request)]);
  assert.ok(attempts.some(r=>r.status==='fulfilled'));
  const before=await snapshot(c);
  assert.equal((await exchanges.confirm(JSON.parse(JSON.stringify(request)))).replayed,true);
  assert.deepEqual(await snapshot(c),before);
  assert.equal((await docs(c,'saleExchanges')).length,1);
  assert.equal((await docs(c,'stockMovements')).length,2);
  assert.equal((await docs(c,'exchangeCredits')).length,1);
  assert.equal((await docs(c,'processedOperations')).length,1);
});

t('single_space: dois consumos concorrentes com cotação antiga não gastam crédito duas vezes',async()=>{
  const c=await setup({seedCredit:true});c.credit.data.creditCents=3000;
  const q=await credits.quote(c.credit);
  const attempts=await Promise.allSettled(['one','two'].map(id=>credits.confirm({auth:c.credit.auth,data:{...c.credit.data,saleId:`sale-${id}`,operationId:`consume-${id}`,fingerprint:q.fingerprint}})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await available(c),2000);assert.equal((await product(c)).estoqueAtual,5);
  assert.equal((await docs(c,'stockMovements')).length,1);
  assert.equal((await docs(c,'sales')).length,2);await noDebtEffects(c);
});

t('single_space: Fiado original e complemento Fiado continuam bloqueados sem gravações',async()=>{
  const c=await setup({seedCredit:true});
  await c.root.collection('sales').doc('original').update({formaPagamento:'fiado',status:'fiado'});
  let before=await snapshot(c);await assert.rejects(exchanges.quote(c.exchange),/Fiado/);assert.deepEqual(await snapshot(c),before);
  c.credit.data.paymentMethod='fiado';before=await snapshot(c);
  await assert.rejects(credits.quote(c.credit),/Fiado/);assert.deepEqual(await snapshot(c),before);
  await noDebtEffects(c);
});
