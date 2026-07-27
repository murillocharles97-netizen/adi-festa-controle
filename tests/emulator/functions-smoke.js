const assert=require('node:assert/strict');
const adminSdk=require('../../functions/node_modules/firebase-admin');

(async()=>{
  const response=await fetch('http://127.0.0.1:5001/adi-festa-variations-test/southamerica-east1/submitCatalogOrder',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({data:{}})
  });
  assert.ok([400,401,403,500].includes(response.status),`status inesperado: ${response.status}`);
  console.log(`Functions emulator respondeu com bloqueio seguro (${response.status}).`);
  adminSdk.initializeApp({projectId:'adi-festa-variations-test'});const business='crm-function-test',saleId='sale-1',clientId='client-1',admin=adminSdk.firestore();
  await admin.doc(`businesses/${business}/sales/${saleId}`).set({clienteId:clientId,valorFinal:42.5,data:'2026-07-27T12:00:00.000Z',itens:[{quantidade:2}]});
  let metric=null;for(let attempt=0;attempt<20&&!metric;attempt++){await new Promise(resolve=>setTimeout(resolve,250));const result=await admin.doc(`businesses/${business}/customerMetrics/${clientId}`).get();if(result.exists)metric=result.data()}
  assert.ok(metric,'agregado do cliente não foi criado');
  assert.equal(Number(metric.totalSpent),42.5);
  assert.equal(Number(metric.purchaseCount),1);
  console.log('Agregação CRM idempotente validada no emulador.');
})().catch(error=>{console.error(error);process.exitCode=1});
