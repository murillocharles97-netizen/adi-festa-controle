'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('frontend não contém token nem consulta Mercado Pago ao abrir',()=>{
  const frontend=['js/firebase/business-context.js','js/plans.js'].map(file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8')).join('\n');
  assert.doesNotMatch(frontend,/APP_USR-|TEST-[0-9]|api\.mercadopago\.com/);assert.doesNotMatch(frontend,/getSubscription\(|preapproval\/search/);
});

test('backend usa Secret Manager, webhook e reconciliação explícita',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
  assert.match(source,/defineSecret\('MERCADO_PAGO_ACCESS_TOKEN'\)/);assert.match(source,/defineSecret\('MERCADO_PAGO_WEBHOOK_SECRET'\)/);assert.match(source,/exports\.receiveWebhook/);assert.match(source,/reconcileProvider===true/);assert.match(source,/source:'firestore'/);assert.match(source,/lastManualSyncAt/);assert.match(source,/runTransaction/);assert.match(source,/leaseUntil/);
});
