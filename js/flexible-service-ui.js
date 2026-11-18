(function(){
  'use strict';
  const M=window.FlexibleService,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),cash=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const canCost=()=>window.TeamAccess?.has?.('cost.view')===true;
  const scope=()=>JSON.stringify([DB.getBusinessId(),DB.getPrincipal?.(),DB.getWorkspaceGeneration?.(),window.SpaceContext?.salesId?.(),window.SpaceContext?.activeId?.(),window.TeamAccess?.captureSession?.()||window.BusinessContext?.get?.().permissionSignature]);
  function fields(product={}){
    const c=product.serviceConfig||{},cost=product.serviceCostConfig||{model:'fixed',rate:product.custo||0,feePercent:0};
    const options=(items,current)=>items.map(([id,label])=>`<option value="${id}" ${id===current?'selected':''}>${label}</option>`).join('');
    return `<section class="product-form-section" data-service-config hidden><header><i data-lucide="briefcase-business"></i><div><b>Execução do serviço</b><small>Valores estimados; não criam despesas no caixa.</small></div></header><div class="form-grid"><label class="field">Modelo de preço<select name="servicePricingModel">${options([['fixed','Preço fixo'],['sale','Preço definido na venda'],['km','Preço por km'],['hour','Preço por hora']],c.pricingModel||'fixed')}</select><small>Use o campo Preço de venda para o valor fixo ou a tarifa.</small></label>${canCost()?`<label class="field">Modelo de custo<select name="serviceCostModel">${options([['fixed','Custo fixo'],['km','Custo por km'],['hour','Custo por hora']],cost.model)}</select><small>Use Custo unitário para o valor fixo ou a tarifa.</small></label><label class="field">Taxa estimada (%)<input name="serviceFeePercent" type="number" min="0" max="100" step=".01" value="${esc(cost.feePercent)}"></label>`:'<p class="muted">A configuração de custos é reservada ao responsável autorizado.</p>'}</div></section>`;
  }
  function readConfig(form,product={}){
    if(form.elements.itemKind.value!=='service'||product.productType==='recurring'||product.hasVariations)return{};
    if(!canCost()){
      if(!product.serviceConfig)return{};
      if(form.elements.servicePricingModel.value!==product.serviceConfig.pricingModel)throw Error('Peça ao responsável para alterar a configuração deste serviço.');
      return{serviceConfig:product.serviceConfig};
    }
    const cost=M.costConfig({model:form.elements.serviceCostModel.value,rate:form.elements.custo.value,feePercent:form.elements.serviceFeePercent.value}),pricingModel=form.elements.servicePricingModel.value;
    const same=product.serviceConfig?.pricingModel===pricingModel&&JSON.stringify(product.serviceCostConfig?M.costConfig(product.serviceCostConfig):null)===JSON.stringify(cost)&&Number(product.preco)===Number(form.elements.preco.value);
    return{serviceConfig:M.config({version:1,id:same?product.serviceConfig.id:Utils.uuid(),pricingModel,requiresKm:pricingModel==='km'||cost.model==='km',requiresMinutes:pricingModel==='hour'||cost.model==='hour'}),serviceCostConfig:cost};
  }
  function open(product,item,onDone){
    if(!M.enabled(product))return false;
    const root=document.querySelector('#modal');if(!root){Utils.toast('Não foi possível abrir o serviço. Reabra a tela Vender.',true);return false;}
    const identity=scope(),id=Utils.uuid(),cost=canCost()?product.serviceCostConfig:null;
    const initial={version:1,id,configurationId:product.serviceConfig.id,pricingSnapshot:{model:product.serviceConfig.pricingModel,rate:Number(product.preco||0)},km:0,minutes:0,source:''};
    root.innerHTML=`<div class="modal-bg"><section class="modal-box flexible-service-modal"><header class="modal-head"><div><small>Registrar execução</small><h3>${esc(product.nome)}</h3></div><button type="button" class="icon-btn" data-close-service aria-label="Fechar">×</button></header><form><div class="modal-body"><p class="muted">Uma execução por item. Cliente e pagamento são escolhidos no carrinho.</p><div class="form-grid"><label class="field">Quilômetros percorridos<input name="km" type="number" min="0" max="100000" step=".01" inputmode="decimal" value="0"></label><label class="field">Duração (minutos)<input name="minutes" type="number" min="0" max="525600" step="1" inputmode="decimal" value="0"></label><label class="field full">Valor final cobrado (R$)<input name="charge" type="number" required min="0" max="1000000" step=".01" inputmode="decimal" value="${product.serviceConfig.pricingModel==='sale'?'':Number(product.preco||0)}"><small data-service-suggestion></small></label>${canCost()?'<label class="field">Custos adicionais estimados (R$)<input name="extra" type="number" min="0" max="1000000" step=".01" inputmode="decimal" value="0"></label>':''}<label class="field">Origem (opcional)<select name="source"><option value="">Não informada</option><option value="particular">Particular</option><option value="aplicativo">Aplicativo</option><option value="outro">Outro</option></select></label></div><p data-service-cost class="muted"></p><p role="alert" data-service-error></p></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-close-service>Cancelar</button><button class="btn btn-primary">Adicionar serviço</button></footer></form></section></div>`;
    const form=root.querySelector('form'),f=form.elements;let manual=false;
    const current=()=>root.contains(form)&&scope()===identity;
    const close=()=>{if(root.contains(form))root.innerHTML='';};
    root.querySelectorAll('[data-close-service]').forEach(b=>b.onclick=close);
    const values=()=>M.execution({...initial,km:f.km.value,minutes:f.minutes.value,source:f.source.value});
    const update=()=>{try{const e=values(),suggested=M.suggestedPrice(product.serviceConfig,product.preco,e);if(!manual&&suggested!==null)f.charge.value=suggested.toFixed(2);root.querySelector('[data-service-suggestion]').textContent=suggested===null?'Informe o valor efetivamente combinado.':`Sugestão: ${cash(suggested)}. Você pode ajustar o valor final.`;root.querySelector('[data-service-cost]').textContent=cost?`Custo estimado: ${cash(M.estimate(cost,e,f.charge.value,f.extra?.value).estimatedCost)} · não movimenta o caixa.`:'';}catch(e){root.querySelector('[data-service-error]').textContent=e.message;}};
    f.charge.oninput=()=>{manual=true;update();};f.km.oninput=f.minutes.oninput=()=>{manual=false;update();};if(f.extra)f.extra.oninput=update;
    form.onsubmit=event=>{event.preventDefault();try{if(!current())throw Error('A sessão ou o espaço mudou. Reabra o serviço no espaço correto.');const e=values();M.assertUsage(product.serviceConfig,cost,e);const price=Number(f.charge.value),snapshot=cost?M.estimate(cost,e,price,f.extra?.value):null;M.estimate({model:'fixed',rate:0,feePercent:0},e,price);const next={...item,quantidade:1,precoOriginal:price,precoFinalUnitario:price,precoUnitario:price,unitPriceSnapshot:price,serviceExecution:e,...(snapshot?{serviceCostSnapshot:snapshot,custoUnitario:snapshot.estimatedCost,costSnapshot:snapshot.estimatedCost}:{})};if(onDone(next)!==false)close();}catch(e){root.querySelector('[data-service-error]').textContent=e.message;}};
    update();form.querySelector('input')?.focus();return true;
  }
  function summary(item){const e=item.serviceExecution;return e?`<small class="service-line-summary">Serviço · ${e.km?`${esc(e.km)} km · `:''}${e.minutes?`${esc(e.minutes)} min · `:''}${esc(e.source||'Origem não informada')}</small>`:'';}
  const priceLabel=p=>!M.enabled(p)?null:p.serviceConfig.pricingModel==='sale'?'Definir na venda':cash(p.preco)+(p.serviceConfig.pricingModel==='km'?' / km':p.serviceConfig.pricingModel==='hour'?' / hora':'');
  window.FlexibleServiceUI={fields,readConfig,open,summary,priceLabel};
})();
