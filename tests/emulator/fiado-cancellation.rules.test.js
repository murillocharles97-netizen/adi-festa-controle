'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const {harness}=require('../helpers/fiado-cancellation-harness.cjs');
const bid='qa-fiado-cancel-'+Date.now().toString(36),uid='qa-fiado-owner',space='qa-fiado-space';
let env,sanitize;
const ref=(db,name,id)=>sdk.doc(db,'businesses',bid,name,id);
const admin=async fn=>{let result;await env.withSecurityRulesDisabled(async c=>{result=await fn(c.firestore());});return result;};
const read=(name,id)=>admin(db=>sdk.getDoc(ref(db,name,id)));
async function prepare({legacy=false,cash=false}={}){
 const h=harness({businessId:bid,spaceId:space,uid,sdk,database:env.authenticatedContext(uid).firestore(),sanitize});
 // Scenarios run serially; reset the two QA fixtures, never any production path.
 await admin(async db=>{await sdk.setDoc(ref(db,'clients','qa-client'),h.data().clientes[0]);await sdk.setDoc(ref(db,'products','qa-product'),h.data().produtos[0]);});
 const {sale,packet}=h.sell(cash?{status:'pago'}:{});await h.commit(packet);
 if(legacy)await admin(db=>sdk.updateDoc(ref(db,'sales',sale.id),{status:'applied'}));
 const remote=(await read('sales',sale.id)).data(),client=(await read('clients','qa-client')).data();
 h.data().vendas=[remote];h.data().clientes=[client];
 return{h,sale,created:packet,undo:()=>h.undo(sale.id).packet};
}
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 sanitize=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js','utf8')))).sanitizeForFirestore;
 await admin(async db=>{
  await sdk.setDoc(sdk.doc(db,'businesses',bid),{ownerId:uid,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
  await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role:'owner',active:true});
  await sdk.setDoc(ref(db,'members',uid),{uid,role:'owner',status:'active',spaceAccess:'all',permissions:{}});
  await sdk.setDoc(sdk.doc(db,'financialSpaces',space),{id:space,businessId:bid,linkedBusinessId:bid,ownerUid:uid,type:'business',active:true,capabilities:{sales:true,inventory:true,products:true,finance:false}});
 });
});
test.after(async()=>env?.cleanup());
for(const legacy of [false,true])test(`credit → hydration/reload → cancel restores canonical balance exactly once (${legacy?'legacy applied':'new fiado'})`,async()=>{
 const {h,sale,undo}=await prepare({legacy});const packet=undo();
 assert.equal((await read('sales',sale.id)).data().status,legacy?'applied':'fiado');
 await h.commit(packet);await Promise.all([h.commit(packet),h.commit(packet)]);
 const client=(await read('clients','qa-client')).data(),remote=(await read('sales',sale.id)).data();
 assert.equal(client.saldo,-12);assert.equal(client.financialVersion,14);assert.equal(remote.active,false);
 assert.equal(remote.operationId,sale.operationId);assert.equal(remote.actorUid,uid);
 assert.equal(remote.financialOperationId,'credit_sale:'+sale.id);assert.equal(remote.financialReversalEventId,'credit_sale_reversal:'+sale.id);
 assert.equal((await read('products','qa-product')).data().estoqueAtual,3);
 assert.equal((await read('balanceEvents','credit_sale_reversal:'+sale.id)).data().balanceDelta,14);
 assert.equal((await read('balanceEvents','credit_sale_reversal:'+sale.id)).data().balanceBefore,-26);
 assert.equal((await read('balanceEvents','credit_sale_reversal:'+sale.id)).data().balanceAfter,-12);
 // A second device reads the same canonical result, without a local recalculation.
 const second=env.authenticatedContext(uid).firestore();assert.equal((await sdk.getDocFromServer(ref(second,'clients','qa-client'))).data().saldo,-12);
 const model=require('../../js/performance-model');assert.equal(model.validSale(remote),false);
 const next=structuredClone(packet);next.operationId=crypto.randomUUID();await h.commit(next);
 assert.equal((await read('clients','qa-client')).data().saldo,-12);assert.equal((await read('products','qa-product')).data().estoqueAtual,3);
});
test('lost response and retry of SAME original operation do not duplicate reversal or stock',async()=>{
 const {h,sale,undo}=await prepare(),packet=undo();await h.commit(packet); // committed, response lost
 await h.commit(structuredClone(packet));assert.equal((await read('clients','qa-client')).data().saldo,-12);
 const rows=await admin(db=>sdk.getDocs(sdk.query(sdk.collection(db,'businesses',bid,'stockMovements'),sdk.where('vendaId','==',sale.id))));
 assert.equal(rows.docs.filter(d=>d.data().tipo==='venda_desfeita').length,1);
});
test('two competing cancellation IDs cannot credit the customer or return stock twice',async()=>{
 const {h,sale,undo}=await prepare(),first=undo(),second=structuredClone(first);second.operationId=crypto.randomUUID();
 for(const w of second.payload.writes.filter(w=>w.entityType==='stockMovements')){w.entityId=crypto.randomUUID();w.data.id=w.entityId;w.data.operationId=second.operationId;}
 await Promise.all([h.commit(first),h.commit(second)]);
 assert.equal((await read('clients','qa-client')).data().saldo,-12);assert.equal((await read('products','qa-product')).data().estoqueAtual,3);
 const rows=await admin(db=>sdk.getDocs(sdk.query(sdk.collection(db,'businesses',bid,'stockMovements'),sdk.where('vendaId','==',sale.id))));assert.equal(rows.docs.filter(d=>d.data().tipo==='venda_desfeita').length,1);
});
for(const changed of ['payment','other-balance-event','missing-debit','invalid-delta','wrong-space'])test(`atomic rejection preserves sale, receipt and stock: ${changed}`,async()=>{
 const {h,sale,undo}=await prepare(),packet=undo();
 await admin(async db=>{
  if(changed==='payment'){await sdk.updateDoc(ref(db,'sales',sale.id),{creditPaidAmount:4,creditRemainingAmount:10});await sdk.updateDoc(ref(db,'clients','qa-client'),{saldo:-22,financialVersion:14});}
  if(changed==='other-balance-event')await sdk.updateDoc(ref(db,'clients','qa-client'),{saldo:-16,financialVersion:14});
  if(changed==='missing-debit')await sdk.deleteDoc(ref(db,'balanceEvents','credit_sale:'+sale.id));
 });
 if(changed==='invalid-delta')packet.payload.writes.find(w=>w.entityType==='clients').data.saldo=-11;
 if(changed==='wrong-space')packet.payload.writes.find(w=>w.entityType==='sales').before.spaceId='other';
 const beforeClient=(await read('clients','qa-client')).data();
 await assert.rejects(h.commit(packet),{code:'credit-sale-reversal-conflict'});
 assert.deepEqual((await read('clients','qa-client')).data(),beforeClient);
 assert.notEqual((await read('sales',sale.id)).data().active,false);assert.equal((await read('products','qa-product')).data().estoqueAtual,2);
 assert.equal((await read('balanceEvents','credit_sale_reversal:'+sale.id)).exists(),false);assert.equal((await read('processedOperations',packet.operationId)).exists(),false);
});
test('cash cancellation remains independent of customer debt and Fiado ledger',async()=>{
 const {h,sale,undo}=await prepare({cash:true}),packet=undo();await h.commit(packet);await h.commit(packet);
 assert.equal((await read('clients','qa-client')).data().saldo,-12);assert.equal((await read('products','qa-product')).data().estoqueAtual,3);
 assert.equal((await read('balanceEvents','credit_sale_reversal:'+sale.id)).exists(),false);
});
