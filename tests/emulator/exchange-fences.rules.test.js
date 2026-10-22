'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore');
const enabled=/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
const t=(name,run)=>test(name,{skip:!enabled},run);
const bid='qa-exchange-fences',space='qa-exchange-fences-space',other='qa-exchange-fences-other',owner='qa-exchange-fences-owner',seller='qa-exchange-fences-seller';
const path=(collection,id)=>['businesses',bid,collection,id];
let env;
const sale=(id,actorUid)=>({id,businessId:bid,spaceId:space,financialSpaceId:space,actorUid,operationId:`operation-${id}`,status:'pago',formaPagamento:'dinheiro',valorFinal:30,valorTotal:30,itens:[{produtoId:'product-one',nome:'QA produto',quantidade:3,precoFinalUnitario:10}],data:'2026-10-21T12:00:00.000Z',createdAt:new Date('2026-10-21T12:00:00Z'),updatedAt:new Date('2026-10-21T12:00:00Z')});
const dbFor=uid=>env.authenticatedContext(uid).firestore();
test.before(async()=>{
  if(!enabled)return;
  env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await sdk.setDoc(sdk.doc(db,'businesses',bid),{ownerId:owner,active:true,workspaceGeneration:0,subscription:{planId:'professional',status:'active'}});
    for(const [uid,role]of [[owner,'owner'],[seller,'cashier']]){
      await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role,active:true});
      await sdk.setDoc(sdk.doc(db,...path('members',uid)),{uid,role,status:'active',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:[space],permissions:{'sales.create':true,'sales.cancel':true,'sales.viewAll':false,'customers.view':true,'products.view':true,'inventory.view':true,'financial.view':false,'cost.view':false,'profit.view':false}});
    }
    for(const id of [space,other])await sdk.setDoc(sdk.doc(db,'financialSpaces',id),{id,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:true,type:'business',capabilities:{sales:true,products:true,inventory:true,finance:false}});
    await sdk.setDoc(sdk.doc(db,...path('products','product-one')),{id:'product-one',businessId:bid,nome:'QA produto',preco:10,active:true,estoqueAtual:20,estoque:20,spaceAccessMode:'selected_spaces',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1});
    for(const [id,uid]of [['normal-owner',owner],['normal-seller',seller],['normal-owner-cancels-seller',seller],['exchanged-owner',owner],['exchanged-seller',seller]])await sdk.setDoc(sdk.doc(db,...path('sales',id)),sale(id,uid));
    for(const id of ['exchanged-owner','exchanged-seller'])await sdk.setDoc(sdk.doc(db,...path('saleExchangeSummaries',id)),{businessId:bid,spaceId:space,returned:{0:1},count:1});
    await sdk.setDoc(sdk.doc(db,...path('sales','credit-funded')),{...sale('credit-funded',seller),source:'exchange_credit_checkout',exchangeCreditUsedCents:1000,cashReceivedCents:2000,exchangeCreditRequestHash:'sha256-test',exchangeCreditAllocations:[{creditId:'credit-one',amountCents:1000}]});
    for(const [id,source,extra]of [['exchange-movement','sale_exchange',{exchangeId:'exchange-one'}],['credit-movement','exchange_credit_checkout',{}],['ordinary-movement','manual',{}],['private-inline','manual',{custoUnitario:3}],['foreign-movement','exchange_credit_checkout',{spaceId:other}]])await sdk.setDoc(sdk.doc(db,...path('stockMovements',id)),{id,businessId:bid,spaceId:space,operationId:`operation-${id}`,actorUid:seller,produtoId:'product-one',vendaId:'credit-funded',source,tipo:'saida_venda',quantidade:-1,estoqueAnterior:20,estoqueNovo:19,...extra});
    await sdk.setDoc(sdk.doc(db,...path('stockMovementFinancials','credit-movement')),{businessId:bid,stockMovementId:'credit-movement',custoUnitario:3});
  });
});
test.after(async()=>{if(enabled)await env.cleanup();});

t('nem owner nem seller podem forjar source de venda financiada por crédito',async()=>{for(const uid of [owner,seller]){const db=dbFor(uid);await assertFails(sdk.setDoc(sdk.doc(db,...path('sales',`forged-source-${uid}`)),{...sale(`forged-source-${uid}`,uid),source:'exchange_credit_checkout'}));}});
t('cada campo reservado de crédito é vedado isoladamente, inclusive valor zero',async()=>{const values={exchangeCreditUsedCents:0,cashReceivedCents:0,exchangeCreditAllocations:[],exchangeCreditRequestHash:'hash',exchangeCreditRestoredCents:0};for(const uid of [owner,seller])for(const [field,value]of Object.entries(values)){const id=`forged-${field}-${uid}`;await assertFails(sdk.setDoc(sdk.doc(dbFor(uid),...path('sales',id)),{...sale(id,uid),[field]:value}));}});
t('venda com crédito não admite cancelamento direto, mudança do total ou retirada dos marcadores',async()=>{for(const uid of [owner,seller]){const ref=sdk.doc(dbFor(uid),...path('sales','credit-funded'));await assertFails(sdk.updateDoc(ref,{status:'cancelado'}));await assertFails(sdk.updateDoc(ref,{valorFinal:1}));await assertFails(sdk.updateDoc(ref,{source:'manual',exchangeCreditUsedCents:sdk.deleteField(),cashReceivedCents:sdk.deleteField(),exchangeCreditAllocations:sdk.deleteField(),exchangeCreditRequestHash:sdk.deleteField()}));await assertFails(sdk.deleteDoc(ref));}});
t('cancelamento manual normal do owner continua autorizado',async()=>{const ref=sdk.doc(dbFor(owner),...path('sales','normal-owner'));await assertSucceeds(sdk.updateDoc(ref,{status:'cancelado',reversedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),cancelOperationId:'cancel-owner-normal'}));assert.equal((await sdk.getDoc(ref)).data().status,'cancelado');});
t('cancelamento manual normal do seller autorizado preserva autoria',async()=>{const ref=sdk.doc(dbFor(seller),...path('sales','normal-seller'));await assertSucceeds(sdk.updateDoc(ref,{status:'cancelado',reversedAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),cancelOperationId:'cancel-seller-normal'}));assert.equal((await sdk.getDoc(ref)).data().actorUid,seller);});
t('owner cancela venda manual do seller sem trocar ator original',async()=>{const ref=sdk.doc(dbFor(owner),...path('sales','normal-owner-cancels-seller'));await assertSucceeds(sdk.updateDoc(ref,{status:'cancelado',updatedByUid:owner,cancelOperationId:'cancel-seller-by-owner'}));assert.equal((await sdk.getDoc(ref)).data().actorUid,seller);});
t('venda já trocada permanece imutável e indeletável para owner e seller',async()=>{for(const uid of [owner,seller])for(const id of ['exchanged-owner','exchanged-seller']){const ref=sdk.doc(dbFor(uid),...path('sales',id));await assertFails(sdk.updateDoc(ref,{status:'cancelado'}));await assertFails(sdk.updateDoc(ref,{valorFinal:1}));await assertFails(sdk.deleteDoc(ref));}});
t('movimentos operacionais canônicos são legíveis sem custo no espaço permitido',async()=>{const db=dbFor(seller);for(const id of ['exchange-movement','credit-movement']){const snapshot=await assertSucceeds(sdk.getDoc(sdk.doc(db,...path('stockMovements',id))));const value=snapshot.data();assert.equal(value.spaceId,space);assert.equal(value.custoUnitario,undefined);assert.equal(value.costUnit,undefined);}await assertFails(sdk.getDoc(sdk.doc(db,...path('stockMovementFinancials','credit-movement'))));await assertFails(sdk.getDoc(sdk.doc(db,...path('stockMovements','private-inline'))));await assertFails(sdk.getDoc(sdk.doc(db,...path('stockMovements','foreign-movement'))));});
t('movimentos gerenciados pelo servidor não admitem forja ou alteração direta',async()=>{for(const uid of [owner,seller]){const db=dbFor(uid);for(const id of ['exchange-movement','credit-movement'])await assertFails(sdk.updateDoc(sdk.doc(db,...path('stockMovements',id)),{quantidade:-9,estoqueNovo:11}));for(const source of ['sale_exchange','exchange_credit_checkout'])await assertFails(sdk.setDoc(sdk.doc(db,...path('stockMovements',`forged-${source}-${uid}`)),{id:`forged-${source}-${uid}`,businessId:bid,spaceId:space,actorUid:uid,operationId:`forged-operation-${uid}`,produtoId:'product-one',tipo:'saida_venda',quantidade:-1,estoqueAnterior:20,estoqueNovo:19,source}));}});
t('movimento manual comum continua gravável com autorização atual',async()=>{const db=dbFor(seller),id='ordinary-new';await assertSucceeds(sdk.setDoc(sdk.doc(db,...path('stockMovements',id)),{id,businessId:bid,spaceId:space,actorUid:seller,operationId:'ordinary-new-operation',produtoId:'product-one',tipo:'saida_venda',quantidade:-1,estoqueAnterior:20,estoqueNovo:19}));});
