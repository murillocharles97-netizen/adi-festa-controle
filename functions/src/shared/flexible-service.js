/* Pure service arithmetic, shared by the PDV and its transactional validator. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FlexibleService=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const pricingModels=['fixed','sale','km','hour'],costModels=['fixed','km','hour','fuel'];
  function number(value,label,max=1000000){
    const n=Number(value??0);
    if(!Number.isFinite(n)||n<0||n>max)throw Error(`${label}: informe um valor válido.`);
    return n;
  }
  const money=n=>Math.round((n+Number.EPSILON)*100)/100;
  const enabled=p=>p?.itemKind==='service'&&p?.productType!=='recurring'&&!p?.hasVariations&&p?.productType!=='variable'&&p?.serviceConfig?.version===1;
  function config(value){
    if(!value||value.version!==1||!pricingModels.includes(value.pricingModel)||!/^[a-zA-Z0-9_-]{8,100}$/.test(value.id||''))throw Error('Configuração de serviço inválida.');
    if(value.calculationVersion!==undefined&&value.calculationVersion!==2)throw Error('Versão de cálculo do serviço inválida.');
    return{version:1,id:value.id,pricingModel:value.pricingModel,...(value.requiresKm?{requiresKm:true}:{}),...(value.requiresMinutes?{requiresMinutes:true}:{}),...(value.calculationVersion===2?{calculationVersion:2}:{})};
  }
  function costConfig(value){
    if(!value||!costModels.includes(value.model))throw Error('Modelo de custo inválido.');
    if(value.model==='fuel'||value.fuel){
      if(value.model!=='fuel'&&value.model!=='km')throw Error('Combustível exige custo por deslocamento.');
      const input=value.fuel||value,kmPerLiter=number(input.kmPerLiter,'Consumo médio (km/L)',10000),pricePerLiter=money(number(input.pricePerLiter,'Preço por litro'));
      if(kmPerLiter<.01)throw Error('Consumo médio: informe pelo menos 0,01 km/L.');
      if(input.pricePerLiter===undefined||input.pricePerLiter===null||input.pricePerLiter==='')throw Error('Informe o preço do combustível por litro.');
      if(value.fuel?.version!==undefined&&value.fuel.version!==1)throw Error('Configuração de combustível inválida.');
      // Keep a legacy-readable km rate. It is never used for the fuel calculation.
      return{model:'km',rate:money(pricePerLiter/kmPerLiter),feePercent:number(value.feePercent,'Taxa percentual',100),fuel:{version:1,kmPerLiter,pricePerLiter}};
    }
    return{model:value.model,rate:money(number(value.rate,'Custo')),feePercent:number(value.feePercent,'Taxa percentual',100)};
  }
  function execution(value){
    if(!value||value.version!==1||!value.id||!/^[a-zA-Z0-9_-]{8,100}$/.test(value.id)||!/^[a-zA-Z0-9_-]{8,100}$/.test(value.configurationId||''))throw Error('Confira a execução do serviço antes de vender.');
    if(!['particular','aplicativo','outro',''].includes(value.source??''))throw Error('Origem do serviço inválida.');
    let pricingSnapshot;
    if(value.pricingSnapshot){if(!pricingModels.includes(value.pricingSnapshot.model))throw Error('Modelo de preço original inválido.');pricingSnapshot={model:value.pricingSnapshot.model,rate:number(value.pricingSnapshot.rate,'Tarifa original')};}
    if(value.calculationVersion!==undefined&&value.calculationVersion!==2)throw Error('Versão de cálculo da execução inválida.');
    return{version:1,id:value.id,configurationId:value.configurationId,...(pricingSnapshot?{pricingSnapshot}:{}),km:number(value.km,'Quilômetros',100000),minutes:number(value.minutes,'Duração',525600),source:value.source||'',...(value.calculationVersion===2?{calculationVersion:2}:{})};
  }
  function factor(model,e){return model==='km'?e.km:model==='hour'?e.minutes/60:1;}
  function suggestedPrice(c,rate,e){config(c);const n=number(rate,'Preço');if(c.pricingModel==='sale')return null;return money(n*factor(c.pricingModel,e));}
  function estimate(c,e,finalCharge,additionalCosts=0){
    c=costConfig(c);e=execution(e);
    const charge=money(number(finalCharge,'Valor cobrado')),liters=c.fuel?e.km/c.fuel.kmPerLiter:0;
    const base=money(c.fuel?liters*c.fuel.pricePerLiter:c.rate*factor(c.model,e)),fee=money(charge*c.feePercent/100),extra=money(number(additionalCosts,'Custos adicionais'));
    const precision=n=>Math.round(n*1000000)/1000000;
    return{version:1,configuration:c,additionalCosts:extra,baseCost:base,feeCost:fee,estimatedCost:money(base+fee+extra),basis:'estimate_not_cash_expense',
      ...(c.fuel?{fuel:{version:1,km:e.km,kmPerLiter:c.fuel.kmPerLiter,pricePerLiter:c.fuel.pricePerLiter,costPerKm:precision(c.fuel.pricePerLiter/c.fuel.kmPerLiter),litersEstimated:precision(liters),estimatedCost:base,chargedAmount:charge,revenuePerKm:e.km?precision(charge/e.km):null,revenueAfterFuel:money(charge-base)}}:{})};
  }
  function assertUsage(c,cost,e){
    if(cost?.fuel&&e.calculationVersion!==2)throw Error('Atualize a VECONI para calcular combustível com segurança. A operação original foi preservada.');
    if((c.requiresKm||c.pricingModel==='km'||cost?.model==='km')&&e.km<=0)throw Error('Informe os quilômetros percorridos.');
    if((c.requiresMinutes||c.pricingModel==='hour'||cost?.model==='hour')&&e.minutes<=0)throw Error('Informe a duração em minutos.');
  }
  function beneficiaryName(value){
    if(value===undefined||value===null)return '';
    if(typeof value!=='string')throw Error('Informe somente o nome do cliente atendido.');
    const name=value.normalize('NFC').replace(/\s+/g,' ').trim();
    if(name.length>160||/[\u0000-\u001f\u007f]/.test(name))throw Error('Cliente atendido: use um nome com até 160 caracteres.');
    return name;
  }
  function itemKey(i){return i?.serviceExecution?`${i.produtoId}::service::${i.serviceExecution.id}`:null;}
  function metrics(sales){let services=0,km=0,minutes=0;for(const s of sales||[]){if(s.deletedAt||s.active===false||['cancelado','cancelled'].includes(s.status))continue;for(const i of s.itens||[]){if(!i.serviceExecution)continue;services+=Number(i.quantidade||1);km+=Number(i.serviceExecution.km||0);minutes+=Number(i.serviceExecution.minutes||0);}}return{services,km,minutes};}
  return Object.freeze({enabled,config,costConfig,execution,suggestedPrice,estimate,assertUsage,beneficiaryName,itemKey,metrics,money});
});
