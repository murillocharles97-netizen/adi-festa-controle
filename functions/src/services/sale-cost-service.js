'use strict';

const number=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const text=(value,max=160)=>String(value??'').trim().slice(0,max);

function buildSaleFinancialSnapshot(sale={},costs=new Map()){
  const items=Array.isArray(sale.itens)?sale.itens:Array.isArray(sale.items)?sale.items:[];
  if(!items.length)return null;
  let custoTotal=0,missingCosts=0;
  const itemCosts=items.map((item,index)=>{
    const productId=text(item.produtoId||item.productId),variantId=text(item.variantId),key=variantId?`variant:${variantId}`:`product:${productId}`,
      resolved=costs.get(key),custoUnitario=number(resolved?.cost,0),quantidade=Math.max(0,number(item.quantidade??item.quantity,0)),
      lineCost=Number((quantidade*custoUnitario).toFixed(2)),lineRevenue=number(item.subtotalFinal,quantidade*number(item.precoFinalUnitario??item.precoUnitario??item.unitPriceSnapshot,0));
    if(!resolved)missingCosts++;
    custoTotal+=lineCost;
    return{index,productId:productId||null,variantId:variantId||null,custoUnitario,custoTotal:lineCost,lucro:Number((lineRevenue-lineCost).toFixed(2))};
  });
  custoTotal=Number(custoTotal.toFixed(2));
  const revenue=number(sale.valorFinal??sale.valorTotal??sale.total??sale.amount,itemCosts.reduce((sum,item)=>sum+item.custoTotal+item.lucro,0));
  return{
    custoTotal,lucro:Number((revenue-custoTotal).toFixed(2)),itemCosts,
    costResolution:missingCosts?'partial':'complete',missingCostItems:missingCosts,
  };
}

function saleCostService(db,{FieldValue}){
  async function project(businessId,saleId,sale={}){
    const target=db.doc(`businesses/${businessId}/saleFinancials/${saleId}`),existing=await target.get();
    if(existing.exists)return{created:false,skipped:'financial-snapshot-exists'};
    const items=Array.isArray(sale.itens)?sale.itens:Array.isArray(sale.items)?sale.items:[];
    if(!items.length)return{created:false,skipped:'sale-without-items'};
    const descriptors=new Map();
    for(const item of items){
      const productId=text(item.produtoId||item.productId),variantId=text(item.variantId);
      if(variantId)descriptors.set(`variant:${variantId}`,db.doc(`businesses/${businessId}/variantFinancials/${variantId}`));
      else if(productId)descriptors.set(`product:${productId}`,db.doc(`businesses/${businessId}/productFinancials/${productId}`));
    }
    const refs=[...descriptors.values()],snapshots=refs.length?await db.getAll(...refs):[],costs=new Map();
    [...descriptors.keys()].forEach((key,index)=>{const data=snapshots[index]?.data?.();if(snapshots[index]?.exists&&data)costs.set(key,{cost:number(data.cost??data.custo,0)});});
    const financial=buildSaleFinancialSnapshot(sale,costs);
    if(!financial)return{created:false,skipped:'sale-without-items'};
    return db.runTransaction(async transaction=>{
      const current=await transaction.get(target);
      if(current.exists)return{created:false,skipped:'financial-snapshot-exists'};
      transaction.create(target,{
        id:String(saleId),saleId:String(saleId),businessId:String(businessId),...financial,
        actorUid:text(sale.actorUid)||null,source:'server_cost_projection_v1',schemaVersion:1,
        createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
      });
      return{created:true,missingCostItems:financial.missingCostItems};
    });
  }
  return{project};
}

module.exports={buildSaleFinancialSnapshot,saleCostService};
