/* Repositórios locais: mantêm as telas independentes do localStorage para futura troca por Firebase. */
window.Repositories=(()=>{
  const wrap=api=>({list:()=>api.listar(),getById:id=>api.obter(id),create:d=>api.salvar(d),update:(id,d)=>api.salvar({id,...d}),remove:id=>api.excluir(id)});
  return {clientRepository:()=>wrap(Clientes),productRepository:()=>wrap(Produtos),saleRepository:()=>({list:()=>Vendas.listar(),create:d=>Vendas.registrar(d)}),paymentRepository:()=>({list:()=>DB.carregar().pagamentos}),stockRepository:()=>({history:id=>Produtos.historico(id),entry:(...a)=>Produtos.entrada(...a),adjust:(...a)=>Produtos.ajustarEstoque(...a)}),campaignRepository:()=>({list:()=>DB.carregar().campanhas||[]}),settingsRepository:()=>({get:()=>DB.carregar().config,update:fn=>DB.alterar(db=>fn(db.config))})};
})();
