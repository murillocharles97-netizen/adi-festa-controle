const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(id = 'product-search', replaceOnAdd = false) {
  const handlers = {}, cart = new Map(), messages = [];
  const products = [{id:'a',nome:'Produto A',sku:'SKU-ABC',barcode:'0789123456789'}, {id:'b',nome:'Produto B',barcode:'0789123456790'}];
  let input, focused, filters = 0, clock = 0;
  const makeInput = () => ({ id, value:'', matches:()=>true,
    dispatchEvent(e){ if(e.type==='input') filters++; }, focus(){focused=this;} });
  input = makeInput();
  const context = {console, setTimeout, clearTimeout, Event, location:{hash:'#/vender'},
    localStorage:{getItem:()=>null,setItem(){}}, navigator:{}, CSS:{escape:String},
    Utils:{toast:m=>messages.push(m)},
    DB:{getBusinessId:()=> 'qa',carregar:()=>({produtos:products})},
    Produtos:{obter:id=>products.find(p=>p.id===id)},
    document:{addEventListener:(name,fn)=>{handlers[name]=fn;},
      getElementById:()=>input,
      querySelector(selector){const match=selector.match(/^\[data-add="([^"]+)"\]$/);return match?{click(){cart.set(match[1],(cart.get(match[1])||0)+1);focused=null;if(replaceOnAdd)input=makeInput();}}:null;}},
    addEventListener(){},
  };
  context.window=context;
  vm.runInNewContext(fs.readFileSync('js/barcode.js','utf8'),context);
  function key(key,extra={}) {let prevented=false;handlers.keydown({target:input,key,timeStamp:clock+=10,preventDefault(){prevented=true;},...extra});return prevented;}
  function scan(code){for(const char of code){key(char);input.value+=char;}key('Enter');}
  return {cart,messages,key,scan,get input(){return input;},get focused(){return focused;},get filters(){return filters;}};
}

for(const id of ['product-search','mobile-product-search']) {
  test(`${id}: duas leituras diferentes e repetição incrementam uma linha por produto`,()=>{
    const s=setup(id);s.scan('0789123456789');s.scan('0789123456790');s.scan('0789123456789');
    assert.equal(s.cart.size,2);assert.equal(s.cart.get('a'),2);assert.equal(s.cart.get('b'),1);
    assert.equal(s.input.value,'');assert.equal(s.focused,s.input);assert.equal(s.filters,3);
  });
  test(`${id}: dez leituras rápidas, Enter duplicado e normalização`,()=>{
    const s=setup(id);for(let i=0;i<10;i++){s.scan(i%2?'0789123456789':'0789123456790');s.key('Enter');}
    assert.equal(s.cart.get('a'),5);assert.equal(s.cart.get('b'),5);
    s.input.value=' 0789 123456789\r\n';s.key('Enter');assert.equal(s.cart.get('a'),6);
    assert.equal(s.input.value,'');assert.equal(s.focused,s.input);
  });
  test(`${id}: inexistente seguido de válido não concatena`,()=>{
    const s=setup(id);s.scan('9999999999999');assert.equal(s.input.value,'');assert.match(s.messages[0],/Produto não encontrado/);
    s.scan('0789123456789');assert.equal(s.cart.get('a'),1);assert.equal(s.focused,s.input);
  });
  test(`${id}: busca manual por nome/SKU e IME preservados`,()=>{
    const s=setup(id);for(const value of ['Produto A','SKU-ABC']){s.input.value=value;assert.equal(s.key('Enter'),false);assert.equal(s.input.value,value);}
    s.input.value='0789123456789';s.key('Enter',{isComposing:true});assert.equal(s.cart.size,0);
  });
}
test('foco e limpeza atingem o input novo após renderização do carrinho',()=>{
  const s=setup('product-search',true), old=s.input;s.scan('0789123456789');
  assert.notEqual(s.input,old);assert.equal(s.input.value,'');assert.equal(s.focused,s.input);
  s.scan('0789123456790');assert.equal(s.cart.size,2);
});
test('busca manual digitada rapidamente continua sendo busca por nome/SKU',()=>{
  for(const query of ['Produto A','SKU-ABC']){const s=setup();s.scan(query);assert.equal(s.input.value,query);assert.equal(s.cart.size,0);assert.equal(s.messages.length,0);}
});
test('scanner alfanumérico inexistente permite leitura seguinte',()=>{
  const s=setup();s.scan('MISSING-CODE');assert.equal(s.input.value,'');assert.equal(s.messages.length,1);
  s.scan('0789123456790');assert.equal(s.cart.get('b'),1);
});
