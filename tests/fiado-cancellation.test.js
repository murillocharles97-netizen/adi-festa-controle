'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./helpers/fiado-cancellation-harness.cjs');
test('V196 reproduction: hydrated applied Fiado cancels with balance -26 → -12 and a reversal effect',()=>{
 const h=harness(),{sale}=h.sell();h.data().vendas[0].status='applied';
 const {packet}=h.undo(sale.id);
 assert.equal(h.data().clientes[0].saldo,-12);
 assert.equal(h.data().clientes[0].financialVersion,14);
 assert.equal(h.data().produtos[0].estoqueAtual,3);
 const effect=h.c.financialEffectFromWrites(packet.payload.writes,'qa-fiado',packet.operationId,'sale_undo');
 assert.equal(effect.type,'credit_sale_reversal');assert.equal(effect.balanceDelta,14);assert.equal(effect.id,'credit_sale_reversal:'+sale.id);
});
test('same cancellation cannot remove the preceding sale or create a second stock return',()=>{
 const h=harness();h.sell({status:'pago'});const {sale}=h.sell();h.undo(sale.id);const before=JSON.stringify(h.data());
 assert.throws(()=>h.undo(sale.id),/mais recente|cancelada/);assert.equal(JSON.stringify(h.data()),before);
});
for(const change of ['paid','version','allocation'])test(`partially received or changed Fiado is blocked without local effects: ${change}`,()=>{
 const h=harness(),{sale}=h.sell();
 if(change==='paid')h.data().vendas[0].creditPaidAmount=4;
 if(change==='version'){h.data().clientes[0].saldo=-22;h.data().clientes[0].financialVersion++;}
 if(change==='allocation')h.data().alocacoesPagamento.push({saleId:sale.id,amount:4});
 const before=JSON.stringify(h.data());assert.throws(()=>h.undo(sale.id),/recebimento|saldo.*alterado|concilia/i);assert.equal(JSON.stringify(h.data()),before);
});
test('cash cancellation does not touch debt or emit a balance event',()=>{
 const h=harness(),{sale}=h.sell({status:'pago'}),{packet}=h.undo(sale.id);
 assert.equal(h.data().clientes[0].saldo,-12);assert.equal(h.data().produtos[0].estoqueAtual,3);
 assert.equal(h.c.financialEffectFromWrites(packet.payload.writes,'qa-fiado',packet.operationId,'sale_undo'),null);
});
test('exchange-credit checkout remains blocked by the existing dedicated cancellation guard',()=>{
 const h=harness(),{sale}=h.sell({status:'pago'});h.data().vendas[0].source='exchange_credit_checkout';
 const before=JSON.stringify(h.data());assert.throws(()=>h.undo(sale.id),/crédito de troca/);assert.equal(JSON.stringify(h.data()),before);
});
function confirmationHarness(){
 const h=harness(),{sale}=h.sell(),{removed}=h.undo(sale.id);let pushed=0;const applied=[];
 const rows={processedOperations:{status:'processed'},sales:{...sale,active:false,cancelOperationId:removed.cancelOperationId},balanceEvents:{businessId:'qa-fiado',saleId:sale.id,customerId:'qa-client',type:'credit_sale_reversal',status:'applied',operationId:removed.cancelOperationId,balanceDelta:14},clients:{id:'qa-client',saldo:-12,financialVersion:14}};
 h.c.doc=(_db,...parts)=>parts;h.c.getDocFromServer=async parts=>({exists:()=>Boolean(rows[parts[2]]),data:()=>rows[parts[2]]});
 h.c.processSyncQueue=async()=>{pushed++;};h.c.applyCloudCollection=(...args)=>applied.push(args);
 return{h,removed,rows,applied,pushed:()=>pushed};
}
test('visual confirmation waits for durable cloud receipt + reversal, then hydrates canonical client and history without DB.alterar',async()=>{
 const {h,removed,applied,pushed}=confirmationHarness();h.c.DB.alterar=()=>{throw Error('confirmation must never capture another commercial operation');};
 await h.c.confirmSaleUndo(removed);assert.equal(pushed(),1);assert.deepEqual(applied.map(a=>a[0]),['sales','clients']);assert.equal(applied[1][1][0].saldo,-12);
});
test('missing reversal cannot display financial success or assume balance repaired',async()=>{
 const {h,removed,rows,applied}=confirmationHarness();delete rows.balanceEvents;
 await assert.rejects(h.c.confirmSaleUndo(removed),/ainda não foi confirmado/);assert.equal(applied.length,0);
});
test('account switch during cancellation confirmation does not hydrate the new namespace',async()=>{
 const {h,removed,applied}=confirmationHarness();h.c.processSyncQueue=async()=>{h.c.syncSessionGeneration++;};
 await assert.rejects(h.c.confirmSaleUndo(removed),{code:'sync-session-retired'});assert.equal(applied.length,0);
});
