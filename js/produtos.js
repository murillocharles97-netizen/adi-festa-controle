window.productControlsStock=product=>Boolean(product)&&product.itemKind!=='service'&&!product.semControleEstoque&&product.controlaEstoque!==false;
window.getProductRenewalPeriod=product=>{
  if(product?.productType!=='recurring')return'';
  const value=Math.max(1,Number(product.durationValue||30)),unit={days:value===1?'dia':'dias',weeks:value===1?'semana':'semanas',months:value===1?'mês':'meses',years:value===1?'ano':'anos'}[product.durationUnit]||(value===1?'dia':'dias');
  return`${value} ${unit}`;
};
window.getProductStockMinimum=product=>{
  if(window.ProductVariations?.isVariable?.(product)&&window.ProductVariations?.list){
    const variants=ProductVariations.list(product.id).filter(item=>item.active!==false);
    if(variants.length)return variants.reduce((sum,item)=>sum+Number(item.minStock||0),0);
  }
  return Number(product?.estoqueMinimo||0);
};
window.getProductStockStatus=product=>{
  if(!productControlsStock(product))return'sem-controle';
  const current=Number(window.ProductVariations?.isVariable?.(product)?product?.totalStock:(product?.estoqueAtual??product?.estoque??0)),minimum=getProductStockMinimum(product);
  return current<=0?'esgotado':current<=minimum?'baixo':'disponivel';
};
window.getProductStockTone=product=>{
  if(!productControlsStock(product))return'neutral';
  const current=Number(window.ProductVariations?.isVariable?.(product)?product?.totalStock:(product?.estoqueAtual??product?.estoque??0)),minimum=getProductStockMinimum(product);
  return current<=0?'danger':current<minimum?'danger':current===minimum?'warning':'good';
};
window.productAllowsSpace=(product,spaceId)=>window.SpaceEngine?.productAllowsSpace?SpaceEngine.productAllowsSpace(product,spaceId):true;
window.Produtos=(()=>{
  const listar=()=>DB.carregar().produtos;
  const obter=id=>listar().find(p=>p.id===id);
  const status=p=>getProductStockStatus(p);
  const salvar=d=>{if(window.TeamAccess&&!window.TeamAccess.has('products.edit'))throw window.VeconiPermissionPolicy?.denied('products.edit')||Error('Você não tem permissão para editar produtos.');if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateProduct(),'criar novos produtos');const existente=d.id?obter(d.id):null,normalizedBarcode=window.normalizeBarcode?.(d.barcode!==undefined?d.barcode:existente?.barcode)||'',unchangedBarcode=!!existente&&(window.normalizeBarcode?.(existente.barcode)||'')===normalizedBarcode,barcode=unchangedBarcode?String(existente.barcode??''):normalizedBarcode,barcodeType=barcode?(d.barcodeType||existente?.barcodeType||window.BarcodeIndex?.inferType?.(barcode)||null):null;if(!unchangedBarcode)window.BarcodeIndex?.assertAvailable?.(barcode,d.id);let salvo;DB.alterar(db=>{
    const atual=db.produtos.find(p=>p.id===d.id),agora=new Date().toISOString();
    if(atual){
      const quantidade=Number(atual.estoqueAtual??atual.estoque??0);
      if([d.estoqueAtual,d.estoque].some(value=>value!=null&&Number(value)!==quantidade))
        throw Object.assign(Error('Use Ajustar estoque para alterar a quantidade deste produto.'),{code:'stock-adjustment-required'});
    }
    const v=window.ProductModel.build(d,atual,{agora,barcode,barcodeType,normalizeProductAccess:window.SpaceEngine?.normalizeProductAccess});
    // Marca: atributo próprio. A regra da empresa vale só para cadastro novo; edições mantêm a marca atual.
    const Brand=window.ProductBrand;
    if(!atual){const marca=Brand?Brand.assertNew(d,db.config):String(d.marca??'').trim();if(marca)v.marca=marca}
    else if(d.marca!==undefined)v.marca=Brand?Brand.text(d.marca):String(d.marca).trim();
    // Validate origin before adding a new positive-stock record. Capture in
    // diffWrites then makes that choice durable; retry never consults the UI.
    if(!atual&&v.productType!=='variable'&&productControlsStock(v)&&Number(v.estoqueAtual)>0)
      window.SpaceContext?.stockMovementOrigin?.(v);
    if(atual){
      // The catalog editor must not overwrite inventory projections.
      for(const field of ['estoqueAtual','estoque','totalStock','hasAvailableStock'])delete v[field];
      Object.assign(atual,v);salvo=atual;
    }else{salvo={id:d.id||Utils.uuid(),...v,criadoEm:agora};db.produtos.push(salvo)}
  });window.BarcodeIndex?.invalidate?.();return salvo};
  const excluir=id=>{if(!window.ProductActions)throw Error('Aguarde o carregamento das ações de produtos.');return window.ProductActions.perform(id,'delete')};
  // Shared bodies of entrada/ajustarEstoque, applied inside a caller's DB.alterar.
  function applyEntry(db,produtoId,quantidade,custoUnitario,observacao,spaceId,blockOperationId=''){
    // In a block every movement shares the block's operationId (the server requires it); ids stay unique.
    const operationId=blockOperationId||Utils.uuid(),movementId=blockOperationId?Utils.uuid():operationId;
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const origin=window.SpaceContext?.stockMovementOrigin?.(p,spaceId);
    const q=Number(quantidade||0);if(q<=0)throw Error('Informe uma quantidade valida');
    const anterior=Number(p.estoqueAtual||0),novo=anterior+q,agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(Object.hasOwn(p,'totalStock')&&p.productType!=='variable'&&p.hasVariations!==true)p.totalStock=novo; // D4
    if(custoUnitario!==''&&custoUnitario!==null&&custoUnitario!==undefined)p.custo=Number(custoUnitario);
    const mov={id:movementId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'entrada',quantidade:q,estoqueAnterior:anterior,estoqueNovo:novo,custoUnitario:custoUnitario===''||custoUnitario===null||custoUnitario===undefined?null:Number(custoUnitario),observacao:observacao||'',data:agora,...(origin||{}),...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);return mov;
  }
  function applyAdjust(db,produtoId,novoEstoque,motivo,spaceId,blockOperationId=''){
    const operationId=blockOperationId||Utils.uuid(),movementId=blockOperationId?Utils.uuid():operationId;
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const origin=window.SpaceContext?.stockMovementOrigin?.(p,spaceId);
    const anterior=Number(p.estoqueAtual||0),novo=Number(novoEstoque||0),agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(Object.hasOwn(p,'totalStock')&&p.productType!=='variable'&&p.hasVariations!==true)p.totalStock=novo; // D4
    const mov={id:movementId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'ajuste',quantidade:novo-anterior,estoqueAnterior:anterior,estoqueNovo:novo,observacao:motivo||'',data:agora,...(origin||{}),...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);return mov;
  }
  // Bulk (spreadsheet): up to 25 products in ONE DB.alterar → one Sync operation, atomic
  // locally and on the server (commitOperationalSync validates every write and delta).
  // Catalog fields follow salvar's rules (never stock); entries/adjustments follow the
  // same bodies as entrada/ajustarEstoque.
  const LOTE_MAX=25;
  const aplicarLote=items=>{
    if(!Array.isArray(items)||!items.length||items.length>LOTE_MAX)throw Error(`Informe de 1 a ${LOTE_MAX} produtos por bloco.`);
    const catalog=items.some(i=>i.catalog&&Object.keys(i.catalog).length),stock=items.some(i=>i.entrada||i.ajuste);
    if(catalog&&window.TeamAccess&&!window.TeamAccess.has('products.edit'))throw window.VeconiPermissionPolicy?.denied('products.edit')||Error('Você não tem permissão para editar produtos.');
    if(stock&&window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw window.VeconiPermissionPolicy?.denied('inventory.adjust')||Error('Você não tem permissão para ajustar estoque.');
    if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('Produto repetido no mesmo bloco.');
    const movements=[],blockOperationId=Utils.uuid();
    DB.alterar(db=>{
      const agora=new Date().toISOString();
      for(const item of items){
        const atual=db.produtos.find(p=>p.id===item.id);if(!atual)throw Error('Produto nao encontrado');
        if(item.catalog&&Object.keys(item.catalog).length){
          if(Object.keys(item.catalog).some(k=>!['nome','categoria','preco','custo'].includes(k)))throw Error('Campo não permitido no bloco.');
          const v=window.ProductModel.build({...atual,...item.catalog},atual,{agora,barcode:atual.barcode||'',barcodeType:atual.barcodeType||null,normalizeProductAccess:window.SpaceEngine?.normalizeProductAccess});
          for(const field of ['estoqueAtual','estoque','totalStock','hasAvailableStock'])delete v[field];
          Object.assign(atual,v);
        }
        if(item.entrada)movements.push(applyEntry(db,item.id,item.entrada.quantidade,'',item.entrada.observacao,item.entrada.spaceId,blockOperationId));
        if(item.ajuste)movements.push(applyAdjust(db,item.id,item.ajuste.novoEstoque,item.ajuste.motivo,item.ajuste.spaceId,blockOperationId));
      }
    });
    window.BarcodeIndex?.invalidate?.();
    return movements;
  };
  const entrada=(produtoId,quantidade,custoUnitario,observacao,spaceId='')=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw window.VeconiPermissionPolicy?.denied('inventory.adjust')||Error('Você não tem permissão para ajustar estoque.');let mov;DB.alterar(db=>{mov=applyEntry(db,produtoId,quantidade,custoUnitario,observacao,spaceId);});return mov};
  const ajustarEstoque=(produtoId,novoEstoque,motivo,spaceId='')=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw Error('Você não tem permissão para ajustar estoque.');let mov;DB.alterar(db=>{mov=applyAdjust(db,produtoId,novoEstoque,motivo,spaceId);});return mov};
  const historico=produtoId=>DB.carregar().movimentacoesEstoque.filter(m=>m.produtoId===produtoId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const applyFavorite=(product,value)=>{
    if(!product)throw Error('Produto não encontrado');
    product.favorito=value===undefined?!product.favorito:Boolean(value);
    product.atualizadoEm=new Date().toISOString();
  };
  const favoritar=(id,value)=>DB.alterar(db=>applyFavorite(db.produtos.find(p=>p.id===id),value));
  let favoriteFrame=null;
  const favoriteScope=()=>JSON.stringify([DB.getBusinessId?.(),DB.getPrincipal?.(),DB.getWorkspaceGeneration?.(),window.TeamAccess?.captureSession?.()]);
  const mobileFavoriteValue=product=>{
    const frame=favoriteFrame;
    return (frame&&frame.scope===favoriteScope()?frame.values.get(product.id):undefined)??Boolean(product.favorito);
  };
  function paintMobileFavorite(id,value){
    const key=CSS.escape(String(id));
    document.querySelectorAll(`.mobile-card-favorite[data-product-favorite="${key}"],.mobile-card-favorite[data-fav="${key}"]`).forEach(button=>{
      button.classList.toggle('active',value);
      button.classList.add('show');
      button.setAttribute('aria-pressed',String(value));
      button.setAttribute('aria-label',value?'Remover dos favoritos':'Adicionar aos favoritos');
    });
  }
  function persistMobileFavorites(frame){
    if(favoriteFrame!==frame)return;
    favoriteFrame=null;
    clearTimeout(frame.fallback);
    if(frame.scope!==favoriteScope())return;
    const changes=[];
    try{
      const products=new Map(listar().map(product=>[product.id,product]));
      for(const [id,value] of frame.values){
        const product=products.get(id);
        if(!product)continue;
        const previous=Boolean(product.favorito);
        if(previous!==value)changes.push({id,previous,value});
      }
      if(changes.length&&!window.SyncFirebase?.saveProductFavorites?.(changes))DB.alterar(db=>{
        const updates=new Map(changes.map(change=>[change.id,change.value]));
        for(const product of db.produtos)if(updates.has(product.id))applyFavorite(product,updates.get(product.id));
      });
    }catch(error){
      if(frame.scope!==favoriteScope())return;
      for(const id of frame.values.keys())paintMobileFavorite(id,Boolean(obter(id)?.favorito));
      Utils.toast(error.message||'Não foi possível atualizar Favoritos.',true);
      return;
    }
    if(frame.scope!==favoriteScope())return;
    for(const [id,value] of frame.values)paintMobileFavorite(id,value);
    if(changes.length)window.dispatchEvent(new CustomEvent('mobile-product-favorites-updated',{detail:changes}));
  }
  function renderMobileFavoriteChanges(changes){
    const pendingValues=favoriteFrame?.scope===favoriteScope()?favoriteFrame?.values:null;
    for(const {id,value} of changes){
      const pending=pendingValues?.get(id);
      paintMobileFavorite(id,pending??value);
    }
    if(changes.length)window.dispatchEvent(new CustomEvent('mobile-product-favorites-updated',{detail:changes}));
  }
  function toggleMobileFavorite(id){
    const product=obter(id);
    if(!product)return;
    const scope=favoriteScope(),value=!mobileFavoriteValue(product);
    if(favoriteFrame?.scope!==scope){
      const frame={scope,values:new Map()};
      favoriteFrame=frame;
      const persist=()=>persistMobileFavorites(frame);
      // Let the optimistic star paint before the existing local transaction.
      window.requestAnimationFrame?.(()=>window.requestAnimationFrame(persist));
      frame.fallback=setTimeout(persist,150);
    }
    favoriteFrame.values.set(id,value);
    paintMobileFavorite(id,value);
  }
  if(window.addEventListener)window.addEventListener('pagehide',()=>{if(favoriteFrame)persistMobileFavorites(favoriteFrame);});
  return{listar,obter,salvar,excluir,entrada,ajustarEstoque,aplicarLote,LOTE_MAX,historico,status,favoritar,toggleMobileFavorite,mobileFavoriteValue,renderMobileFavoriteChanges,disponivelNoEspaco:(product,spaceId)=>window.productAllowsSpace(product,spaceId),isVariable:p=>window.ProductVariations?.isVariable?.(p)??p?.productType==='variable',isRecurring:p=>p?.productType==='recurring',isService:p=>p?.itemKind==='service',variacoes:id=>window.ProductVariations?.list(id)||[]};
})();
