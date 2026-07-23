window.getProductStockStatus=product=>{
  if(product?.semControleEstoque||product?.controlaEstoque===false)return'sem-controle';
  const current=Number(product?.estoqueAtual??product?.estoque??0),minimum=Number(product?.estoqueMinimo||0);
  return current<=0?'esgotado':current<=minimum?'baixo':'disponivel';
};
window.Produtos=(()=>{
  const listar=()=>DB.carregar().produtos;
  const obter=id=>listar().find(p=>p.id===id);
  const status=p=>getProductStockStatus(p);
  const salvar=d=>{if(!d.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canCreateProduct(),'criar novos produtos');let salvo;DB.alterar(db=>{
    const atual=db.produtos.find(p=>p.id===d.id),agora=new Date().toISOString();
    const estoque=d.estoqueAtual??d.estoque;
    const imageField=(name,fallback=null)=>d[name]!==undefined?d[name]:(atual?.[name]??fallback);
    const v={nome:String(d.nome||'').trim(),codigo:d.codigo??atual?.codigo??'',preco:Number(d.preco||0),custo:d.custo===''||d.custo===null?null:Number(d.custo||0),estoqueAtual:estoque===''||estoque===null||estoque===undefined?0:Number(estoque),estoqueMinimo:Number(d.estoqueMinimo||0),categoria:d.categoria||'',observacao:d.observacao??atual?.observacao??'',semControleEstoque:d.semControleEstoque===undefined?Boolean(atual?.semControleEstoque):Boolean(d.semControleEstoque),favorito:Boolean(d.favorito??atual?.favorito),ativo:d.ativo!==false,imagem:imageField('imagem',''),imageUrl:imageField('imageUrl'),imageStoragePath:imageField('imageStoragePath'),imageThumbUrl:imageField('imageThumbUrl'),imageThumbStoragePath:imageField('imageThumbStoragePath'),imageUpdatedAt:imageField('imageUpdatedAt'),imageUploadStatus:imageField('imageUploadStatus','none'),imageOperationId:imageField('imageOperationId'),atualizadoEm:agora};
    v.estoque=v.estoqueAtual;
    if(atual){Object.assign(atual,v);salvo=atual}else{salvo={id:d.id||Utils.uuid(),...v,criadoEm:agora};db.produtos.push(salvo)}
  });return salvo};
  const excluir=id=>DB.alterar(db=>db.produtos=db.produtos.filter(p=>p.id!==id));
  const entrada=(produtoId,quantidade,custoUnitario,observacao)=>{let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    const q=Number(quantidade||0);if(q<=0)throw Error('Informe uma quantidade valida');
    const anterior=Number(p.estoqueAtual||0),novo=anterior+q,agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    if(custoUnitario!==''&&custoUnitario!==null&&custoUnitario!==undefined)p.custo=Number(custoUnitario);
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'entrada',quantidade:q,estoqueAnterior:anterior,estoqueNovo:novo,custoUnitario:custoUnitario===''||custoUnitario===null||custoUnitario===undefined?null:Number(custoUnitario),observacao:observacao||'',data:agora};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const ajustarEstoque=(produtoId,novoEstoque,motivo)=>{let mov;const operationId=Utils.uuid();DB.alterar(db=>{
    const p=db.produtos.find(x=>x.id===produtoId);if(!p)throw Error('Produto nao encontrado');
    const anterior=Number(p.estoqueAtual||0),novo=Number(novoEstoque||0),agora=new Date().toISOString();
    p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;
    mov={id:operationId,operationId,produtoId:p.id,produtoNome:p.nome,tipo:'ajuste',quantidade:novo-anterior,estoqueAnterior:anterior,estoqueNovo:novo,observacao:motivo||'',data:agora};
    db.movimentacoesEstoque.push(mov);
  });return mov};
  const historico=produtoId=>DB.carregar().movimentacoesEstoque.filter(m=>m.produtoId===produtoId).sort((a,b)=>new Date(b.data)-new Date(a.data));
  const favoritar=(id,value)=>DB.alterar(db=>{const product=db.produtos.find(p=>p.id===id);if(!product)throw Error('Produto não encontrado');product.favorito=value===undefined?!product.favorito:Boolean(value);product.atualizadoEm=new Date().toISOString()});
  return{listar,obter,salvar,excluir,entrada,ajustarEstoque,historico,status,favoritar};
})();
