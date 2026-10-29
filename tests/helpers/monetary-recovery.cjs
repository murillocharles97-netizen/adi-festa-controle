'use strict';
const base=require('../fixtures/retained-sale-recovery.cjs'),{canonical}=require('../../js/sale-monetary-analysis-client'),crypto=require('node:crypto');
const identity={uid:'qa-money-owner',businessId:'qa-money-business',spaceId:'qa-money-space'};
function original(n=0){
 const {original:o}=base.sample(n,identity.uid,identity.spaceId),s=o.localSale,p=o.packet;
 p.businessId=identity.businessId;p.userId=identity.uid;p.status='error';p.lastErrorCode='invalid-argument';p.lastErrorMessage='Total não corresponde aos itens.';p.attempts=2;
 s.businessId=identity.businessId;s.actorRoleSnapshot='owner';s.formaPagamento=n?'pix':'dinheiro';s.clienteId=null;
 const prices=n?[40.755,28.405]:[66.405,40.755];s.itens=prices.map((u,i)=>({produtoId:'qa-money-product-'+n+'-'+i,nome:'Produto fictício '+i,quantidade:1,precoFinalUnitario:u,precoUnitario:u,unitPriceSnapshot:u,subtotalFinal:u,precoOriginal:Number((u/0.95).toFixed(2))}));s.valorFinal=n?69.16:107.16;
 o.localMovements=s.itens.map((i,k)=>({id:`qa-money-movement-${n}-${k}`,operationId:p.operationId,vendaId:s.id,businessId:identity.businessId,spaceId:identity.spaceId,actorUid:identity.uid,produtoId:i.produtoId,quantidade:-1,estoqueAnterior:5,estoqueNovo:4,tipo:'saida_venda'}));
 p.payload.writes=[{entityType:'sales',entityId:s.id,operation:'create',data:s},...s.itens.map(i=>({entityType:'products',entityId:i.produtoId,operation:'update',before:{businessId:identity.businessId,estoqueAtual:5},data:{businessId:identity.businessId,estoqueAtual:4}})),...o.localMovements.map(m=>({entityType:'stockMovements',entityId:m.id,operation:'create',data:m}))];return o;
}
const originals=[original(0),original(1)],targets=originals.map(o=>({saleId:o.localSale.id,operationId:o.packet.operationId,spaceId:identity.spaceId,reportedAmountCents:Math.round(o.localSale.valorFinal*100),productIds:o.localSale.itens.map(i=>i.produtoId),movementIds:o.localMovements.map(i=>i.id)}));
const policy=c=>c.owner&&c.uid===identity.uid&&c.businessId===identity.businessId?targets:[];
const envelope=o=>{const originalJson=canonical(o);return{intakeKind:'monetary_analysis_v1',schemaVersion:1,confirmation:'ENVIAR_PARA_ANALISE',businessId:identity.businessId,workspaceGeneration:0,originalJson,contentHash:crypto.createHash('sha256').update(originalJson).digest('hex')};};
module.exports={identity,originals,targets,policy,envelope};
