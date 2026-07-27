const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,runTransaction,setDoc}=require('firebase/firestore');

let env;
const projectId='adi-festa-variations-test';
const businessA='empresa_emulador_a',businessB='empresa_emulador_b';

test.before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),subscription={planId:'internal',status:'active'};
    await setDoc(doc(db,'businesses',businessA),{id:businessA,ownerId:'owner-a',active:true,subscription});
    await setDoc(doc(db,'businesses',businessB),{id:businessB,ownerId:'owner-b',active:true,subscription});
    await setDoc(doc(db,'users','owner-a'),{uid:'owner-a',businessId:businessA,role:'owner',active:true});
    await setDoc(doc(db,'users','owner-b'),{uid:'owner-b',businessId:businessB,role:'owner',active:true});
    await setDoc(doc(db,'users','manager-crm'),{uid:'manager-crm',businessId:businessA,role:'manager',active:true,permissions:{viewCRM:true,manageCustomerSegments:true}});
    await setDoc(doc(db,'users','cashier-no-crm'),{uid:'cashier-no-crm',businessId:businessA,role:'cashier',active:true,permissions:{}});
    await setDoc(doc(db,'businesses',businessA,'products','parent-1'),{id:'parent-1',businessId:businessA,nome:'Cone',productType:'variable',active:true});
    await setDoc(doc(db,'businesses',businessB,'products','parent-2'),{id:'parent-2',businessId:businessB,nome:'Gloss',productType:'variable',active:true});
  });
});

test.after(async()=>env?.cleanup());

const variant=(businessId,parentProductId,id='variant-1')=>({id,businessId,ownerId:businessId===businessA?'owner-a':'owner-b',parentProductId,attributeValues:{sabor:'Ferrero'},displayName:'Ferrero',displayNameNormalized:'ferrero',searchTokens:['ferrero','789'],sku:'FER',barcode:'789',price:14,cost:6,stock:8,minStock:2,active:true,catalogVisible:true,allowNegativeStock:false,imageUrl:null,createdAt:new Date(),updatedAt:new Date(),schemaVersion:10,version:1});

test('proprietário cria e lê variação da própria empresa',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),ref=doc(db,'businesses',businessA,'productVariants','variant-1');
  await assertSucceeds(setDoc(ref,variant(businessA,'parent-1')));
  await assertSucceeds(getDoc(ref));
});

test('multiempresa bloqueia leitura e gravação cruzadas',async()=>{
  const dbA=env.authenticatedContext('owner-a').firestore(),foreign=doc(dbA,'businesses',businessB,'productVariants','foreign');
  await assertFails(getDoc(foreign));
  await assertFails(setDoc(foreign,variant(businessB,'parent-2','foreign')));
});

test('público não cria variação nem altera preço ou estoque',async()=>{
  const anonymous=env.unauthenticatedContext().firestore(),ref=doc(anonymous,'businesses',businessA,'productVariants','public');
  await assertFails(setDoc(ref,variant(businessA,'parent-1','public')));
});

test('regra rejeita campo administrativo inesperado e pai de outra empresa',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(db,'businesses',businessA,'productVariants','invalid-field'),{...variant(businessA,'parent-1','invalid-field'),secretCostOverride:1}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'productVariants','invalid-parent'),variant(businessA,'parent-2','invalid-parent')));
});

test('baixa transacional atualiza a variação e o agregado do produto pai',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  const variantRef=doc(db,'businesses',businessA,'productVariants','variant-1');
  const parentRef=doc(db,'businesses',businessA,'products','parent-1');
  await runTransaction(db,async transaction=>{
    const [variantSnapshot,parentSnapshot]=await Promise.all([transaction.get(variantRef),transaction.get(parentRef)]);
    const nextStock=Number(variantSnapshot.data().stock)-2;
    transaction.update(variantRef,{stock:nextStock,updatedAt:new Date()});
    transaction.update(parentRef,{totalStock:nextStock,estoqueAtual:nextStock,hasAvailableStock:nextStock>0,updatedAt:new Date()});
  });
  assert.equal((await getDoc(variantRef)).data().stock,6);
  assert.equal((await getDoc(parentRef)).data().totalStock,6);
});

test('configuração operacional é isolada e gerenciada pelo proprietário',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),foreign=env.authenticatedContext('owner-b').firestore(),ref=doc(owner,'businesses',businessA,'settings','operation'),payload={id:'operation',businessId:businessA,ownerId:'owner-a',profile:'physical_store',modules:{creditSales:false,crm:true},smartCardMode:'automatic'};
  await assertSucceeds(setDoc(ref,payload));
  await assertFails(getDoc(doc(foreign,'businesses',businessA,'settings','operation')));
});

test('métricas e segmentos CRM respeitam permissão e empresa',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),manager=env.authenticatedContext('manager-crm').firestore(),cashier=env.authenticatedContext('cashier-no-crm').firestore(),metric=doc(owner,'businesses',businessA,'customerMetrics','client-1');
  await assertSucceeds(setDoc(metric,{id:'client-1',businessId:businessA,totalSpent:120,purchaseCount:2}));
  await assertSucceeds(getDoc(doc(manager,'businesses',businessA,'customerMetrics','client-1')));
  await assertFails(getDoc(doc(cashier,'businesses',businessA,'customerMetrics','client-1')));
  await assertSucceeds(setDoc(doc(manager,'businesses',businessA,'customerSegments','vip'),{id:'vip',businessId:businessA,name:'VIP',type:'dynamic'}));
  await assertFails(setDoc(doc(cashier,'businesses',businessA,'customerSegments','blocked'),{id:'blocked',businessId:businessA,name:'Bloqueado',type:'dynamic'}));
});
