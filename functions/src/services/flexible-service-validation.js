'use strict';
const M=require('../shared/flexible-service');
const {buildSaleFinancialSnapshot}=require('./sale-cost-service');
const {HttpsError}=require('firebase-functions/v2/https');

// Reads and buffered writes use the SAME transaction as the original sale.
// No queue/replay endpoint and no financial expense is introduced here.
async function validateFlexibleServices({c,writes,plan,get,ref,FieldValue}){
  const old=async(col,id)=>(await get(ref(c.bid,col,id))).data();
  const pending=(col,id)=>plan.get(ref(c.bid,col,id).path);
  const effective=async(col,id)=>{const a=await old(col,id),b=pending(col,id)?.data;return{...a,...b,serviceCostConfigs:{...a?.serviceCostConfigs,...b?.serviceCostConfigs}};};
  const fail=message=>{throw new HttpsError('failed-precondition',message);};
  for(const w of writes.filter(w=>w.entityType==='sales'&&w.operation!=='create'&&Object.hasOwn(w.data||{},'serviceBeneficiaryName'))){
    const previous=await old('sales',w.entityId);
    if(w.data.serviceBeneficiaryName!==previous?.serviceBeneficiaryName)fail('O cliente atendido original da venda não pode ser reescrito.');
  }
  for(const w of writes.filter(w=>w.entityType==='products'&&w.operation!=='delete')){
    const previous=await old('products',w.entityId),product={...previous,...w.data};
    if(previous?.serviceConfig&&!M.enabled(product))fail('Este item já usa execuções de serviço. Cadastre outro item para produto físico, variação ou renovação.');
    if(!product.serviceConfig)continue;
    try{M.config(product.serviceConfig);}catch(e){fail(e.message);}
    if(!M.enabled(product))fail('A execução flexível é exclusiva de serviços simples, sem variações ou renovação.');
    if(previous?.serviceConfig&&!w.data.serviceCostConfig&&['preco','custo'].some(k=>Object.hasOwn(w.data,k)&&Number(w.data[k])!==Number(previous[k]??0)))fail('Atualize o aplicativo para alterar preços ou custos deste serviço.');
    if(w.data.serviceCostConfig){
      if(!c.has('cost.view'))fail('Configuração de custos exige autorização.');
      const config=M.costConfig(w.data.serviceCostConfig),financial=await old('productFinancials',w.entityId),saved=financial?.serviceCostConfigs?.[product.serviceConfig.id];
      if((config.fuel||previous?.serviceConfig?.calculationVersion===2)&&w.data.serviceConfig?.calculationVersion!==2)fail('Atualize a VECONI para alterar a configuração deste serviço com segurança.');
      if(saved&&(JSON.stringify(M.costConfig(saved))!==JSON.stringify(config)||saved.pricingModel&&saved.pricingModel!==product.serviceConfig.pricingModel||saved.priceRate!==undefined&&Number(saved.priceRate)!==Number(product.preco)))fail('Uma configuração já utilizada não pode ser reescrita. Salve uma nova versão.');
      // Persist the private version even when a delta contains no numeric custo.
      // Use the merged public product for unchanged tariff fields, never write.before.
      const target=ref(c.bid,'productFinancials',w.entityId),buffered=plan.get(target.path);
      plan.set(target.path,{ref:target,data:{...buffered?.data,id:w.entityId,productId:w.entityId,businessId:c.bid,
        serviceCostConfigs:{...buffered?.data?.serviceCostConfigs,[product.serviceConfig.id]:{...config,pricingModel:product.serviceConfig.pricingModel,priceRate:Number(product.preco||0)}},
        updatedByUid:c.uid,updatedAt:FieldValue.serverTimestamp(),schemaVersion:1}});
    }else if(product.serviceConfig.id!==previous?.serviceConfig?.id)fail('A nova configuração precisa de seu snapshot de custo autorizado.');
  }
  // Guard explicit writes to private configuration maps as well as catalog writes.
  for(const w of writes.filter(w=>w.entityType==='productFinancials'&&Object.hasOwn(w.data||{},'serviceCostConfigs'))){
    if(!w.data.serviceCostConfigs||typeof w.data.serviceCostConfigs!=='object'||Array.isArray(w.data.serviceCostConfigs)||!Object.keys(w.data.serviceCostConfigs).length)fail('Snapshots de custo existentes são imutáveis.');
    const previous=await old('productFinancials',w.entityId);
    for(const [id,value] of Object.entries(w.data.serviceCostConfigs)){
      const config=M.costConfig(value),saved=previous?.serviceCostConfigs?.[id];
      if(saved&&(JSON.stringify(M.costConfig(saved))!==JSON.stringify(config)||saved.pricingModel!==value.pricingModel||saved.priceRate!==value.priceRate))fail('Snapshots de custo existentes são imutáveis.');
    }
  }
  for(const w of writes.filter(w=>w.entityType==='sales'&&w.operation==='create')){
    const items=w.data.itens||[],serviceItems=items.filter(i=>i.serviceExecution);
    if(Object.hasOwn(w.data,'serviceBeneficiaryName')){
      let name;try{name=M.beneficiaryName(w.data.serviceBeneficiaryName);}catch(error){fail(error.message);}
      if(!name||name!==w.data.serviceBeneficiaryName||!serviceItems.length)fail('O atendido deve ser um nome válido de uma execução de serviço; o cliente financeiro não será substituído.');
    }
    for(const i of items){
      const p=await effective('products',i.produtoId||i.productId);
      if(M.enabled(p)&&!i.serviceExecution)fail('Atualize o aplicativo para registrar a execução deste serviço. A venda original foi preservada.');
      if(i.serviceExecution&&!M.enabled(p))fail('Este produto não autoriza execução flexível de serviço.');
    }
    if(!serviceItems.length)continue;
    const costs=new Map(),ids=new Set();
    for(const i of items){
      const pid=i.produtoId||i.productId,vid=i.variantId,metadata=await effective(vid?'variantFinancials':'productFinancials',vid||pid);
      if(!i.serviceExecution){if('custo' in metadata||'cost' in metadata)costs.set(vid?`variant:${vid}`:`product:${pid}`,{cost:Number(metadata.cost??metadata.custo)});continue;}
      let e;try{e=M.execution(i.serviceExecution);}catch(error){fail(error.message);}
      if(Number(i.quantidade??i.quantity)!==1||ids.has(e.id))fail('Cada execução de serviço deve ser única e ter quantidade 1.');ids.add(e.id);
      const config=metadata.serviceCostConfigs?.[e.configurationId];
      if(!config)fail('Configuração original de custo indisponível. Preserve esta venda para conferência; ela não foi recalculada.');
      if(e.pricingSnapshot&&(e.pricingSnapshot.model!==config.pricingModel||config.priceRate===undefined||Number(e.pricingSnapshot.rate)!==Number(config.priceRate)))fail('A tarifa original diverge da configuração autorizada.');
      const p=await effective('products',pid);
      // An older configuration may be queued offline; its immutable cost is retained.
      try{M.assertUsage({pricingModel:config.pricingModel||p.serviceConfig.pricingModel},config,e);}catch(error){fail(error.message);}
      const input=i.serviceCostSnapshot;
      if(input&&!c.has('cost.view'))fail('Custos adicionais exigem autorização.');
      const charge=Number(i.precoFinalUnitario??i.precoUnitario??i.unitPriceSnapshot),snapshot=M.estimate(config,e,charge,input?.additionalCosts||0);
      if(input&&JSON.stringify(M.costConfig(input.configuration))!==JSON.stringify(M.costConfig(config)))fail('O custo original da execução diverge da configuração autorizada.');
      costs.set(`service:${e.id}`,{cost:snapshot.estimatedCost,serviceCostSnapshot:snapshot});
    }
    const sale=pending('sales',w.entityId);if(!sale)fail('Venda de serviço sem plano transacional.');
    if(await old('saleFinancials',w.entityId))fail('Já existe um snapshot financeiro para esta identidade. Preserve a venda para conferência.');
    sale.data.itens=sale.data.itens.map(i=>i.serviceExecution?{...i,serviceExecution:M.execution(i.serviceExecution)}:i);
    const financial=buildSaleFinancialSnapshot({...w.data,...sale.data},costs),target=ref(c.bid,'saleFinancials',w.entityId);
    plan.set(target.path,{ref:target,data:{id:w.entityId,saleId:w.entityId,businessId:c.bid,...financial,source:'server_service_snapshot_v1',actorUid:c.uid,workspaceGeneration:c.business.workspaceGeneration??0,schemaVersion:1,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()}});
  }
}
module.exports={validateFlexibleServices};
