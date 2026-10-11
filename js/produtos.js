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
  const salvar=d=>{if(window.TeamAccess&&!window.TeamAccess.has('products.edit'))throw Error('Você não tem permissão para editar produtos.');if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateProduct(),'criar novos produtos');const existente=d.id?obter(d.id):null,barcode=window.normalizeBarcode?.(d.barcode!==undefined?d.barcode:existente?.barcode)||'',barcodeType=barcode?(d.barcodeType||existente?.barcodeType||window.BarcodeIndex?.inferType?.(barcode)||null):null;window.BarcodeIndex?.assertAvailable?.(barcode,d.id);let salvo;DB.alterar(db=>{
    const atual=db.produtos.find(p=>p.id===d.id),agora=new Date().toISOString();
    const v=window.ProductModel.build(d,atual,{agora,barcode,barcodeType,normalizeProductAccess:window.SpaceEngine?.normalizeProductAccess});
    if(atual){Object.assign(atual,v);salvo=atual}else{salvo={id:d.id||Utils.uuid(),...v,criadoEm:agora};db.produtos.push(salvo)}
  });window.BarcodeIndex?.invalidate?.();return salvo};
  const excluir=id=>{const result=DB.alterar(db=>{db.produtos=db.produtos.filter(p=>p.id!==id);db.variacoesProdutos=(db.variacoesProdutos||[]).filter(v=>v.parentProductId!==id)});window.BarcodeIndex?.invalidate?.();return result};
  const entrada=(produtoId,quantidade,custoUnitario,observacao)=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw Error('Você não tem permissão para ajustar estoque.');let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const q=Number(quantidade||0);if(q<=0)throw Error('Informe uma quantidade valida');
    const anterior=Number(p.estoqueAtual||0),novo=anterior+q,agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(custoUnitario!==''&&custoUnitario!==null&&custoUnitario!==undefined)p.custo=Number(custoUnitario);
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'entrada',quantidade:q,estoqueAnterior:anterior,estoqueNovo:novo,custoUnitario:custoUnitario===''||custoUnitario===null||custoUnitario===undefined?null:Number(custoUnitario),observacao:observacao||'',data:agora,...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const ajustarEstoque=(produtoId,novoEstoque,motivo)=>{if(window.TeamAccess&&!window.TeamAccess.has('inventory.adjust'))throw Error('Você não tem permissão para ajustar estoque.');let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(!productControlsStock(p))throw Error('Este produto não usa controle de estoque');
    const anterior=Number(p.estoqueAtual||0),novo=Number(novoEstoque||0),agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'ajuste',quantidade:novo-anterior,estoqueAnterior:anterior,estoqueNovo:novo,observacao:motivo||'',data:agora,...(window.TeamAccess?.actor?.()||{})};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const historico=produtoId=>DB.carregar().movimentacoesEstoque.filter(m=>m.produtoId===produtoId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const favoritar=(id,value)=>DB.alterar(db=>{const product=db.produtos.find(p=>p.id===id);if(!product)throw Error('Produto não encontrado');product.favorito=value===undefined?!product.favorito:Boolean(value);product.atualizadoEm=new Date().toISOString()});
  return{listar,obter,salvar,excluir,entrada,ajustarEstoque,historico,status,favoritar,disponivelNoEspaco:(product,spaceId)=>window.productAllowsSpace(product,spaceId),isVariable:p=>window.ProductVariations?.isVariable?.(p)??p?.productType==='variable',isRecurring:p=>p?.productType==='recurring',isService:p=>p?.itemKind==='service',variacoes:id=>window.ProductVariations?.list(id)||[]};
})();
