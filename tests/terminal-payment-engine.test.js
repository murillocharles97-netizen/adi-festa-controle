const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function salesSandbox({browser=false}={}){
  let sequence=0;
  const data={
    clientes:[{id:'c1',nome:'Cliente',saldo:0,totalComprado:0,quantidadeVendas:0,financialVersion:0}],
    produtos:[{id:'p1',nome:'Produto',preco:89.9,custo:20,estoqueAtual:5,estoque:5,controlaEstoque:true}],
    variacoesProdutos:[],vendas:[],movimentacoes:[],movimentacoesEstoque:[],
  };
  const sandbox={console,structuredClone,Date,Math,Number,Map,Set,Error,window:null,
    Utils:{uuid:()=>`id_${++sequence}`},
    DB:{carregar:()=>data,alterar:callback=>callback(data),getBusinessId:()=> 'business-a'},
    Produtos:{obter:id=>data.produtos.find(item=>item.id===id)},
    ProductVariations:{get:()=>null,recomputeInData:()=>{}},
    productControlsStock:product=>product.controlaEstoque!==false,
  };
  if(browser){
    sandbox.document={};
    sandbox.SpaceContext={requireSalesSpace:id=>{
      if(id==='space-a')return id;
      throw Error('Selecione o espaço desta venda.');
    }};
    sandbox.SpaceEngine={productAllowsSpace:(product,spaceId)=>!product.allowedSpaceIds||product.allowedSpaceIds.includes(spaceId)};
  }
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/vendas.js'),sandbox,{filename:'vendas.js'});
  return{sandbox,data};
}

test('finalização repetida usa operationId e baixa estoque/cliente uma vez',()=>{
  const {sandbox,data}=salesSandbox({browser:true}),input={
    id:'sale-terminal-1',operationId:'terminal_payment_pi_same',clienteId:'c1',status:'pago',formaPagamento:'cartao_presencial',
    spaceId:'space-a',financialSpaceId:'space-a',
    paymentIntentId:'pi_same',paymentState:'paid',receivableStatus:'pending_settlement',
    paymentMetadata:{channel:'card_present',provider:'simulator',terminalId:'t1',terminalNickname:'Caixa 1',method:'credit',installments:1},
    itens:[{produtoId:'p1',nome:'Produto',quantidade:1,precoOriginal:89.9,precoFinalUnitario:89.9,custoUnitario:20}],
  };
  const first=sandbox.Vendas.registrar(input),duplicate=sandbox.Vendas.registrar(input);
  assert.equal(first.id,duplicate.id);
  assert.equal(data.vendas.length,1);
  assert.equal(data.produtos[0].estoqueAtual,4);
  assert.equal(data.movimentacoesEstoque.length,1);
  assert.equal(data.clientes[0].totalComprado,89.9);
  assert.equal(data.clientes[0].quantidadeVendas,1);
  assert.equal(first.spaceId,'space-a');
  assert.equal(first.financialSpaceId,'space-a');
  assert.equal(first.paymentMetadata.provider,'simulator');
});

test('registro de venda exige spaceId explícito e aplica o guard final de disponibilidade',()=>{
  const {sandbox,data}=salesSandbox({browser:true}),base={
    operationId:'sale-space-guard',clienteId:'c1',status:'pago',
    itens:[{produtoId:'p1',nome:'Produto',quantidade:1,precoOriginal:89.9,precoFinalUnitario:89.9,custoUnitario:20}],
  };
  assert.throws(()=>sandbox.Vendas.registrar(base),/explicitamente o espaço/);
  assert.throws(()=>sandbox.Vendas.registrar({...base,spaceId:'space-a',financialSpaceId:'space-b'}),/deve corresponder/);
  data.produtos[0].allowedSpaceIds=['space-b'];
  assert.throws(()=>sandbox.Vendas.registrar({...base,spaceId:'space-a'}),/não está disponível/);
  assert.equal(data.vendas.length,0);
  assert.equal(data.produtos[0].estoqueAtual,5);
});

test('aliases agregados nunca viram espaço real nem no fallback legado',()=>{
  const {sandbox,data}=salesSandbox(),base={
    operationId:'sale-reserved-space',clienteId:'c1',status:'pago',
    itens:[{produtoId:'p1',nome:'Produto',quantidade:1,precoOriginal:89.9,precoFinalUnitario:89.9,custoUnitario:20}],
  };
  assert.throws(()=>sandbox.Vendas.registrar({...base,spaceId:'all'}),/Selecione/);
  assert.throws(()=>sandbox.Vendas.registrar({...base,spaceId:'all_spaces'}),/Selecione/);
  assert.equal(data.vendas.length,0);
  assert.equal(data.produtos[0].estoqueAtual,5);
});

test('checkout mantém formas existentes e adiciona cartão na maquininha',()=>{
  const checkout=read('js/checkout.js'),mobile=read('js/checkout-mobile.js');
  for(const method of ['pix','dinheiro','cartao','fiado','cartao_presencial'])assert.match(checkout,new RegExp(`value="${method}"`));
  assert.match(mobile,/data-payment="cartao_presencial"/);
  assert.match(checkout,/if \(finishing\) return/);
  assert.match(checkout,/finalizeTerminalPayment/);
});

test('cliente acompanha somente intent ativo, protege saída e não faz polling agressivo',()=>{
  const source=read('js/terminal-payments.js');
  assert.match(source,/FirebaseDocumentListener\(\['businesses',scopedBusiness,'paymentIntents',intent\.id\]/);
  assert.match(source,/beforeunload/);
  assert.match(source,/Existe um pagamento em andamento/);
  assert.doesNotMatch(source,/setInterval\(/);
  assert.doesNotMatch(source,/localStorage/);
});

test('timeout não cria retry automático e mostra aviso de dupla cobrança',()=>{
  const source=read('js/terminal-payments.js');
  assert.match(source,/Timeout não significa pagamento recusado/);
  assert.match(source,/Não tente cobrar novamente/);
  assert.doesNotMatch(source,/pending_confirmation[^\n]+dispatchCurrent/);
});

test('configurações exibem providers sem botões funcionais falsos',()=>{
  const source=read('js/terminal-payments.js');
  assert.match(source,/Cielo/);
  assert.match(source,/Mercado Pago/);
  assert.match(source,/PagBank/);
  assert.match(source,/Em breve/);
  assert.match(source,/Conexão preparada, ainda sem ativação nesta fase/);
});
