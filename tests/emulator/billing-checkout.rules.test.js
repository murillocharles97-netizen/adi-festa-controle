const test=require('node:test');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc}=require('firebase/firestore');

let env;
const projectId='adi-festa-variations-test',businessA='billing-a',businessB='billing-b';

test.before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),subscription={planId:'professional',status:'active'};
    await setDoc(doc(db,'businesses',businessA),{id:businessA,ownerId:'owner-a',active:true,subscription});
    await setDoc(doc(db,'businesses',businessB),{id:businessB,ownerId:'owner-b',active:true,subscription});
    await setDoc(doc(db,'users','owner-a'),{uid:'owner-a',businessId:businessA,role:'owner',active:true});
    await setDoc(doc(db,'users','owner-b'),{uid:'owner-b',businessId:businessB,role:'owner',active:true});
    await setDoc(doc(db,'businesses',businessA,'billingCheckoutAttempts','attempt-1234567890'),{businessId:businessA,requestedBy:'owner-a',operationId:'attempt-1234567890',paymentMethodType:'pix_monthly',status:'payment_pending',qrCode:'private-pix-code'});
    await setDoc(doc(db,'billingOrderIndex','order-1'),{businessId:businessA,operationId:'attempt-1234567890'});
    await setDoc(doc(db,'billingPaymentEvents','pix_order-1'),{businessId:businessA,status:'approved'});
  });
});

test.after(async()=>env?.cleanup());

test('proprietário lê somente a própria tentativa Pix por id exato',async()=>{
  const ownerA=env.authenticatedContext('owner-a').firestore(),ownerB=env.authenticatedContext('owner-b').firestore(),ref=doc(ownerA,'businesses',businessA,'billingCheckoutAttempts','attempt-1234567890');
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(ownerB,'businesses',businessA,'billingCheckoutAttempts','attempt-1234567890')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'businesses',businessA,'billingCheckoutAttempts','attempt-1234567890')));
});

test('frontend não cria nem altera tentativa e índices permanecem backend-only',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),attempt=doc(db,'businesses',businessA,'billingCheckoutAttempts','attempt-1234567890');
  await assertFails(updateDoc(attempt,{status:'payment_approved'}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'billingCheckoutAttempts','attempt-new-123456'),{businessId:businessA,requestedBy:'owner-a'}));
  await assertFails(getDoc(doc(db,'billingOrderIndex','order-1')));
  await assertFails(getDoc(doc(db,'billingPaymentEvents','pix_order-1')));
});
