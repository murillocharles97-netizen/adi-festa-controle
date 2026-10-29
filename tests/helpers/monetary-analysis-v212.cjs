'use strict';
// Entirely fictitious. Never use real incident IDs in public fixtures.
const crypto=require('node:crypto'),base=require('../fixtures/retained-sale-recovery.cjs');
const client=require('../../js/sale-monetary-analysis-client');
const identity={uid:base.owner,businessId:base.bid,workspaceGeneration:0,spaceId:base.spaceId,role:'owner',epoch:0};
function original(n=0){
 const o=structuredClone(base.sample(0,identity.uid).original),saleId='qa-analysis-sale-'+n,operationId='qa-analysis-operation-'+n;
 o.packet.operationId=operationId;o.packet.queueId='qa-analysis-queue-'+n;o.packet.lastErrorCode='invalid-argument';o.packet.lastErrorMessage='Total não corresponde aos itens.';
 const sale=o.localSale;sale.id=saleId;sale.operationId=operationId;sale.actorRoleSnapshot='owner';sale.itens=[{produtoId:'qa-analysis-product-a',quantidade:3,precoFinalUnitario:3.3333,precoOriginal:3.5},{produtoId:'qa-analysis-product-b',quantidade:1,precoFinalUnitario:2.05}];sale.valorFinal=12.0499;
 o.localMovements=sale.itens.map((i,k)=>({id:`qa-analysis-movement-${n}-${k}`,businessId:identity.businessId,spaceId:identity.spaceId,actorUid:identity.uid,operationId,vendaId:saleId,produtoId:i.produtoId,quantidade:-i.quantidade}));
 o.packet.payload.writes=[{entityType:'sales',entityId:saleId,operation:'create',data:sale},...sale.itens.map(i=>({entityType:'products',entityId:i.produtoId,operation:'update',data:{businessId:identity.businessId,estoqueAtual:5},before:{businessId:identity.businessId,estoqueAtual:5+i.quantidade}})),...o.localMovements.map(m=>({entityType:'stockMovements',entityId:m.id,operation:'create',data:m}))];
 return o;
}
function target(n=0){const o=original(n);return{saleId:o.localSale.id,operationId:o.packet.operationId,spaceId:identity.spaceId,reportedAmountCents:1205,productIds:o.localSale.itens.map(i=>i.produtoId),movementIds:o.localMovements.map(m=>m.id)};}
const targets=[target(0),target(1)],originals=[original(0),original(1)];
const sources=()=>originals.map(o=>({packets:[o.packet],sales:[o.localSale],movements:o.localMovements}));
const policy=c=>c.owner&&c.uid===identity.uid&&c.businessId===identity.businessId?targets:[];
function envelope(o=original()){const originalJson=client.canonical(o);return{intakeKind:client.KIND,schemaVersion:1,confirmation:'ENVIAR_PARA_ANALISE',businessId:identity.businessId,workspaceGeneration:0,originalJson,contentHash:crypto.createHash('sha256').update(originalJson).digest('hex')};}
function receipt(t,hash){return{kind:client.KIND,schemaVersion:1,businessId:identity.businessId,actorUid:identity.uid,spaceId:t.spaceId,workspaceGeneration:0,saleId:t.saleId,operationId:t.operationId,contentHash:hash,payloadHash:'f'.repeat(64),status:'analysis_received',commercialEffectsApplied:false};}
module.exports={identity,targets,original,originals,sources,policy,envelope,receipt};
