window.Vendas=(()=>{
  const listar=()=>DB.carregar().vendas;
  const estoqueInsuficiente=itens=>itens.map(i=>{const p=Produtos.obter(i.produtoId),q=Number(i.quantidade||0);return p&&Number(p.estoqueAtual)<q?{produto:p,quantidade:q,falta:q-Number(p.estoqueAtual)}:null}).filter(Boolean);
  const registrar=d=>{const operationId=d.operationId||Utils.uuid(),existente=DB.carregar().vendas.find(v=>v.operationId===operationId);if(existente)return existente;let criada;DB.alterar(db=>{
    const cliente=db.clientes.find(c=>c.id===d.clienteId),data=new Date().toISOString();
    const itens=d.itens.map(i=>{const produto=db.produtos.find(p=>p.id===i.produtoId),quantidade=Number(i.quantidade),precoOriginal=Number(i.precoOriginal??i.precoUnitario),precoFinalUnitario=Number(i.precoFinalUnitario??precoOriginal),custoUnitario=Number(i.custoUnitario||0),subtotalOriginal=quantidade*precoOriginal,subtotalFinal=quantidade*precoFinalUnitario,custoTotal=quantidade*custoUnitario;return{produtoId:i.produtoId,nome:i.nome,productImage:i.productImage||i.imageThumbUrl||produto?.imageThumbUrl||produto?.imageUrl||produto?.imagem||'',productMainImage:i.productMainImage||i.imageUrl||produto?.imageUrl||produto?.imagem||'',imageUpdatedAt:i.imageUpdatedAt||produto?.imageUpdatedAt||null,quantidade,precoOriginal,precoFinalUnitario,custoUnitario,subtotalOriginal,subtotalFinal,custoTotal,lucro:subtotalFinal-custoTotal,precoUnitario:precoFinalUnitario}});
    const subtotalOriginal=itens.reduce((s,i)=>s+i.subtotalOriginal,0),valorFinal=itens.reduce((s,i)=>s+i.subtotalFinal,0),descontoTotal=subtotalOriginal-valorFinal,custoTotal=itens.reduce((s,i)=>s+i.custoTotal,0),lucro=valorFinal-custoTotal,saldoAnterior=cliente?Number(cliente.saldo||0):0,saldoAtual=d.status==='fiado'?saldoAnterior-valorFinal:saldoAnterior;
    criada={id:Utils.uuid(),operationId,clienteId:d.clienteId||null,clienteNome:cliente?.nome||'Venda avulsa',itens,subtotalOriginal,descontoTotal,valorFinal,valorTotal:valorFinal,custoTotal,lucro,status:d.status,formaPagamento:d.formaPagamento||window.CheckoutPaymentMethod||(d.status==='fiado'?'fiado':'pago'),data,observacao:d.observacao||'',saldoAnterior,saldoAtual,ajusteManual:Boolean(d.ajusteManual),descontoTipo:d.descontoTipo||null};
    db.vendas.push(criada);
    itens.forEach(i=>{const p=db.produtos.find(x=>x.id===i.produtoId);if(!p)return;const anterior=Number(p.estoqueAtual||0),novo=anterior-Number(i.quantidade);p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=data;db.movimentacoesEstoque.push({id:Utils.uuid(),produtoId:p.id,produtoNome:p.nome,tipo:'saida_venda',vendaId:criada.id,quantidade:-Number(i.quantidade),estoqueAnterior:anterior,estoqueNovo:novo,observacao:`Venda para ${criada.clienteNome}`,data})});
    if(cliente){cliente.totalComprado=Number(cliente.totalComprado||0)+valorFinal;cliente.quantidadeVendas=Number(cliente.quantidadeVendas||0)+1;cliente.ultimaCompra=criada.data;if(d.status==='fiado')cliente.saldo=saldoAtual}
    db.movimentacoes.push({id:Utils.uuid(),clienteId:d.clienteId||null,clienteNome:criada.clienteNome,tipo:'venda',vendaId:criada.id,valor:valorFinal,status:d.status,data:criada.data});
    if(descontoTotal!==0)db.movimentacoes.push({id:Utils.uuid(),clienteId:d.clienteId||null,clienteNome:criada.clienteNome,tipo:'desconto',vendaId:criada.id,valor:descontoTotal,data:criada.data});
    if(d.ajusteManual)db.movimentacoes.push({id:Utils.uuid(),clienteId:d.clienteId||null,clienteNome:criada.clienteNome,tipo:'ajuste_valor_venda',vendaId:criada.id,subtotalOriginal,valorFinal,data:criada.data});
  });return criada};
  const ultima=()=>{const vendas=listar();return vendas[vendas.length-1]||null};
  const podeDesfazer=()=>{const v=ultima();return Boolean(v&&Date.now()-new Date(v.data).getTime()<=5*60*1000)};
  const desfazerUltima=()=>{let removida;const operationId=Utils.uuid();DB.alterar(db=>{
    const venda=db.vendas[db.vendas.length-1];if(!venda)throw Error('Nenhuma venda para desfazer');if(Date.now()-new Date(venda.data).getTime()>5*60*1000)throw Error('O prazo de 5 minutos para desfazer terminou');
    removida={...venda};db.vendas.pop();const agora=new Date().toISOString();
    venda.itens.forEach(i=>{const p=db.produtos.find(x=>x.id===i.produtoId);if(!p)return;const anterior=Number(p.estoqueAtual||0),novo=anterior+Number(i.quantidade);p.estoqueAtual=novo;p.estoque=novo;p.atualizadoEm=agora;db.movimentacoesEstoque.push({id:Utils.uuid(),operationId,produtoId:p.id,produtoNome:p.nome,tipo:'venda_desfeita',vendaId:venda.id,quantidade:Number(i.quantidade),estoqueAnterior:anterior,estoqueNovo:novo,observacao:'Estoque restaurado ao desfazer venda',data:agora})});
    const cliente=db.clientes.find(c=>c.id===venda.clienteId);
    if(cliente){if(venda.status==='fiado')cliente.saldo=Number(venda.saldoAnterior||0);cliente.totalComprado=Math.max(0,Number(cliente.totalComprado||0)-Number(venda.valorFinal??venda.valorTotal));cliente.quantidadeVendas=Math.max(0,Number(cliente.quantidadeVendas||0)-1);const anteriores=db.vendas.filter(v=>v.clienteId===cliente.id);cliente.ultimaCompra=anteriores.length?anteriores[anteriores.length-1].data:null}
    db.movimentacoes=db.movimentacoes.filter(m=>m.vendaId!==venda.id);
    db.movimentacoes.push({id:operationId,operationId,clienteId:venda.clienteId,clienteNome:venda.clienteNome,tipo:'venda_desfeita',vendaId:venda.id,valor:Number(venda.valorFinal??venda.valorTotal),data:agora});
  });return removida};
  return{listar,registrar,ultima,podeDesfazer,desfazerUltima,estoqueInsuficiente};
})();
