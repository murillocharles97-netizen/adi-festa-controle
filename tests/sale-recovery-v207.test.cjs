'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),f=require('./helpers/customer-recovery-v205.cjs'),client=require('../js/sale-recovery-client');
test('V207 explicit evidence-only supplement acknowledges submitted hash without replacing queue or accepted base hash',async()=>{
 const s=f.sample(),snapshot={identity:{uid:f.seller,businessId:f.bid,workspaceGeneration:0},packets:[s.packet,s.original.packet],local:{vendas:[s.original.localSale],movimentacoesEstoque:s.original.localMovements}},before=JSON.stringify(snapshot);let calls=0;
 const sender=client.create({cryptoApi:crypto.webcrypto,snapshot:async()=>snapshot,call:async(_,data)=>{calls++;return{saleId:s.original.localSale.id,operationId:s.original.packet.operationId,status:'awaiting_review',evidenceOnly:true,contentHash:'a'.repeat(64),receivedContentHash:data.contentHash};}});
 assert.equal((await sender.send()).sent,1);assert.equal(calls,1);assert.equal(JSON.stringify(snapshot),before);
});
test('V207 forged supplement acknowledgement hash or sale identity cannot acknowledge evidence',async()=>{
 const s=f.sample(),snapshot={identity:{uid:f.seller,businessId:f.bid,workspaceGeneration:0},packets:[s.packet,s.original.packet],local:{vendas:[s.original.localSale],movimentacoesEstoque:s.original.localMovements}};
 for(const change of [{receivedContentHash:'wrong'},{saleId:'another'}]){const sender=client.create({cryptoApi:crypto.webcrypto,snapshot:async()=>snapshot,call:async(_,d)=>({saleId:s.original.localSale.id,operationId:s.original.packet.operationId,status:'awaiting_review',evidenceOnly:true,contentHash:'a'.repeat(64),receivedContentHash:d.contentHash,...change})});await assert.rejects(sender.send(),/confirmar o recebimento/);}
});
