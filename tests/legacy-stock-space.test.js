const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8');
function runtime(role='owner',allowed=['a']){
  let data={produtos:[{id:'old',businessId:'qa',nome:'Legado',estoqueAtual:4},{id:'recent',businessId:'qa',nome:'Novo',estoqueAtual:5,spaceAccessMode:'single_space',allowedSpaceIds:['a'],defaultSpaceId:'a',spaceScopeVersion:1},{id:'variable',businessId:'qa',nome:'Variações',productType:'variable',estoqueAtual:2}],variacoesProdutos:[{id:'v',businessId:'qa',parentProductId:'variable',displayName:'Zero',stock:2,price:1,active:true}],movimentacoesEstoque:[{id:'history',produtoId:'old',quantidade:1}],vendas:[]};
  let seq=0;const cache=new Map();
  const c={console,structuredClone,Date,crypto:{randomUUID:()=>`id-${++seq}`},Utils:{uuid:()=>`id-${++seq}`},
    FirebaseSession:{businessId:'qa',user:{uid:'actor'},profile:{role}},
    BusinessContext:{get:()=>({businessId:'qa',role,spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:allowed})},
    TeamAccess:{has:p=>p==='inventory.adjust',actor:()=>({actorUid:'actor',actorRoleSnapshot:role})},
    DB:{getBusinessId:()=> 'qa',carregar:()=>data,alterar:fn=>{const next=structuredClone(data);fn(next);data=next;return data;}},
    localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},document:{querySelector:()=>null},
    addEventListener(){},dispatchEvent(){},CustomEvent:class{},Router:{atual:()=> 'produtos'}};
  c.window=c;vm.createContext(c);
  for(const f of ['js/spaces.js','js/produtos.js','js/product-variations.js'])vm.runInContext(read(f),c);
  c.SpaceContext.setSpaces(['a','b'].map(id=>({id,businessId:'qa',name:id,type:'business',status:'active',capabilities:{inventory:true,products:true,sales:true}})));
  return {c,get data(){return data;}};
}
test('reproduz legado ambíguo em Todos os espaços; recente tem destino único, mesmo sem spaceId',()=>{
  const {c}=runtime();assert.throws(()=>c.Produtos.entrada('old',1,'',''),/Selecione/);
  const m=c.Produtos.entrada('recent',1,'','');assert.equal(m.spaceId,'a');assert.equal(m.businessId,'qa');
});
test('owner no contexto correto registra entrada e saída legadas sem mover produto nem histórico',()=>{
  const r=runtime(),{c}=r;c.SpaceContext.selectHome('a');
  const inMove=c.Produtos.entrada('old',3,'','QA');assert.equal(inMove.spaceId,'a');assert.equal(inMove.quantidade,3);
  const out=c.Produtos.ajustarEstoque('old',6,'Saída QA');assert.equal(out.quantidade,-1);assert.equal(out.businessId,'qa');
  assert.equal(r.data.produtos[0].estoqueAtual,6);assert.equal(r.data.produtos[0].spaceAccessMode,undefined);
  assert.deepEqual(r.data.movimentacoesEstoque[0],{id:'history',produtoId:'old',quantidade:1});
});
test('modal escolhe automaticamente contexto/único espaço, exige decisão explícita quando ambíguo',()=>{
  const {c,data}=runtime();const old=data.produtos[0],recent=data.produtos[1];
  assert.match(c.SpaceContext.stockMovementFields(old),/<select[^>]*required/);
  assert.match(c.SpaceContext.stockMovementFields(old),/option value=""/);
  assert.match(c.SpaceContext.stockMovementFields(recent),/type="hidden" name="stockSpaceId" value="a"/);
  c.SpaceContext.selectHome('b');assert.match(c.SpaceContext.stockMovementFields(old),/type="hidden" name="stockSpaceId" value="b"/);
});
test('owner confirma destino explícito, sem escolher primeiro/default/sales quando ambíguo',()=>{
  const {c,data}=runtime();c.SpaceContext.selectSales('a');assert.throws(()=>c.SpaceContext.stockMovementOrigin(data.produtos[0]),/Selecione/);
  assert.equal(c.Produtos.entrada('old',1,'','','b').spaceId,'b');
});
test('erro de autorização preserva estoque e histórico, e nunca cruza empresa/espaço',()=>{
  const r=runtime(),before=structuredClone(r.data);
  assert.throws(()=>r.c.Produtos.entrada('recent',1,'','','b'),/Selecione/);assert.deepEqual(r.data,before);
  assert.throws(()=>r.c.SpaceContext.stockMovementOrigin({...before.produtos[0],businessId:'other'},'a'),/empresa/);
  assert.throws(()=>r.c.SpaceContext.stockMovementOrigin(before.produtos[0],'all_spaces'),/Selecione/);
});
test('operador restrito só movimenta produto explicitamente autorizado, legado exige owner',()=>{
  const r=runtime('stock');assert.equal(r.c.Produtos.entrada('recent',1,'','').spaceId,'a');
  assert.throws(()=>r.c.Produtos.entrada('recent',1,'','','b'),/Selecione/);
  assert.throws(()=>r.c.Produtos.entrada('old',1,'','','a'),/Selecione/);
  assert.doesNotMatch(r.c.SpaceContext.stockMovementFields(r.data.produtos[0]),/<option value="a"/);
});
test('variações: entrada/saída preservam ator, espaço, estoque e retry idempotente',()=>{
  const r=runtime(),{c}=r;c.SpaceContext.selectHome('a');
  const input={parentProductId:'variable',variantId:'v',quantity:3,operationId:'repeat'};
  const first=c.ProductVariations.stockChange(input);c.ProductVariations.stockChange(input);
  assert.equal(first.spaceId,'a');assert.equal(first.businessId,'qa');assert.equal(first.actorUid,'actor');
  assert.equal(r.data.variacoesProdutos[0].stock,5);assert.equal(r.data.movimentacoesEstoque.filter(m=>m.operationId==='repeat').length,1);
  const out=c.ProductVariations.stockChange({...input,quantity:-1,operationId:'out',type:'saida'});
  assert.equal(out.quantidade,-1);assert.equal(r.data.variacoesProdutos[0].stock,4);
});
test('legacy com referência explícita única é resolvido; referências conflitantes nunca inferidas',()=>{
  const {c,data}=runtime(),p=data.produtos[0];assert.equal(c.SpaceContext.stockMovementOrigin({...p,spaceId:'a'}).spaceId,'a');
  assert.throws(()=>c.SpaceContext.stockMovementOrigin({...p,spaceId:'a',financialSpaceId:'b'},'a'),/Selecione/);
});
