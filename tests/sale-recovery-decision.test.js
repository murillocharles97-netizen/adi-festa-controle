'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const f=require('./fixtures/retained-sale-recovery.cjs'),client=require('../js/sale-recovery-client');
const {validateOriginal}=require('../functions/src/services/sale-recovery-service');
const {recoveryPlan}=require('../functions/src/services/sale-recovery-decision');
const plan=o=>recoveryPlan(validateOriginal(f.envelope(o),f.seller,f.bid));
test('four synthetic cash originals have complete stock receipt plans with original IDs',()=>{
 const originals=Array.from({length:4},(_,n)=>f.sample(n).original),before=JSON.stringify(originals);
 assert.deepEqual(originals.map(o=>plan(o).movements.length),[1,5,4,1]);assert.equal(JSON.stringify(originals),before);
});
test('malformed quantities, movement IDs, sale/op associations, duplicate writes and inconsistent totals cannot execute',()=>{
 for(const change of [o=>o.packet.payload.writes[1].data.quantidade=-2,o=>o.packet.payload.writes[1].data.vendaId='another-sale',o=>o.packet.payload.writes[1].data.operationId='another-operation',o=>o.packet.payload.writes.push(o.packet.payload.writes[1]),o=>o.packet.payload.writes[2].data.estoqueAtual=-8,o=>o.packet.payload.writes[0].data.valorFinal=999]){
  const o=structuredClone(f.sample().original);change(o);assert.throws(()=>plan(o));
 }
});
test('variable parent aggregate deltas from canonical stock-only recomputation are accepted, not replayed as stale values',()=>{
 const o=structuredClone(f.sample().original);o.packet.payload.writes[0].data.itens[0].variantId='variation-blue';o.packet.payload.writes[1].data.variantId='variation-blue';
 const p=o.packet.payload.writes[2];p.before={estoqueAtual:3,estoque:3,totalStock:3};p.data={estoqueAtual:2,estoque:2,totalStock:2};o.packet.payload.writes.push({entityType:'productVariants',entityId:'variation-blue',operation:'update',before:{stock:2},data:{stock:1}});
 assert.equal(plan(o).movements.length,1);
});
test('resolved upload receipts preserve all local evidence without commercial queue acknowledgment',async()=>{
 for(const status of ['already_recreated','recovered']){
  const x=f.sample(),snapshot={identity:{uid:f.seller,businessId:f.bid,workspaceGeneration:0},packets:[x.packet],local:{vendas:[x.sale],movimentacoesEstoque:x.movements}},before=client.canonical(snapshot);
  const sender=client.create({snapshot:()=>snapshot,cryptoApi:crypto.webcrypto,call:async(_,d)=>({status,operationId:x.packet.operationId,contentHash:d.contentHash})});assert.equal((await sender.send()).sent,1);assert.equal(client.canonical(snapshot),before);assert.equal(client.held(x.packet),true);
 }
});
test('owner UI requires a separate confirmation, shows resolved audit/link, and cannot silently recover on list or upload',()=>{
 const ui=fs.readFileSync('js/sale-recovery-ui.js','utf8');assert.match(ui,/Confirmar: já foi registrada/);assert.match(ui,/Não é a mesma venda/);assert.match(ui,/Recuperar venda original/);assert.match(ui,/Resolvidas/);assert.match(ui,/Confirmar decisão/);assert.match(ui,/resolvedByName/);assert.match(ui,/linkedSaleId/);assert.equal((ui.match(/await call\('decideSaleRecovery'/g)||[]).length,1);assert.match(ui,/querySelector\('\[data-decision-confirm\]'\)\.onclick=async/);assert.doesNotMatch(ui,/deleteDoc|processSyncQueue|saveQueue|setDoc/);
});
test('review collection still has no commercial trigger, and decisions are only an explicit callable',()=>{
 const code=fs.readFileSync('functions/src/index.js','utf8');assert.doesNotMatch(code,/document:\s*['"`][^'"`]*saleRecovery/);assert.match(code,/exports\.decideSaleRecovery=onCall\(RECOVERY_OPTIONS,request=>saleRecoveries\.decide\(request\)\)/);
 const rules=fs.readFileSync('firestore.rules','utf8');assert.match(rules,/return !exists\(review\)/);assert.match(rules,/match \/saleRecoveryReviews\/\{saleId\} \{\s*allow read, write: if false/);
});
