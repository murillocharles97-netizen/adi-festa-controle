const assert=require('node:assert/strict');
const adminSdk=require('../../functions/node_modules/firebase-admin');
const {initializeApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut}=require('firebase/auth');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');

const projectId='adi-festa-variations-test',password='Secure123!';
adminSdk.initializeApp({projectId});
const admin=adminSdk.firestore(),clientApp=initializeApp({apiKey:'emulator-key',projectId},`onboarding-${Date.now()}`),auth=getAuth(clientApp),functions=getFunctions(clientApp,'southamerica-east1');
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
connectFunctionsEmulator(functions,'127.0.0.1',5001);
const complete=httpsCallable(functions,'completeBusinessOnboarding');
const payload={ownerName:'Felipe Teste',phone:'17999999999',businessName:'Felipe Doces',businessPhone:'17999999999',segment:'Doceria',city:'São José do Rio Preto',state:'SP',document:''};
let sequence=0;

async function newUser(label){
  if(auth.currentUser)await signOut(auth);
  const email=`${label}-${Date.now()}-${++sequence}@example.test`,credential=await createUserWithEmailAndPassword(auth,email,password);
  return{uid:credential.user.uid,email,businessId:`biz_${credential.user.uid}`};
}
async function assertComplete(user){
  const membershipId=`${user.businessId}_${user.uid}`,[profile,business,membership,onboarding,settings]=await Promise.all([
    admin.doc(`users/${user.uid}`).get(),admin.doc(`businesses/${user.businessId}`).get(),admin.doc(`memberships/${membershipId}`).get(),admin.doc(`onboarding/${user.uid}`).get(),admin.doc(`businesses/${user.businessId}/settings/operation`).get()
  ]);
  assert.equal(profile.exists,true);assert.equal(profile.data().businessId,user.businessId);assert.equal(profile.data().role,'owner');
  assert.equal(business.exists,true);assert.equal(business.data().ownerId,user.uid);assert.equal(business.data().subscription.planId,'trial');
  assert.equal(membership.exists,true);assert.equal(membership.data().role,'owner');assert.equal(onboarding.data().status,'completed');assert.equal(settings.exists,true);
  return{profile:profile.data(),business:business.data(),membership:membership.data()};
}

(async()=>{
  await assert.rejects(complete(payload),error=>String(error.code).includes('unauthenticated'));

  const fresh=await newUser('fresh');
  assert.equal((await complete(payload)).data.businessId,fresh.businessId);
  const freshData=await assertComplete(fresh),trialMs=freshData.business.subscription.trialEndsAt.toMillis()-freshData.business.subscription.trialStartedAt.toMillis();
  assert.equal(trialMs,7*24*60*60*1000);

  const profileOnly=await newUser('profile-only');
  await admin.doc(`users/${profileOnly.uid}`).set({uid:profileOnly.uid,email:profileOnly.email,businessId:profileOnly.businessId,role:'owner',active:true});
  await complete(payload);await assertComplete(profileOnly);

  const businessOnly=await newUser('business-only');
  await admin.doc(`businesses/${businessOnly.businessId}`).set({id:businessOnly.businessId,ownerId:businessOnly.uid,name:'Rascunho Felipe',active:true});
  await complete(payload);await assertComplete(businessOnly);

  const repair=await newUser('repair');
  await complete(payload);const first=await assertComplete(repair),start=first.business.subscription.trialStartedAt.toMillis(),end=first.business.subscription.trialEndsAt.toMillis(),membershipId=`${repair.businessId}_${repair.uid}`;
  await admin.doc(`memberships/${membershipId}`).delete();
  await complete(payload);assert.equal((await admin.doc(`memberships/${membershipId}`).get()).exists,true);
  await admin.doc(`businesses/${repair.businessId}`).update({subscription:{}});
  const restored=(await complete(payload)).data;assert.equal(restored.trial.preserved,true);
  const repaired=await assertComplete(repair);assert.equal(repaired.business.subscription.trialStartedAt.toMillis(),start);assert.equal(repaired.business.subscription.trialEndsAt.toMillis(),end);
  await Promise.all([complete(payload),complete(payload)]);const afterDouble=await assertComplete(repair);assert.equal(afterDouble.business.subscription.trialStartedAt.toMillis(),start);assert.equal(afterDouble.business.subscription.trialEndsAt.toMillis(),end);

  const interrupted=await newUser('interrupted');
  await signOut(auth);assert.equal((await admin.doc(`users/${interrupted.uid}`).get()).exists,false);
  await signInWithEmailAndPassword(auth,interrupted.email,password);
  await assert.rejects(complete({...payload,businessName:''}),error=>String(error.code).includes('invalid-argument'));
  await complete({...payload,uid:'outro-uid',subscription:{planId:'internal',status:'active'}});await assertComplete(interrupted);
  assert.equal((await admin.doc('businesses/biz_outro-uid').get()).exists,false);
  await signOut(auth);const relogin=await signInWithEmailAndPassword(auth,interrupted.email,password);assert.equal(relogin.user.uid,interrupted.uid);await assertComplete(interrupted);

  const conflicting=await newUser('conflicting-profile');
  await admin.doc(`users/${conflicting.uid}`).set({uid:conflicting.uid,email:conflicting.email,businessId:'biz_foreign',role:'owner',active:true});
  await assert.rejects(complete(payload),error=>String(error.code).includes('permission-denied'));
  assert.equal((await admin.doc(`businesses/${conflicting.businessId}`).get()).exists,false);

  console.log('Onboarding Functions: novo, retomadas parciais, idempotência, trial e novo login validados.');
  process.exit(0);
})().catch(error=>{console.error(error);process.exit(1)});
