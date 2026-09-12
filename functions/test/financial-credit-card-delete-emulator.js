'use strict';

const assert=require('node:assert/strict');
const {initializeApp:initializeAdminApp,deleteApp:deleteAdminApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeApp:initializeClientApp,deleteApp:deleteClientApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword}=require('firebase/auth');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');

async function main(){
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test',suffix=Date.now(),adminApp=initializeAdminApp({projectId},`financial-card-delete-admin-${suffix}`),db=getFirestore(adminApp),clientApp=initializeClientApp({apiKey:'emulator-key',projectId},`financial-card-delete-client-${suffix}`),auth=getAuth(clientApp),functions=getFunctions(clientApp,'southamerica-east1');
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFunctionsEmulator(functions,'127.0.0.1',5001);
  const credential=await createUserWithEmailAndPassword(auth,`financial-card-${suffix}@example.test`,'Secure123!'),uid=credential.user.uid,homeSpaceId=`financial-card-home-${suffix}`,carSpaceId=`financial-card-car-${suffix}`,cardCollection=db.collection(`financialSpaces/${homeSpaceId}/creditCards`),removeCard=httpsCallable(functions,'deleteUnusedCreditCard');
  const card=id=>({id,ownerUid:uid,financialSpaceId:homeSpaceId,cardHomeSpaceId:homeSpaceId,name:id,institution:'Teste',last4:null,limitCents:100000,committedCents:0,closingDay:10,dueDay:20,accessMode:'all_spaces',allowedFinancialSpaceIds:[],defaultFinancialSpaceId:homeSpaceId,active:true});
  try{
    await db.doc(`financialSpaces/${homeSpaceId}`).set({id:homeSpaceId,name:'Casa',type:'personal',ownerUid:uid,active:true});
    await db.doc(`financialSpaces/${carSpaceId}`).set({id:carSpaceId,name:'Carro',type:'other',ownerUid:uid,active:true});
    await cardCollection.doc('unused').set(card('unused'));
    const deleted=(await removeCard({homeSpaceId,cardId:'unused'})).data;
    assert.deepEqual(deleted,{deleted:true,archived:false,references:0});
    assert.equal((await cardCollection.doc('unused').get()).exists,false);

    await cardCollection.doc('used').set(card('used'));
    await db.doc(`financialSpaces/${carSpaceId}/creditCardPurchases/fuel`).set({id:'fuel',ownerUid:uid,financialSpaceId:carSpaceId,cardHomeSpaceId:homeSpaceId,creditCardId:'used',creditCardInvoiceId:'used_2026-09',amountCents:5000,status:'posted'});
    const archived=(await removeCard({homeSpaceId,cardId:'used'})).data,archivedCard=(await cardCollection.doc('used').get()).data();
    assert.equal(archived.deleted,false);assert.equal(archived.archived,true);assert.equal(archived.references,1);assert.equal(archivedCard.active,false);
    assert.equal((await db.doc(`financialSpaces/${carSpaceId}/creditCardPurchases/fuel`).get()).exists,true);
    console.log('Credit card deletion: cartão sem histórico exclui; cartão com compra em outro espaço arquiva e preserva histórico.');
  }finally{
    await db.recursiveDelete(db.doc(`financialSpaces/${homeSpaceId}`)).catch(()=>{});
    await db.recursiveDelete(db.doc(`financialSpaces/${carSpaceId}`)).catch(()=>{});
    await deleteClientApp(clientApp);await deleteAdminApp(adminApp);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
