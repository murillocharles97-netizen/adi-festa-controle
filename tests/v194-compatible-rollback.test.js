'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const candidate='c1f8b08bb141ba5feb9c4b2b6288fb6db4fd0293';
function harness(file,separator){
 const source=fs.readFileSync(file,'utf8'),prefix=source.slice(0,source.indexOf(separator)),m={exports:{}};
 assert.ok(prefix.length>500,'existing UI harness must be present');
 new Function('require','module',prefix+'\nmodule.exports={harness};')(require,m);
 return m.exports.harness;
}
const exchange=harness('tests/sale-exchanges-ui.test.js',"test('catalog"),credit=harness('tests/exchange-credit-checkout.test.js','const settle=');
test('containment frontend has its own cache, build channel and entry URLs',()=>{
 assert.match(fs.readFileSync('service-worker.js','utf8'),/CACHE='veconi-v194-compatible-rollback'/);
 assert.match(fs.readFileSync('js/build-info.js','utf8'),/channel: "compatible-rollback"/);
 const html=fs.readFileSync('index.html','utf8');
 for(const file of ['sale-exchanges','exchange-credit-checkout','build-info'])assert.ok(html.includes(`/js/${file}.js?v=194-rb`));
});
test('rollback preserves Rules, financial projection, ledger guards, Sync and sensitive-field sanitation byte-for-byte',()=>{
 for(const file of ['firestore.rules','firestore.indexes.json','functions/src/services/financial-income-service.js','functions/src/services/workspace-reset-policy.js','js/firebase/sync.js','js/fiados.js','js/storage.js','js/business-cache.js','js/exchange-economics.js','js/checkout.js','js/app.js','js/vendas.js','js/recibos.js']){
  const before=execFileSync('git',['-c','core.bare=false','show',`${candidate}:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n');
  assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),before,file);
 }
});
test('new exchange form is paused and direct handlers cannot preserve or send a new operation',async()=>{
 const h=exchange();await h.open();assert.match(h.root.innerHTML,/Novas trocas temporariamente pausadas/);assert.doesNotMatch(h.root.innerHTML,/<form data-ex-form>/);
 await h.quote();await h.confirm();assert.equal(h.storage.size,0);assert.deepEqual(h.calls.map(c=>c.name),['listSaleExchanges']);
});
test('exchange pending request survives reload and consultation without commit or a new ID',async()=>{
 const values=new Map([['veconi:exchange:seller:business:0:sale',JSON.stringify({version:2,request:{operationId:'original-operation',returns:[],replacements:[]}})]]),before=JSON.stringify([...values]);
 for(let i=0;i<2;i++){const h=exchange('normal',values);await h.open();assert.doesNotMatch(h.controls.review.innerHTML,/data-ex-retry|data-ex-revise/);await h.controls.consult.onclick();assert.equal(JSON.stringify([...values]),before);assert.equal(h.calls.filter(c=>c.name==='confirmSaleExchange').length,0);}
});
test('credit balance stays visible, normal tender is not credit-funded, new confirmation is blocked',async()=>{
 const h=credit();await h.mount();assert.match(h.host.innerHTML,/saldo permanece preservado/);assert.match(h.host.innerHTML,/50,00/);assert.doesNotMatch(h.host.innerHTML,/data-credit-all|data-credit-amount/);
 assert.equal(h.api.selectedCents(),0);await assert.rejects(h.api.finish(h.draft),/temporariamente pausados/);assert.equal(h.values.size,0);assert.equal(h.calls.filter(c=>c.name==='confirmExchangeCreditSale').length,0);
});
test('consulting a committed exchange preserves its original request in the local audit archive',async()=>{
 const key='veconi:exchange:seller:business:0:sale',original={version:2,createdAt:'2026-10-22',request:{operationId:'original-operation',returns:[],replacements:[]}},values=new Map([[key,JSON.stringify(original)]]),h=exchange('normal',values);
 h.s.window.FirebaseCallable=async name=>name==='lookupSaleExchange'?{found:true,item:{id:'original-operation'}}:{items:[],remainingQuantities:[2]};
 await h.open();await h.controls.consult.onclick();assert.equal(values.has(key),false);
 const archive=JSON.parse(values.get(key+':attempts'));assert.deepEqual(archive[0].request,original.request);assert.equal(archive[0].createdAt,original.createdAt);assert.equal(archive[0].outcome,'committed');
 assert.match(h.form.innerHTML,/Troca confirmada/);
 const conflicting=new Map([[key,JSON.stringify(original)],[key+':attempts',JSON.stringify([{request:{...original.request,returns:[{line:9}]}}])]]),blocked=exchange('normal',conflicting),before=JSON.stringify([...conflicting]);
 blocked.s.window.FirebaseCallable=h.s.window.FirebaseCallable;await blocked.open();await blocked.controls.consult.onclick();assert.equal(JSON.stringify([...conflicting]),before);assert.match(blocked.controls.error.textContent,/evidência local diverge/);
});
test('credit pending envelope stays intact on consult, reload and explicit retry attempt',async()=>{
 const values=new Map([['veconi:exchange-credit:seller:business:0:space',JSON.stringify({version:1,clientId:'client',createdAt:'2026-10-22',request:{saleId:'original-sale',operationId:'original-operation',items:[]}})]]),before=JSON.stringify([...values]);
 for(let i=0;i<2;i++){const h=credit({values});await h.mount();assert.equal(h.api.hasPending(),true);assert.doesNotMatch(h.host.innerHTML,/data-credit-retry|data-credit-revise/);await h.get('[data-credit-consult]').onclick();await h.get('[data-credit-retry]').onclick();assert.equal(JSON.stringify([...values]),before);assert.equal(h.calls.filter(c=>c.name==='confirmExchangeCreditSale').length,0);}
});
test('specific existing credit-sale cancellation remains explicit and keeps its durable cancellation ID',async()=>{
 const h=credit(),sale={id:'existing-sale',clienteId:'client',spaceId:'space'};await h.api.cancel(sale);await h.api.cancel(sale);const calls=h.calls.filter(c=>c.name==='cancelExchangeCreditSale');assert.equal(calls.length,2);assert.equal(calls[0].data.operationId,calls[1].data.operationId);assert.equal(h.calls.filter(c=>c.name==='confirmExchangeCreditSale').length,0);
});
test('account transition never consumes the original pending credit request',async()=>{
 const values=new Map([['veconi:exchange-credit:seller:business:0:space',JSON.stringify({clientId:'client',request:{saleId:'original-sale',operationId:'original-operation',items:[]}})]]),h=credit({values});await h.mount();const before=JSON.stringify([...values]);h.scopes.uid='owner';h.listeners['business-context-changed']();assert.equal(h.api.selectedCents(),0);assert.equal(JSON.stringify([...values]),before);assert.equal(h.calls.filter(c=>c.name==='confirmExchangeCreditSale').length,0);
});
