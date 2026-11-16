'use strict';
// D2: stock movements of a product available in several spaces need a space the user chose.
// The first authorized space (the silent fallback) is never used; one eligible space needs no choice.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8');
function runtime({spaces=['a','b'],storage=new Map(),products}={}){
  let data={produtos:products||[{id:'shared',businessId:'qa',nome:'Compartilhado',estoqueAtual:4,spaceAccessMode:'all_spaces',allowedSpaceIds:[],spaceScopeVersion:1},
    {id:'only-a',businessId:'qa',nome:'Só A',estoqueAtual:5,spaceAccessMode:'single_space',allowedSpaceIds:['a'],defaultSpaceId:'a',spaceScopeVersion:1}],
    variacoesProdutos:[],movimentacoesEstoque:[{id:'history',produtoId:'shared',quantidade:1,spaceId:'a'}],vendas:[]};
  let seq=0;
  const c={console,structuredClone,Date,crypto:{randomUUID:()=>`id-${++seq}`},Utils:{uuid:()=>`id-${++seq}`},
    FirebaseSession:{businessId:'qa',user:{uid:'owner'},profile:{role:'owner'}},
    BusinessContext:{get:()=>({businessId:'qa',role:'owner',spaceAccess:'all',allowedSpaceIds:[]})},
    TeamAccess:{has:p=>['inventory.adjust','products.edit'].includes(p),actor:()=>({actorUid:'owner',actorRoleSnapshot:'owner'})},
    DB:{getBusinessId:()=> 'qa',carregar:()=>data,alterar:fn=>{const next=structuredClone(data);fn(next);data=next;return data;}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},document:{querySelector:()=>null},
    addEventListener(){},dispatchEvent(){},CustomEvent:class{},Router:{atual:()=> 'produtos'}};
  c.window=c;vm.createContext(c);
  for(const f of ['functions/src/shared/product-model.js','js/spaces.js','js/produtos.js','js/product-variations.js'])vm.runInContext(read(f),c);
  c.SpaceContext.setSpaces(spaces.map(id=>({id,businessId:'qa',name:id.toUpperCase(),type:'business',status:'active',capabilities:{inventory:true,products:true,sales:true}})));
  return {c,storage,get data(){return data;}};
}
const shared=r=>r.data.produtos.find(p=>p.id==='shared');

test('vários espaços e nenhuma escolha: pede a seleção e não usa o primeiro espaço',()=>{
  const r=runtime();
  assert.equal(r.c.SpaceContext.activeId(),'a','the fallback still exists for screens');
  assert.throws(()=>r.c.SpaceContext.stockMovementOrigin(shared(r)),/Selecione/);
  assert.throws(()=>r.c.Produtos.entrada('shared',1,'',''),/Selecione/);
  assert.throws(()=>r.c.Produtos.ajustarEstoque('shared',9,'QA'),/Selecione/);
  assert.match(r.c.SpaceContext.stockMovementFields(shared(r)),/<select[^>]*name="stockSpaceId" required/);
  assert.equal(shared(r).estoqueAtual,4);assert.equal(r.data.movimentacoesEstoque.length,1);
});

test('preferência gravada pelo fallback de versões anteriores não conta como escolha',()=>{
  const first=runtime();
  // setSpaces persisted the fallback 'a' as the sales preference (V229.1 behaviour), without a choice.
  assert.ok([...first.storage.values()].includes('a'));
  const reopened=runtime({storage:first.storage});
  assert.throws(()=>reopened.c.SpaceContext.stockMovementOrigin(shared(reopened)),/Selecione/);
});

test('escolha explícita do usuário vale, inclusive após reabrir, e inclusive do mesmo espaço do fallback',()=>{
  const r=runtime();r.c.SpaceContext.selectSales('a');
  assert.equal(r.c.Produtos.entrada('shared',2,'','QA').spaceId,'a');
  const reopened=runtime({storage:r.storage});
  assert.equal(reopened.c.SpaceContext.stockMovementOrigin(shared(reopened)).spaceId,'a');
  reopened.c.SpaceContext.selectHome('b');
  assert.equal(reopened.c.SpaceContext.stockMovementOrigin(shared(reopened)).spaceId,'b');
});

test('destino informado no formulário vence e não muda a escolha global',()=>{
  const r=runtime();
  assert.equal(r.c.Produtos.entrada('shared',1,'','QA','b').spaceId,'b');
  assert.throws(()=>r.c.SpaceContext.stockMovementOrigin(shared(r)),/Selecione/);
  assert.throws(()=>r.c.Produtos.entrada('shared',1,'','QA','outro'),/Selecione/);
});

test('um único espaço elegível continua operando sem perguntar',()=>{
  const single=runtime({spaces:['a']});
  assert.equal(single.c.Produtos.entrada('shared',1,'','QA').spaceId,'a');
  const scoped=runtime();
  assert.equal(scoped.c.Produtos.entrada('only-a',1,'','QA').spaceId,'a');
});

test('registros históricos não são reescritos',()=>{
  const r=runtime();r.c.SpaceContext.selectSales('b');r.c.Produtos.entrada('shared',1,'','QA');
  assert.deepEqual(r.data.movimentacoesEstoque[0],{id:'history',produtoId:'shared',quantidade:1,spaceId:'a'});
  assert.equal(r.data.movimentacoesEstoque[1].spaceId,'b');
});

test('produto novo com estoque inicial em vários espaços também exige a escolha',()=>{
  const r=runtime();
  assert.throws(()=>r.c.Produtos.salvar({nome:'Novo',preco:1,estoqueAtual:3,spaceAccessMode:'all_spaces',allowedSpaceIds:[]}),/Selecione/);
  assert.equal(r.data.produtos.length,2);
  r.c.SpaceContext.selectSales('b');
  assert.equal(r.c.Produtos.salvar({nome:'Novo',preco:1,estoqueAtual:3,spaceAccessMode:'all_spaces',allowedSpaceIds:[]}).estoqueAtual,3);
});
