'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');
const actionFixture='tests/fixtures/client-actions-harness.html';
const mobileFixture='tests/mobile-home-clients-polish.fixture.html';
function seed(file,marker){
 const script=[...read(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes(marker));
 assert.ok(script,'Inline mock seed is present');
 const context={Date,crypto:{randomUUID:()=> 'qa-id'},localStorage:{setItem(){}},console:{info(){}}};
 context.window=context;vm.createContext(context);vm.runInContext(script,context);return context;
}
test('action-sheet fixture uses only a clearly synthetic customer and non-routable test phone',()=>{
 const c=seed(actionFixture,'window.Clientes=');
 const client=c.Clientes.obter('c1');
 assert.equal(client.id,'c1');assert.equal(client.nome,'Cliente QA Acoes');
 assert.match(client.telefone,/^0{10}1$/);assert.equal(client.saldo,-30);
 assert.equal(c.Clientes.obter('absent'),null);
});
test('synthetic action-sheet seed preserves the existing debt/phone action branches',()=>{
 const c=seed(actionFixture,'window.Clientes=');
 const root={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
 c.document={querySelector:selector=>selector==='#modal'?root:null,addEventListener(){}};c.requestAnimationFrame=()=>{};c.queueMicrotask=()=>{};
 vm.runInContext(read('js/client-actions.js'),c);c.ClientActions.openSheet('c1');
 assert.match(root.innerHTML,/Cliente QA Acoes/);
 assert.match(root.innerHTML,/data-client-action="receive"[^>]*>/);
 assert.doesNotMatch(root.innerHTML,/data-client-action="receive"[^>]*disabled/);
 assert.doesNotMatch(root.innerHTML,/data-client-action="charge"[^>]*disabled/);
 for(const action of ['profile','sale','contact','receive','adjust','charge','promise','history','edit','delete'])assert.ok(root.innerHTML.includes('data-client-action="'+action+'"'));
});
test('mobile fixture preserves five customers, IDs and debt/credit/zero scenarios with fictitious records',()=>{
 const c=seed(mobileFixture,'window.__auditData='),data=c.__auditData;
 assert.deepEqual(Array.from(data.clientes,x=>x.id),['c1','c2','c3','c4','c5']);
 assert.deepEqual(Array.from(data.clientes,x=>c.Clientes.financialStatus(x).status),['debt','zero','credit','debt','zero']);
 for(const client of data.clientes){assert.match(client.nome,/^Cliente QA /);assert.ok(!client.telefone||/^0{10}[1-5]$/.test(client.telefone));}
 assert.equal(c.DB.getBusinessId(),'qa-fixture-business');
 assert.equal(data.config.nome,'Loja QA Ficticia');assert.equal(c.FirebaseSession.user.uid,'qa-fixture-owner');
 assert.equal(c.FirebaseSession.profile.name,'Operador QA');
});
test('purchase, stock and subscription seed relationships remain coherent without operational data',()=>{
 const data=seed(mobileFixture,'window.__auditData=').__auditData;
 assert.equal(data.vendas.length,3);assert.equal(data.produtos.length,3);assert.equal(data.customerSubscriptions.length,4);
 for(const sale of data.vendas){assert.ok(data.clientes.some(c=>c.id===sale.clienteId));for(const line of sale.itens)assert.ok(data.produtos.some(p=>p.id===line.produtoId));}
 for(const sub of data.customerSubscriptions)assert.ok(data.clientes.some(c=>c.id===sub.clientId));
 assert.ok(data.clientes.find(x=>x.id==='c1').promessaPagamento);
 assert.equal(data.clientes.find(x=>x.id==='c3').telefone,'');assert.equal(data.clientes.find(x=>x.id==='c5').ultimaCompra,null);
});
test('fixture and dependent search audit use the same synthetic target',()=>{
 const c=seed(mobileFixture,'window.__auditData=');const audit=read('scripts/audit-mobile-home-clients.cjs');
 assert.ok(audit.includes("input.value='Delta'"),'Audit searches the synthetic target');
 assert.ok(audit.includes('Cliente QA Delta'),'Audit expects the synthetic target');
 assert.equal(c.__auditData.clientes.filter(x=>x.nome.includes('Delta')).length,1);
});
test('both fixtures remain local mocks, excluded from the V199 public artifact',()=>{
 const manifest=JSON.parse(read('public-site.manifest.json'));
 for(const file of [actionFixture,mobileFixture]){assert.equal(manifest.files.includes(file),false);assert.doesNotMatch(read(file),/firebase-config\.js|cloudfunctions\.net|https:\/\/veconi\.app\.br/);}
 assert.match(read(actionFixture),/window\.Clientes=/);assert.match(read(mobileFixture),/window\.DB=/);
});
