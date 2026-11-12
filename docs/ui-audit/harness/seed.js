// Synthetic, fictitious data only.
window.__auditReady=(async()=>{
 const now=Date.now(),day=86400000,iso=d=>new Date(now-d*day).toISOString(),at=(d,h)=>{const x=new Date(now-d*day);x.setHours(h,12,0,0);return x.toISOString();};
 await DB.useBusiness('audit-business');
 DB.alterar(data=>{
  data.config.nome='Doceria Aurora';
  data.config.operation={operationMode:'physical_store',creditMode:'enabled',operationOnboardingCompleted:true,modules:{inventory:true,crm:true,creditSales:true}};
  data.config.dashboard={dailySalesGoal:600};
  const sp={spaceId:'audit-space'};
  data.produtos=[
   {id:'p1',image:{url:'tests/fixtures/sample-product.svg',thumbnailUrl:'tests/fixtures/sample-product.svg',updatedAt:'2026-11-01T12:00:00.000Z'},nome:'Brigadeiro gourmet',categoria:'Doces',preco:4.5,custo:1.6,estoqueAtual:86,estoqueMinimo:20,favorito:true,ativo:true,...sp},
   {id:'p2',nome:'Bolo de pote Ninho',categoria:'Doces',productType:'variable',preco:12,minPrice:12,maxPrice:14,estoqueAtual:9,totalStock:9,estoqueMinimo:10,activeVariationCount:2,ativo:true,...sp},
   {id:'p3',nome:'Brownie',categoria:'Doces',preco:9,custo:3.2,estoqueAtual:4,estoqueMinimo:8,ativo:true,favorito:true,...sp},
   {id:'p4',image:{url:'tests/fixtures/sample-product.svg',thumbnailUrl:'tests/fixtures/sample-product.svg',updatedAt:'2026-11-01T12:00:00.000Z'},nome:'Coca-Cola lata',categoria:'Bebidas',preco:6,custo:3.4,estoqueAtual:48,estoqueMinimo:12,ativo:true,...sp},
   {id:'p5',nome:'Água sem gás',categoria:'Bebidas',preco:3,custo:1.1,estoqueAtual:0,estoqueMinimo:12,ativo:true,...sp},
   {id:'p6',nome:'Torta de limão (fatia)',categoria:'Tortas',preco:11,custo:4,estoqueAtual:14,estoqueMinimo:6,ativo:true,...sp},
   {id:'p7',nome:'Kit festa 50 doces',categoria:'Encomendas',preco:120,custo:48,estoqueAtual:3,estoqueMinimo:1,ativo:true,...sp},
   {id:'p8',nome:'Assinatura café da manhã',categoria:'Serviços',productType:'recurring',durationValue:30,durationUnit:'days',renewalLabel:'Mensal',preco:89.9,semControleEstoque:true,controlaEstoque:false,ativo:true,...sp},
  ];
  data.variacoesProdutos=[{id:'v1',parentProductId:'p2',displayName:'Ninho',attributeValues:{sabor:'Ninho'},price:12,cost:4.5,stock:6,minStock:5,active:true},{id:'v2',parentProductId:'p2',displayName:'Ninho com Nutella',attributeValues:{sabor:'Ninho com Nutella'},price:14,cost:5.5,stock:3,minStock:5,active:true}];
  const names=[['Mariana Costa','11987654321',-86.5],['João Pereira','11976543210',0],['Ana Beatriz Souza','11965432109',-42],['Carlos Mendes','11954321098',15],['Fernanda Lima','11943210987',-230.9],['Rafael Gomes','11932109876',0],['Luciana Rocha','11921098765',-18],['Pedro Henrique','11910987654',0]];
  data.clientes=names.map(([nome,telefone,saldo],i)=>({id:'c'+(i+1),nome,telefone,saldo,ativo:true,totalComprado:120+i*57,quantidadeVendas:3+i,ultimaCompra:iso(i+1),criadoEm:iso(60+i),...sp}));
  const items=[['p1',6,4.5],['p4',2,6],['p3',1,9],['p6',2,11],['p1',12,4.5],['p7',1,120],['p2',1,12]];
  data.vendas=[];let n=0;
  for(let d=13;d>=0;d--)for(let k=0;k<(d%3)+2;k++){const [pid,q,price]=items[(d+k)%items.length],p=data.produtos.find(x=>x.id===pid),c=data.clientes[(d+k)%8],fiado=(d+k)%5===0;
   data.vendas.push({id:'s'+(++n),clienteId:c.id,clienteNome:c.nome,data:at(d,9+k*2),valorFinal:q*price,valorTotal:q*price,lucro:q*(price-(p.custo||price*0.4)),custoTotal:q*(p.custo||price*0.4),status:fiado?'fiado':'pago',formaPagamento:fiado?'fiado':['pix','dinheiro','cartao'][k%3],itens:[{produtoId:pid,nome:p.nome,quantidade:q,precoFinalUnitario:price,subtotalFinal:q*price}],...sp});}
  data.pagamentos=[{id:'pg1',clienteId:'c1',data:iso(2),valor:40,formaPagamento:'pix',...sp},{id:'pg2',clienteId:'c5',data:iso(5),valor:100,formaPagamento:'dinheiro',...sp}];
  data.movimentacoesEstoque=[{id:'m1',produtoId:'p3',tipo:'entrada',quantidade:12,data:iso(6),...sp},{id:'m2',produtoId:'p5',tipo:'saida',quantidade:12,data:iso(3),...sp}];
  data.customerSubscriptions=[{id:'sub1',clientId:'c3',productId:'p8',label:'Assinatura café da manhã',status:'active',expiresAt:new Date(now+2*day).toISOString(),contractedPrice:89.9,...sp}];
  data.campanhas=[];data.progressosCampanha=[];data.recompensas=[];data.catalogOrders=[];
 });
 window.FirebaseSession={user:{uid:'audit-owner',email:'owner@audit.invalid'},profile:{uid:'audit-owner',role:'owner',active:true,businessId:'audit-business',name:'Proprietária'},businessId:'audit-business',business:{id:'audit-business',name:'Doceria Aurora',ownerId:'audit-owner'},access:{planId:'internal',readOnly:false,canMutate:true}};
 DB.__firebaseSyncWrapped=true;
 window.SyncFirebase={isReady:()=>true,createSaleOperation(_b,after){DB.salvar(after);},assertSaleTracked(){},setScreen(){},subscribe(){return()=>{};},status:()=>({state:'synced'}),pendingCount:()=>0};
 window.FirebaseAuthActions={signOut(){}};
 await DB.flush();
})();
