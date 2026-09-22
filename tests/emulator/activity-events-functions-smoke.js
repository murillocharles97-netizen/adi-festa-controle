'use strict';

const assert=require('node:assert/strict');
const adminSdk=require('../../functions/node_modules/firebase-admin');

const waitFor=async(read,predicate,label)=>{
  for(let attempt=0;attempt<30;attempt++){
    const value=await read();
    if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw Error(`Timeout aguardando ${label}.`);
};

async function main(){
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test',app=adminSdk.initializeApp({projectId},`activity-events-${Date.now()}`),db=app.firestore(),businessId='activity-functions-a';
  try{
    const saleRef=db.doc(`businesses/${businessId}/sales/sale-1`),eventRef=db.doc(`businesses/${businessId}/activityEvents/sale:sale-1`);
    await saleRef.set({id:'sale-1',businessId,operationId:'operation-1',clienteId:'client-1',clienteNome:'Bruna',valorFinal:25,formaPagamento:'fiado',spaceId:'store-1',createdByUid:'cashier-1',createdAt:new Date('2026-09-22T19:15:00.957Z')});
    const created=await waitFor(()=>eventRef.get(),snapshot=>snapshot.exists,'projeção da venda');
    assert.equal(created.data().eventId,'sale:sale-1');
    assert.equal(created.data().operationId,'operation-1');
    assert.equal(created.data().actorUid,'cashier-1');
    assert.equal(created.data().summary.amount,25);
    await saleRef.update({clienteNome:'Bruna Silva Danki',updatedAt:new Date('2026-09-22T19:16:00.000Z')});
    const updated=await waitFor(()=>eventRef.get(),snapshot=>snapshot.data()?.summary?.customerName==='Bruna Silva Danki','atualização idempotente');
    assert.equal(updated.id,'sale:sale-1');
    const duplicateCount=(await db.collection(`businesses/${businessId}/activityEvents`).get()).docs.filter(item=>item.data().operationId==='operation-1').length;
    assert.equal(duplicateCount,1);
    await db.doc(`businesses/${businessId}/payments/payment-1`).set({id:'payment-1',businessId,operationId:'payment-operation-1',clienteId:'client-2',clienteNome:'Day Adidas',valor:150,paymentMethod:'pix',createdAt:new Date('2026-09-22T19:15:57.577Z')});
    const payment=await waitFor(()=>db.doc(`businesses/${businessId}/activityEvents/payment:payment-1`).get(),snapshot=>snapshot.exists,'projeção do pagamento');
    assert.equal(payment.data().type,'payment');
    assert.equal(payment.data().summary.amount,150);
    console.log(JSON.stringify({ok:true,businessId,saleEvent:updated.id,paymentEvent:payment.id,duplicateCount}));
  }finally{
    await db.recursiveDelete(db.doc(`businesses/${businessId}`)).catch(()=>{});
    await app.delete();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
