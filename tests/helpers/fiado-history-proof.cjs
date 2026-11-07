'use strict';
function fixture(debtDeltas=[3.5,397,109.5,-30,70,250,-56,493,-268,-309,-163,-250]){
 const businessId='qa-history',client={id:'qa-client',businessId,saldo:0,financialVersion:12,legacyBalance:800,legacyBalanceRemaining:22,workspaceGeneration:0};
 const collections={sales:[],payments:[],balanceAdjustments:[],balanceEvents:[],paymentAllocations:[],processedOperations:[]};
 for(const [i,debtDelta]of debtDeltas.entries()){
  const type=i===0?'credit_sale':debtDelta<0&&![8].includes(i)?'payment_received':'balance_adjustment',col={credit_sale:'sales',payment_received:'payments',balance_adjustment:'balanceAdjustments'}[type],id='qa-source-'+i,operationId='qa-op-'+i,at=new Date(Date.UTC(2026,0,1,12,i)).toISOString(),before=client.saldo;
  client.saldo=Math.round((before-debtDelta)*100)/100;
  const source={id,businessId,workspaceGeneration:0,clienteId:client.id,operationId,status:'applied',applicationStatus:'applied',data:at,financialAppliedAt:at,saldoAnterior:before,saldoNovo:client.saldo};
  if(col==='sales')Object.assign(source,{formaPagamento:'fiado',valorFinal:debtDelta,creditOriginalAmount:debtDelta,creditPaidAmount:0,creditRemainingAmount:debtDelta,saldoAtual:client.saldo});
  if(col==='payments')source.valor=-debtDelta;
  collections[col].push(source);collections.balanceEvents.push({id:type+':'+id,businessId,workspaceGeneration:0,customerId:client.id,status:'applied',type,sourceCollection:col,sourceDocumentId:id,operationId,appliedAt:at,balanceDelta:-debtDelta});
  collections.processedOperations.push({id:operationId,businessId,workspaceGeneration:0,status:'processed',eventKind:{sales:'sale',payments:'payment',balanceAdjustments:'balance_adjustment'}[col]});
 }
 return {businessId,generation:0,client,collections,complete:true,stable:true};
}
module.exports={fixture};
