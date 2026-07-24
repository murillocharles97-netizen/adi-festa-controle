const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('js/recibos.js');
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const sandbox={
  window:null,
  Utils:{dinheiro:money,escapar:value=>String(value??'')},
  DB:{carregar:()=>({config:{nome:'Empresa Local'}})},
  document:{querySelector:()=>null},
  matchMedia:()=>({matches:true}),
  navigator:{onLine:true},
  setTimeout,
  console
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'recibos.js'});

const fiado=sandbox.Recibos.buildSaleShareMessage({
  business:{name:'Doçuras da Ana'},
  customer:{nome:'Day Adidas'},
  sale:{status:'fiado',valorFinal:13,saldoAnterior:0,saldoAtual:-13,clienteNome:'Day Adidas'}
});
assert.equal(fiado,[
  'Olá, Day Adidas! 😊',
  '',
  'Segue o resumo da sua compra na Doçuras da Ana:',
  '',
  '🛒 Valor da compra:',
  'R$ 13,00',
  '',
  '💳 Forma de pagamento:',
  'Fiado',
  '',
  '📄 Saldo anterior:',
  'R$ 0,00',
  '',
  '➕ Valor fiado nesta compra:',
  'R$ 13,00',
  '',
  '💰 Total em aberto:',
  'R$ 13,00',
  '',
  'Obrigado pela preferência! 💚',
  'Qualquer dúvida, é só chamar.'
].join('\n'));
assert.ok(fiado.includes('\n\n🛒'));
assert.ok(fiado.includes('Doçuras da Ana'));
assert.ok(!fiado.includes('Adi Festa'));

const paid=sandbox.Recibos.buildSaleShareMessage({
  business:{receiptName:'Doces Premium'},
  customer:{nome:'Jefferson'},
  sale:{status:'pago',formaPagamento:'pix',valorFinal:13,clienteNome:'Jefferson'}
});
assert.match(paid,/Olá, Jefferson!/);
assert.match(paid,/Forma de pagamento:\nPix/);
assert.match(paid,/Pagamento confirmado/);

const guest=sandbox.Recibos.buildSaleShareMessage({
  business:{name:'Outra Empresa'},
  sale:{status:'pago',formaPagamento:'dinheiro',valorFinal:20,clienteNome:'Venda avulsa'}
});
assert.match(guest,/^Olá! 😊/);
assert.match(guest,/Outra Empresa/);

assert.equal(sandbox.Recibos.normalizeSalePhone('(17) 99665-5784'),'5517996655784');
assert.equal(sandbox.Recibos.normalizeSalePhone('5517996655784'),'5517996655784');
assert.equal(sandbox.Recibos.normalizeSalePhone('123'),'');
assert.equal(sandbox.Recibos.publicSaleNumber({id:'abc-123456'}),'123456');

assert.doesNotMatch(source,/DB\.alterar\(/);
assert.doesNotMatch(source,/Vendas\.registrar\(/);
assert.doesNotMatch(source,/Repositories\./);
assert.doesNotMatch(source,/onSnapshot\(/);
assert.doesNotMatch(source,/setDoc\(/);
assert.doesNotMatch(source,/fetch\(/);
assert.match(source,/navigator\.canShare\?\.\(\{files:\[file\]\}\)/);
assert.match(source,/URL\.revokeObjectURL\(url\)/);
assert.equal((source.match(/encodeURIComponent\(message\)/g)||[]).length,1);

const css=read('css/sale-completion.css');
assert.match(css,/@media\(max-width:767px\)/);
assert.match(css,/min-height:48px/);
assert.match(css,/white-space:nowrap/);
assert.match(css,/overflow-wrap:anywhere/);
assert.match(css,/safe-area-inset-bottom/);

const checkoutMobile=read('js/checkout-mobile.js');
assert.match(checkoutMobile,/sale-next-action/);
assert.match(checkoutMobile,/action==='same'/);
assert.match(checkoutMobile,/action==='repeat'/);

console.log('sale-completion.test.js: OK');
