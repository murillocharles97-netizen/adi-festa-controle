const test=require('node:test');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {collection,doc,getDoc,getDocs,setDoc,updateDoc}=require('firebase/firestore');

let env;
const projectId='adi-festa-variations-test',businessA='terminal-a',businessB='terminal-b';

test.before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),subscription={planId:'internal',status:'active'};
    await setDoc(doc(db,'businesses',businessA),{id:businessA,ownerId:'owner-a',active:true,subscription});
    await setDoc(doc(db,'businesses',businessB),{id:businessB,ownerId:'owner-b',active:true,subscription});
    for(const user of [{uid:'owner-a',businessId:businessA,role:'owner'},{uid:'cashier-a',businessId:businessA,role:'cashier'},{uid:'owner-b',businessId:businessB,role:'owner'}])await setDoc(doc(db,'users',user.uid),{...user,active:true});
    await setDoc(doc(db,'businesses',businessA,'paymentTerminals','terminal-1'),{id:'terminal-1',businessId:businessA,provider:'simulator',nickname:'Caixa 1',status:'connected'});
    await setDoc(doc(db,'businesses',businessA,'paymentIntents','intent-1'),{id:'intent-1',businessId:businessA,createdByUid:'cashier-a',status:'processing',amountCents:8990});
    await setDoc(doc(db,'businesses',businessA,'paymentIntents','intent-1','events','event-1'),{id:'event-1',businessId:businessA,intentId:'intent-1',type:'payment_processing'});
    await setDoc(doc(db,'businesses',businessA,'paymentProviderConfigs','simulator'),{businessId:businessA,provider:'simulator',status:'enabled'});
    await setDoc(doc(db,'businesses',businessA,'paymentReceivables','intent-1'),{id:'intent-1',businessId:businessA,status:'pending_settlement',grossAmountCents:8990});
  });
});
test.after(async()=>env?.cleanup());

test('empresa acessa seus terminais, intents, eventos e recebíveis',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),cashier=env.authenticatedContext('cashier-a').firestore();
  await assertSucceeds(getDoc(doc(owner,'businesses',businessA,'paymentTerminals','terminal-1')));
  await assertSucceeds(getDoc(doc(cashier,'businesses',businessA,'paymentIntents','intent-1')));
  await assertSucceeds(getDoc(doc(cashier,'businesses',businessA,'paymentIntents','intent-1','events','event-1')));
  await assertSucceeds(getDoc(doc(owner,'businesses',businessA,'paymentReceivables','intent-1')));
  await assertSucceeds(getDocs(collection(cashier,'businesses',businessA,'paymentIntents')));
});

test('outra empresa e usuário anônimo não veem dados presenciais',async()=>{
  const other=env.authenticatedContext('owner-b').firestore(),anonymous=env.unauthenticatedContext().firestore();
  for(const db of [other,anonymous]){
    await assertFails(getDoc(doc(db,'businesses',businessA,'paymentTerminals','terminal-1')));
    await assertFails(getDoc(doc(db,'businesses',businessA,'paymentIntents','intent-1')));
    await assertFails(getDoc(doc(db,'businesses',businessA,'paymentReceivables','intent-1')));
  }
});

test('frontend não cria, altera ou arquiva dados controlados pelo backend',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(db,'businesses',businessA,'paymentIntents','forged'),{businessId:businessA,status:'approved'}));
  await assertFails(updateDoc(doc(db,'businesses',businessA,'paymentIntents','intent-1'),{status:'approved'}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'paymentTerminals','forged'),{businessId:businessA,provider:'cielo'}));
  await assertFails(updateDoc(doc(db,'businesses',businessA,'paymentTerminals','terminal-1'),{businessId:businessA,status:'archived'}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'paymentReceivables','forged'),{businessId:businessA,grossAmountCents:999999}));
});

test('configuração segura é visível só para admin da própria empresa',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),cashier=env.authenticatedContext('cashier-a').firestore(),other=env.authenticatedContext('owner-b').firestore();
  await assertSucceeds(getDoc(doc(owner,'businesses',businessA,'paymentProviderConfigs','simulator')));
  await assertFails(getDoc(doc(cashier,'businesses',businessA,'paymentProviderConfigs','simulator')));
  await assertFails(getDoc(doc(other,'businesses',businessA,'paymentProviderConfigs','simulator')));
});

test('integrated sale requires server-approved matching intent and cannot be cancelled locally',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),saleId='integrated-secure-sale',spaceId='space-terminal-a';
  const sale={id:saleId,businessId:businessA,spaceId,financialSpaceId:spaceId,actorUid:'owner-a',operationId:'terminal_operation_safe',formaPagamento:'cartao_presencial',paymentIntentId:'approved-secure',status:'pago',paymentState:'paid',valorFinal:25};
  await env.withSecurityRulesDisabled(async context=>{
    const admin=context.firestore();
    await setDoc(doc(admin,'financialSpaces',spaceId),{id:spaceId,businessId:businessA,linkedBusinessId:businessA,type:'business',active:true,status:'active',capabilities:{sales:true}});
    await setDoc(doc(admin,'businesses',businessA,'paymentIntents','approved-secure'),{businessId:businessA,saleId,spaceId,createdByUid:'owner-a',status:'processing',amountCents:2500,finalizationOperationId:sale.operationId});
  });
  await assertFails(setDoc(doc(db,'businesses',businessA,'sales',saleId),sale));
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',businessA,'paymentIntents','approved-secure'),{status:'approved'}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'sales',saleId),{...sale,valorFinal:1}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'sales','different-sale'),{...sale,id:'different-sale'}));
  await assertSucceeds(setDoc(doc(db,'businesses',businessA,'sales',saleId),sale));
  await assertFails(updateDoc(doc(db,'businesses',businessA,'sales',saleId),{status:'cancelled'}));
});

test('Equipe seller can observe only own authorized current intent, never approve it',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'users','seller-payment'),{uid:'seller-payment',businessId:businessA,active:true,role:'seller'});
    await setDoc(doc(db,'businesses',businessA,'members','seller-payment'),{uid:'seller-payment',businessId:businessA,role:'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:['shop-one'],permissions:{'sales.create':true}});
    for(const [id,spaceId,createdByUid]of [['own','shop-one','seller-payment'],['other','shop-one','owner-a'],['wrong-space','shop-two','seller-payment']])await setDoc(doc(db,'businesses',businessA,'paymentIntents',id),{businessId:businessA,spaceId,createdByUid,status:'processing'});
  });
  const db=env.authenticatedContext('seller-payment').firestore();
  await assertSucceeds(getDoc(doc(db,'businesses',businessA,'paymentIntents','own')));
  for(const id of ['other','wrong-space'])await assertFails(getDoc(doc(db,'businesses',businessA,'paymentIntents',id)));
  await assertFails(getDocs(collection(db,'businesses',businessA,'paymentIntents')));
  await assertFails(updateDoc(doc(db,'businesses',businessA,'paymentIntents','own'),{status:'approved'}));
});
