'use strict';

const assert=require('node:assert/strict');
const {initializeApp:initializeAdminApp,deleteApp:deleteAdminApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeApp:initializeClientApp,deleteApp:deleteClientApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword}=require('firebase/auth');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');

async function main(){
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test',suffix=Date.now(),adminApp=initializeAdminApp({projectId},`financial-account-delete-admin-${suffix}`),db=getFirestore(adminApp),clientApp=initializeClientApp({apiKey:'emulator-key',projectId},`financial-account-delete-client-${suffix}`),auth=getAuth(clientApp),functions=getFunctions(clientApp,'southamerica-east1');
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFunctionsEmulator(functions,'127.0.0.1',5001);
  const credential=await createUserWithEmailAndPassword(auth,`financial-account-${suffix}@example.test`,'Secure123!'),uid=credential.user.uid,businessId=`financial-account-business-${suffix}`,homeSpaceId=`financial-account-home-${suffix}`,accountCollection=db.collection(`financialSpaces/${homeSpaceId}/financialAccounts`),removeAccount=httpsCallable(functions,'deleteUnusedFinancialAccount');
  try{
    await db.doc(`financialSpaces/${homeSpaceId}`).set({id:homeSpaceId,name:'Casa',type:'personal',ownerUid:uid,linkedBusinessId:businessId,active:true});
    await accountCollection.doc('unused-zero').set({id:'unused-zero',ownerUid:uid,financialSpaceId:homeSpaceId,name:'Sem uso',type:'bank_account',initialBalanceCents:0,currentBalanceCents:0,active:true});
    const deleted=(await removeAccount({homeSpaceId,accountId:'unused-zero'})).data;
    assert.deepEqual(deleted,{deleted:true,archived:false,references:0});
    assert.equal((await accountCollection.doc('unused-zero').get()).exists,false);

    await accountCollection.doc('business-reference').set({id:'business-reference',ownerUid:uid,financialSpaceId:homeSpaceId,name:'Com histórico',type:'bank_account',initialBalanceCents:0,currentBalanceCents:0,active:true});
    await db.doc(`businesses/${businessId}/payments/payment-1`).set({id:'payment-1',businessId,destinationAccountId:'business-reference',amount:10,status:'applied'});
    const archived=(await removeAccount({homeSpaceId,accountId:'business-reference'})).data,archivedAccount=(await accountCollection.doc('business-reference').get()).data();
    assert.equal(archived.deleted,false);assert.equal(archived.archived,true);assert.equal(archived.references,1);assert.equal(archivedAccount.active,false);

    await accountCollection.doc('non-zero').set({id:'non-zero',ownerUid:uid,financialSpaceId:homeSpaceId,name:'Com saldo',type:'bank_account',initialBalanceCents:0,currentBalanceCents:500,active:true});
    await assert.rejects(()=>removeAccount({homeSpaceId,accountId:'non-zero'}),error=>error.code==='functions/failed-precondition');
    assert.equal((await accountCollection.doc('non-zero').get()).exists,true);
    console.log('Financial account deletion: zero sem uso exclui, referência business arquiva e saldo bloqueia.');
  }finally{
    await db.recursiveDelete(db.doc(`financialSpaces/${homeSpaceId}`)).catch(()=>{});
    await db.recursiveDelete(db.doc(`businesses/${businessId}`)).catch(()=>{});
    await deleteClientApp(clientApp);await deleteAdminApp(adminApp);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
