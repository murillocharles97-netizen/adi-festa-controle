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
  const salvar=d=>{if(window.TeamAccess&&!window.TeamAccess.has('products.edit'))throw window.VeconiPermissionPolicy?.denied('products.edit')||Error('Você não tem permissão para editar produtos.');if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateProduct(),'criar novos produtos');const existente=d.id?obter(d.id):null,barcode=window.normalizeBarcode?.(d.barcode!==undefined?d.barcode:existente?.barcode)||'',barcodeType=barcode?(d.barcodeType||existente?.barcodeType||window.BarcodeIndex?.inferType?.(barcode)||null):null;window.BarcodeIndex?.assertAvailable?.(barcode,d.id);let salvo;DB.alterar(db=>{
    const atual=db.produtos.find(p=>p.id===d.id),agora=new Date().toISOString();
    const v=window.ProductModel.build(d,atual,{agora,barcode,barcodeType,normalizeProductAccess:window.SpaceEngine?.normalizeProductAccess});
    // Validate origin before adding a new positive-stock record. Capture in
    // diffWrites then makes that choice durable; retry never consults the UI.
    if(!atual&&v.productType!=='variable'&&productControlsStock(v)&&Number(v.estoqueAtual)>0)
      window.SpaceContext?.stockMovementOrigin?.(v);
    if(atual){Object.assign(atual,v);salvo=atual}else{salvo={id:d.id||Utils.uuid(),...v,criadoEm:agora};db.produtos.push(salvo)}
  });window.BarcodeIndex?.invalidate?.();return salvo};
  const excluir=id=>{if(!window.ProductActions)throw Error('Aguarde o carregamento das ações de produtos.');return window.ProductActions.perform(id,'delete')};
  const entrada=(produtoId,quantidade,custoUnitario,observacao,spaceId='')=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw window.VeconiPermissionPolicy?.denied('inventory.adjust')||Error('Você não tem permissão para ajustar estoque.');let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const origin=window.SpaceContext?.stockMovementOrigin?.(p,spaceId);
    const q=Number(quantidade||0);if(q<=0)throw Error('Informe uma quantidade valida');
    const anterior=Number(p.estoqueAtual||0),novo=anterior+q,agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(custoUnitario!==''&&custoUnitario!==null&&custoUnitario!==undefined)p.custo=Number(custoUnitario);
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'entrada',quantidade:q,estoqueAnterior:anterior,estoqueNovo:novo,custoUnitario:custoUnitario===''||custoUnitario===null||custoUnitario===undefined?null:Number(custoUnitario),observacao:observacao||'',data:agora,...(origin||{}),...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const ajustarEstoque=(produtoId,novoEstoque,motivo,spaceId='')=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw Error('Você não tem permissão para ajustar estoque.');let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const origin=window.SpaceContext?.stockMovementOrigin?.(p,spaceId);
    const anterior=Number(p.estoqueAtual||0),novo=Number(novoEstoque||0),agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'ajuste',quantidade:novo-anterior,estoqueAnterior:anterior,estoqueNovo:novo,observacao:motivo||'',data:agora,...(origin||{}),...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);
  });return mov};
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
  return{listar,obter,salvar,excluir,entrada,ajustarEstoque,historico,status,favoritar,toggleMobileFavorite,mobileFavoriteValue,renderMobileFavoriteChanges,disponivelNoEspaco:(product,spaceId)=>window.productAllowsSpace(product,spaceId),isVariable:p=>window.ProductVariations?.isVariable?.(p)??p?.productType==='variable',isRecurring:p=>p?.productType==='recurring',isService:p=>p?.itemKind==='service',variacoes:id=>window.ProductVariations?.list(id)||[]};
})();
