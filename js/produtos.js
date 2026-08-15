window.getProductStockMinimum=product=>{
  if(window.ProductVariations?.isVariable?.(product)&&window.ProductVariations?.list){
    const variants=ProductVariations.list(product.id).filter(item=>item.active!==false);
    if(variants.length)return variants.reduce((sum,item)=>sum+Number(item.minStock||0),0);
  }
  return Number(product?.estoqueMinimo||0);
};
window.getProductStockStatus=product=>{
  if(product?.semControleEstoque||product?.controlaEstoque===false)return'sem-controle';
  const current=Number(window.ProductVariations?.isVariable?.(product)?product?.totalStock:(product?.estoqueAtual??product?.estoque??0)),minimum=getProductStockMinimum(product);
  return current<=0?'esgotado':current<=minimum?'baixo':'disponivel';
};
window.getProductStockTone=product=>{
  if(product?.semControleEstoque||product?.controlaEstoque===false)return'neutral';
  const current=Number(window.ProductVariations?.isVariable?.(product)?product?.totalStock:(product?.estoqueAtual??product?.estoque??0)),minimum=getProductStockMinimum(product);
  return current<=0?'danger':current<minimum?'danger':current===minimum?'warning':'good';
};
window.Produtos=(()=>{
  const listar=()=>DB.carregar().produtos;
  const obter=id=>listar().find(p=>p.id===id);
  const status=p=>getProductStockStatus(p);
  const salvar=d=>{if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateProduct(),'criar novos produtos');const existente=d.id?obter(d.id):null,barcode=window.normalizeBarcode?.(d.barcode!==undefined?d.barcode:existente?.barcode)||'',barcodeType=barcode?(d.barcodeType||existente?.barcodeType||window.BarcodeIndex?.inferType?.(barcode)||null):null;window.BarcodeIndex?.assertAvailable?.(barcode,d.id);let salvo;DB.alterar(db=>{
    const atual=db.produtos.find(p=>p.id===d.id),agora=new Date().toISOString(),barcodeChanged=String(atual?.barcode||'')!==barcode;
    const estoque=d.estoqueAtual??d.estoque;
    const imageField=(name,fallback=null)=>d[name]!==undefined?d[name]:(atual?.[name]??fallback);
    const requestedType=d.productType??atual?.productType,productType=['variable','recurring'].includes(requestedType)?requestedType:'simple',hasVariations=productType==='variable'||Boolean(d.hasVariations??atual?.hasVariations),recurring=productType==='recurring',controlsStock=recurring?Boolean(d.controlaEstoque??(d.semControleEstoque===undefined?atual?.controlaEstoque:false)):!Boolean(d.semControleEstoque===undefined?atual?.semControleEstoque:d.semControleEstoque);
    const v={nome:String(d.nome||'').trim(),productType,hasVariations,attributes:Array.isArray(d.attributes)?d.attributes:(atual?.attributes||[]),durationValue:recurring?Math.max(1,Number(d.durationValue??atual?.durationValue??30)):null,durationUnit:recurring&&['days','weeks','months','years'].includes(d.durationUnit??atual?.durationUnit)?(d.durationUnit??atual?.durationUnit):(recurring?'days':null),renewalLabel:recurring?String(d.renewalLabel??atual?.renewalLabel??d.nome??'').trim():'',renewalMessage:recurring?String(d.renewalMessage??atual?.renewalMessage??'').trim():'',renewalReminders:recurring&&Array.isArray(d.renewalReminders)?d.renewalReminders:(atual?.renewalReminders||[]),codigo:d.codigo??atual?.codigo??'',barcode,barcodeType,barcodeUpdatedAt:barcodeChanged?agora:(atual?.barcodeUpdatedAt||null),alternateBarcodes:Array.isArray(atual?.alternateBarcodes)?atual.alternateBarcodes:[],preco:hasVariations?Number(d.minPrice??atual?.minPrice??d.preco??0):Number(d.preco||0),minPrice:Number(d.minPrice??atual?.minPrice??d.preco??0),maxPrice:Number(d.maxPrice??atual?.maxPrice??d.preco??0),custo:d.custo===''||d.custo===null?null:Number(d.custo??atual?.custo??0),estoqueAtual:hasVariations?Number(d.totalStock??atual?.totalStock??0):(estoque===''||estoque===null||estoque===undefined?0:Number(estoque)),totalStock:Number(d.totalStock??atual?.totalStock??estoque??0),activeVariationCount:Number(d.activeVariationCount??atual?.activeVariationCount??0),hasAvailableStock:Boolean(d.hasAvailableStock??atual?.hasAvailableStock),estoqueMinimo:Number(d.estoqueMinimo||0),categoria:d.categoria||'',observacao:d.observacao??atual?.observacao??'',semControleEstoque:!controlsStock,controlaEstoque:controlsStock,favorito:Boolean(d.favorito??atual?.favorito),ativo:d.ativo!==false,image:imageField('image'),imageMode:imageField('imageMode','own'),imagem:imageField('imagem',''),imageUrl:imageField('imageUrl'),imageStoragePath:imageField('imageStoragePath'),imageThumbUrl:imageField('imageThumbUrl'),imageThumbStoragePath:imageField('imageThumbStoragePath'),imageUpdatedAt:imageField('imageUpdatedAt'),imageUploadStatus:imageField('imageUploadStatus','none'),imageOperationId:imageField('imageOperationId'),schemaVersion:13,atualizadoEm:agora};
    v.estoque=v.estoqueAtual;
    if(atual){Object.assign(atual,v);salvo=atual}else{salvo={id:d.id||Utils.uuid(),...v,criadoEm:agora};db.produtos.push(salvo)}
  });window.BarcodeIndex?.invalidate?.();return salvo};
  const excluir=id=>{const result=DB.alterar(db=>{db.produtos=db.produtos.filter(p=>p.id!==id);db.variacoesProdutos=(db.variacoesProdutos||[]).filter(v=>v.parentProductId!==id)});window.BarcodeIndex?.invalidate?.();return result};
  const entrada=(produtoId,quantidade,custoUnitario,observacao)=>{let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(p.semControleEstoque||p.controlaEstoque===false)throw Error('Este produto não usa controle de estoque');
    const q=Number(quantidade||0);if(q<=0)throw Error('Informe uma quantidade valida');
    const anterior=Number(p.estoqueAtual||0),novo=anterior+q,agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(custoUnitario!==''&&custoUnitario!==null&&custoUnitario!==undefined)p.custo=Number(custoUnitario);
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'entrada',quantidade:q,estoqueAnterior:anterior,estoqueNovo:novo,custoUnitario:custoUnitario===''||custoUnitario===null||custoUnitario===undefined?null:Number(custoUnitario),observacao:observacao||'',data:agora};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const ajustarEstoque=(produtoId,novoEstoque,motivo)=>{let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    if(p.semControleEstoque||p.controlaEstoque===false)throw Error('Este produto não usa controle de estoque');
    const anterior=Number(p.estoqueAtual||0),novo=Number(novoEstoque||0),agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'ajuste',quantidade:novo-anterior,estoqueAnterior:anterior,estoqueNovo:novo,observacao:motivo||'',data:agora};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const historico=produtoId=>DB.carregar().movimentacoesEstoque.filter(m=>m.produtoId===produtoId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const favoritar=(id,value)=>DB.alterar(db=>{const product=db.produtos.find(p=>p.id===id);if(!product)throw Error('Produto não encontrado');product.favorito=value===undefined?!product.favorito:Boolean(value);product.atualizadoEm=new Date().toISOString()});
  return{listar,obter,salvar,excluir,entrada,ajustarEstoque,historico,status,favoritar,isVariable:p=>window.ProductVariations?.isVariable?.(p)??p?.productType==='variable',isRecurring:p=>p?.productType==='recurring',variacoes:id=>window.ProductVariations?.list(id)||[]};
})();
