'use strict';
const f=require('../fixtures/retained-sale-recovery.cjs');
function sample(n=0){
 const o=structuredClone(f.sample(n%4).original),id='qa-retained-client-'+n;
 const client={id,businessId:f.bid,nome:'Pessoa fictícia '+n,telefone:'1198888'+String(n).padStart(4,'0'),saldo:0,financialVersion:0,totalComprado:0,quantidadeVendas:0,ativo:true};
 const p={operationId:'qa-customer-operation-'+n,businessId:f.bid,userId:f.seller,workspaceGeneration:0,status:'error',lastErrorCode:'permission-denied',lastErrorMessage:'Sem permissão para editar o cadastro do cliente.',attempts:3,syncProtocolVersion:1,payloadVersion:4,createdAtLocal:o.packet.createdAtLocal,payload:{eventKind:'simple',writes:[{entityType:'clients',entityId:id,operation:'create',data:client}]}};
 for(const sale of [o.localSale,o.packet.payload.writes.find(w=>w.entityType==='sales').data])sale.clienteId=id;
 o.packet.payload.writes.push({entityType:'clients',entityId:id,operation:'update',before:client,data:{businessId:f.bid,totalComprado:o.localSale.valorFinal,quantidadeVendas:1,ultimaCompra:o.localSale.data,atualizadoEm:o.localSale.data}});
 o.clientDependencies=[{packet:p}];return{original:o,client,packet:p};
}
module.exports={...f,sample};
