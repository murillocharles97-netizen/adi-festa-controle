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
