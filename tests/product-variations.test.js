const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function runtime(){
  const data={produtos:[],variacoesProdutos:[],clientes:[{id:'c1',nome:'Cliente',saldo:0,totalComprado:0,quantidadeVendas:0}],vendas:[],movimentacoes:[],movimentacoesEstoque:[]};
  let sequence=0;
  const context={console,structuredClone,Date,Map,Set,Error,String,Number,Boolean,Array,Object,JSON,Math,crypto:{randomUUID:()=>`id_${++sequence}`},Utils:{uuid:()=>`id_${++sequence}`},DB:{getBusinessId:()=> 'empresa_teste',carregar:()=>data,alterar(mutator){mutator(data);return data}},PlanLimitService:null,BarcodeIndex:{invalidate(){},assertAvailable(){}},normalizeBarcode:value=>String(value||'').replace(/\s/g,''),Campanhas:{aplicarBeneficios:items=>items,aplicarVendaNoBanco:()=>[],reverterVendaNoBanco(){}},dispatchEvent(){},CustomEvent:function(){}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/produtos.js','utf8'),context);
  vm.runInContext(fs.readFileSync('js/product-variations.js','utf8'),context);
  vm.runInContext(fs.readFileSync('js/vendas.js','utf8'),context);
  return{context,data};
}

test('produtos antigos continuam simples',()=>{
  const {context}=runtime(),product=context.Produtos.salvar({nome:'Brownie',preco:8,custo:3,estoqueAtual:10});
  assert.equal(product.productType,'simple');
  assert.equal(context.getProductStockStatus(product),'disponivel');
});

test('gera combinações e mantém agregados no produto pai',()=>{
  const {context,data}=runtime(),attributes=[{id:'cor',name:'Cor',values:['Preto','Branco']},{id:'tam',name:'Tamanho',values:['P','M']}],rows=context.ProductVariations.combinations(attributes);
  assert.equal(rows.length,4);
  const parent=context.ProductVariations.createProduct({product:{nome:'Camiseta'},attributes,variants:rows.map((row,index)=>({...row,price:20+index,stock:index+1,minStock:1,sku:`SKU-${index}`}))});
  assert.equal(parent.productType,'variable');
  assert.equal(parent.activeVariationCount,4);
  assert.equal(parent.totalStock,10);
  assert.equal(parent.minPrice,20);
  assert.equal(parent.maxPrice,23);
  assert.equal(data.variacoesProdutos.length,4);
});

test('venda baixa somente a variação e desfazer restaura uma única vez',()=>{
  const {context,data}=runtime(),parent=context.ProductVariations.createProduct({product:{nome:'Cone'},attributes:[{id:'sabor',name:'Sabor',values:['Ferrero','Nutella']}],variants:[{displayName:'Ferrero',attributeValues:{sabor:'Ferrero'},price:14,cost:6,stock:8,sku:'FER'},{displayName:'Nutella',attributeValues:{sabor:'Nutella'},price:13,cost:5,stock:12,sku:'NUT'}]}),variant=context.ProductVariations.active(parent.id)[0],item=context.ProductVariations.saleItem(parent,variant,2),sale=context.Vendas.registrar({operationId:'sale-1',clienteId:'c1',status:'pago',itens:[item]});
  assert.equal(sale.itens[0].variantId,variant.id);
  assert.equal(sale.itens[0].productId,parent.id);
  assert.equal(sale.itens[0].quantity,2);
  assert.equal(sale.itens[0].variantNameSnapshot,'Ferrero');
  assert.deepEqual(sale.itens[0].attributesSnapshot,{sabor:'Ferrero'});
  assert.equal(context.ProductVariations.get(variant.id).stock,6);
  assert.equal(data.produtos[0].totalStock,18);
  assert.equal(data.movimentacoesEstoque.filter(item=>item.variantId===variant.id&&item.tipo==='saida_venda').length,1);
  assert.equal(context.Vendas.registrar({operationId:'sale-1',clienteId:'c1',status:'pago',itens:[item]}).id,sale.id);
  assert.equal(context.ProductVariations.get(variant.id).stock,6);
  context.Vendas.desfazerUltima();
  assert.equal(context.ProductVariations.get(variant.id).stock,8);
  assert.equal(data.produtos[0].totalStock,20);
});

test('busca encontra variação, SKU e código sem duplicar o pai',()=>{
  const {context}=runtime(),parent=context.ProductVariations.createProduct({product:{nome:'Anel Coração'},attributes:[{id:'tamanho',name:'Tamanho',values:['16','18']}],variants:[{displayName:'16',attributeValues:{tamanho:'16'},price:29,stock:2,sku:'ANEL16',barcode:'789001'},{displayName:'18',attributeValues:{tamanho:'18'},price:31,stock:3,sku:'ANEL18',barcode:'789002'}]});
  for(const query of ['18','ANEL18','789002']){const result=context.ProductVariations.search(query);assert.equal(result.length,1);assert.equal(result[0].product.id,parent.id);assert.equal(result[0].variant.displayName,'18')}
});

test('estoque insuficiente é bloqueado e entrada atualiza agregado',()=>{
  const {context}=runtime(),parent=context.ProductVariations.createProduct({product:{nome:'Gloss'},attributes:[{id:'cor',name:'Cor',values:['Rosa']}],variants:[{displayName:'Rosa',attributeValues:{cor:'Rosa'},price:10,stock:1}] }),variant=context.ProductVariations.active(parent.id)[0];
  assert.throws(()=>context.ProductVariations.stockChange({parentProductId:parent.id,variantId:variant.id,quantity:-2,type:'saida_venda'}),/Estoque insuficiente/);
  context.ProductVariations.stockChange({parentProductId:parent.id,variantId:variant.id,quantity:5,type:'entrada'});
  assert.equal(context.ProductVariations.get(variant.id).stock,6);
  assert.equal(context.Produtos.obter(parent.id).totalStock,6);
});

test('integrações usam variação sem listeners por card',()=>{
  const checkout=fs.readFileSync('js/checkout.js','utf8'),sync=fs.readFileSync('js/firebase/sync.js','utf8'),catalog=fs.readFileSync('js/catalogo-admin.js','utf8'),portal=fs.readFileSync('js/catalogo-publico.js','utf8'),rules=fs.readFileSync('firestore.rules','utf8');
  assert.match(checkout,/openVariantPicker|variablePicker/);
  assert.match(sync,/productVariants\s*:\s*\{\s*key\s*:\s*["']variacoesProdutos["']/);
  const bootstrapPull=sync.slice(sync.indexOf('const DEFAULT_PULL_NAMES'),sync.indexOf('const AUDIT_NAMES'));
  assert.doesNotMatch(bootstrapPull,/["']productVariants["']/);
  assert.match(sync,/listWhere\(\s*["']parentProductId["']/);
  assert.match(catalog,/variants/);
  assert.match(portal,/variantId/);
  assert.match(rules,/match \/productVariants\/\{variantId\}/);
  assert.doesNotMatch(checkout,/onSnapshot/);
});
