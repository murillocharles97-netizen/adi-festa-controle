'use strict';
const {canonical}=require('../../js/sale-recovery-client');
const {createHash}=require('node:crypto');
const bid='recovery-business',spaceId='recovery-space-a',otherSpace='recovery-space-b',seller='recovery-seller',owner='recovery-owner';
function sample(n=0,uid=seller,space=spaceId){
  const saleId=`retained-sale-${n}`,operationId=`retained-operation-${n}`,total=24.9+n;
  const productIds=[['shared-product'],['wine','coral','preta','corretivo','quartz'],['wine','coral','quartz','base'],['marrom']][n%4];
  const sale={id:saleId,operationId,businessId:bid,spaceId:space,financialSpaceId:space,actorUid:uid,actorRoleSnapshot:'seller',actorNameSnapshot:'Vendedor QA',data:`2026-10-17T${String(14+n%10).padStart(2,'0')}:19:54.000Z`,createdAt:`2026-10-17T${String(14+n%10).padStart(2,'0')}:19:54.000Z`,status:'pago',formaPagamento:'dinheiro',valorFinal:total,itens:productIds.map(produtoId=>({produtoId,nome:'Produto QA '+produtoId,quantidade:1,precoFinalUnitario:total/productIds.length,custoUnitario:5}))};
  const movements=productIds.map((produtoId,i)=>({id:`movement-${n}-${i}`,vendaId:saleId,operationId,businessId:bid,spaceId:space,produtoId,quantidade:-1,estoqueAnterior:2,estoqueNovo:1,actorUid:uid}));
  const packet={queueId:`queue-${n}`,operationId,businessId:bid,userId:uid,workspaceGeneration:0,status:'error',lastErrorCode:'permission-denied',lastErrorMessage:'Missing or insufficient permissions.',attempts:6-n,createdAtLocal:sale.data,payloadVersion:4,payload:{eventKind:'sale',writes:[{entityType:'sales',entityId:saleId,operation:'create',data:sale},...movements.map(m=>({entityType:'stockMovements',entityId:m.id,operation:'create',data:m})),...productIds.map(entityId=>({entityType:'products',entityId,operation:'update',data:{businessId:bid,estoqueAtual:1},before:{businessId:bid,estoqueAtual:2}}))]}};
  const original={packet,localSale:sale,localMovements:movements};
  return{original,packet,sale,movements};
}
function envelope(original){const originalJson=canonical(original);return{businessId:bid,workspaceGeneration:0,originalJson,contentHash:createHash('sha256').update(originalJson).digest('hex')};}
const request=(data,uid=seller)=>({auth:uid?{uid,token:{}}:null,data});
module.exports={bid,spaceId,otherSpace,seller,owner,sample,envelope,request};
