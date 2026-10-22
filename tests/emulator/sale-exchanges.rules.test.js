'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {saleExchangeService}=require('../../functions/src/services/sale-exchange-service');
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');
const {creditService}=require('../../functions/src/services/exchange-credit-service');
let env,app,db,service,n=0;
const enabled=/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'');
const t=(name,fn)=>test(name,{skip:!enabled},fn);
test.before(async()=>{if(!enabled)return;env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'adi-festa-variations-test'},'exchange-test');db=getFirestore(app);service=saleExchangeService(db);});
test.after(async()=>{if(enabled){await env.cleanup();await deleteApp(app);}});
async function setup({price=10,stock=3,finance=false,variable=false}={}){
 const bid=`ex-${Date.now()}-${++n}`,space=`space-${bid}`,uid=`owner-${bid}`,seller=`seller-${bid}`,root=db.doc(`businesses/${bid}`);
 await root.set({ownerId:uid,active:true,workspaceGeneration:0,subscription:{status:'active',planId:'professional'}});
 for(const [id,role]of [[uid,'owner'],[seller,'seller']]){await db.doc(`users/${id}`).set({uid:id,businessId:bid,active:true,role});await root.collection('members').doc(id).set({uid:id,role,status:'active',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'sales.view':true,'sales.create':true,'sales.cancel':true,'products.view':true,'financial.view':false}});}
 await db.doc(`financialSpaces/${space}`).set({id:space,businessId:bid,linkedBusinessId:bid,ownerUid:uid,active:true,type:'business',capabilities:{finance,sales:true},automation:{enabled:true,activatedAt:'2020-01-01T00:00:00Z',defaultIncomeFinancialAccountId:'cash',autoIncome:{sales:true}}});
 await db.doc(`financialSpaces/${space}/financialAccounts/cash`).set({ownerUid:uid,active:true,accessMode:'single_space',defaultFinancialSpaceId:space,currentBalanceCents:0});
 for(const [id,qty,p]of [['old',0,10],['new',stock,price]])await root.collection('products').doc(id).set({id,businessId:bid,nome:`QA ${id}`,active:true,productType:id==='new'&&variable?'variable':'simple',estoqueAtual:qty,estoque:qty,totalStock:qty,preco:p,spaceAccessMode:'selected_spaces',allowedSpaceIds:[space]});
 if(variable)await root.collection('productVariants').doc('variant').set({id:'variant',businessId:bid,parentProductId:'new',active:true,stock,price,displayName:'Azul / M'});
 const sale={id:'original',businessId:bid,spaceId:space,status:'pago',formaPagamento:'dinheiro',clienteId:'client',valorFinal:20,itens:[{produtoId:'old',nome:'QA original',quantidade:2,precoUnitario:10}]};
 await root.collection('sales').doc('original').set(sale);
 await root.collection('clients').doc('client').set({id:'client',businessId:bid,workspaceGeneration:0,nome:'QA Cliente',active:true});
 const request={auth:{uid},data:{businessId:bid,workspaceGeneration:0,saleId:'original',reason:'QA tamanho',returns:[{line:0,quantity:1,restock:true}],replacements:[{productId:'new',variantId:variable?'variant':null,quantity:1}],paymentMethod:'dinheiro'}};
 return {bid,space,uid,seller,root,sale,request};
}
async function confirm(c,id='exchange-one'){const q=await service.quote(c.request);return service.confirm({...c.request,data:{...c.request.data,operationId:id,fingerprint:q.fingerprint}});}
const rows=async(c,name)=>(await c.root.collection(name).get()).docs.map(d=>d.data());
t('seller autorizado: uma venda original imutável, dois movimentos e escopo explícito',async()=>{const c=await setup();c.request.auth.uid=c.seller;await confirm(c);assert.deepEqual((await c.root.collection('sales').doc('original').get()).data(),c.sale);assert.equal((await rows(c,'sales')).length,1);assert.equal((await rows(c,'saleExchanges')).length,1);const m=await rows(c,'stockMovements');assert.equal(m.length,2);assert.ok(m.every(x=>x.businessId===c.bid&&x.spaceId===c.space));assert.equal((await c.root.collection('products').doc('new').get()).data().estoqueAtual,2);assert.equal((await c.root.collection('products').doc('old').get()).data().estoqueAtual,1);assert.equal((await rows(c,'payments')).length,0);});
t('duplo clique, resposta perdida e reload: mesmo ID não duplica',async()=>{const c=await setup(),q=await service.quote(c.request),r={...c.request,data:{...c.request.data,operationId:'same-id',fingerprint:q.fingerprint}};await Promise.all([service.confirm(r),service.confirm(r)]);assert.equal((await service.confirm(JSON.parse(JSON.stringify(r)))).replayed,true);assert.equal((await rows(c,'saleExchanges')).length,1);assert.equal((await rows(c,'stockMovements')).length,2);});
t('mesmo ID com conteúdo diferente rejeitado',async()=>{const c=await setup(),q=await service.quote(c.request),r={...c.request,data:{...c.request.data,operationId:'same-id',fingerprint:q.fingerprint}};await service.confirm(r);await assert.rejects(service.confirm({...r,data:{...r.data,reason:'Mudou'}}),/outra troca/);});
t('duas operações concorrentes exigem nova revisão; não devolvem duas vezes silenciosamente',async()=>{const c=await setup(),q=await service.quote(c.request);const results=await Promise.allSettled(['one','two'].map(operationId=>service.confirm({...c.request,data:{...c.request.data,operationId,fingerprint:q.fingerprint}})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await rows(c,'saleExchanges')).length,1);});
t('estoque insuficiente: zero efeito',async()=>{const c=await setup({stock:0});await assert.rejects(confirm(c),/insuficiente/);assert.equal((await rows(c,'saleExchanges')).length,0);assert.equal((await rows(c,'stockMovements')).length,0);});
t('avaria não repõe estoque disponível',async()=>{const c=await setup();c.request.data.returns[0].restock=false;await confirm(c);assert.equal((await rows(c,'stockMovements')).length,1);assert.equal((await c.root.collection('products').doc('old').get()).data().estoqueAtual,0);});
t('variação baixa e atualiza agregado pai',async()=>{const c=await setup({variable:true});await confirm(c);assert.equal((await c.root.collection('productVariants').doc('variant').get()).data().stock,2);assert.equal((await c.root.collection('products').doc('new').get()).data().totalStock,2);});
t('crédito negativo separado: nenhum saldo/recebimento alterado',async()=>{const c=await setup({price:5});await confirm(c);assert.equal((await rows(c,'exchangeCredits'))[0].amountCents,500);assert.equal((await rows(c,'payments')).length,0);assert.equal((await rows(c,'balanceEvents')).length,0);});
t('finance=false: complemento não gera Financeiro',async()=>{const c=await setup({price:15});await confirm(c);const e=(await rows(c,'saleExchanges'))[0];const result=await financialIncomeService(db).projectExchange(c.bid,e.id,e);assert.equal(result.skipped,'finance-disabled');assert.equal((await db.collection(`financialSpaces/${c.space}/entries`).get()).size,0);});
t('finance=true: entrega duplicada gera uma receita no espaço correto',async()=>{const c=await setup({price:15,finance:true});await confirm(c);const e=(await rows(c,'saleExchanges'))[0],f=financialIncomeService(db);await Promise.all([f.projectExchange(c.bid,e.id,e),f.projectExchange(c.bid,e.id,e)]);const entries=(await db.collection(`financialSpaces/${c.space}/entries`).get()).docs;assert.equal(entries.length,1);assert.equal(entries[0].data().amountCents,500);assert.equal((await db.doc(`financialSpaces/${c.space}/financialAccounts/cash`).get()).data().currentBalanceCents,500);});
t('seller sem cancelamento e espaço diferente não autorizam troca',async()=>{const c=await setup();c.request.auth.uid=c.seller;await c.root.collection('members').doc(c.seller).update({permissions:{'sales.create':true,'sales.cancel':false}});await assert.rejects(confirm(c),/exige criar/);await c.root.collection('members').doc(c.seller).update({permissions:{'sales.create':true,'sales.cancel':true},allowedSpaceIds:['other-space']});await assert.rejects(confirm(c),/Espaço não autorizado/);});
t('Rules não permitem injetar troca, crédito, resumo nem editar venda já trocada',async()=>{const c=await setup();await confirm(c);const client=env.authenticatedContext(c.uid).firestore();for(const name of ['saleExchanges','exchangeCredits','saleExchangeSummaries'])await assertFails(sdk.setDoc(sdk.doc(client,`businesses/${c.bid}/${name}/forged`),{businessId:c.bid,spaceId:c.space}));await assertFails(sdk.updateDoc(sdk.doc(client,`businesses/${c.bid}/sales/original`),{status:'cancelado'}));});
t('fluxo completo: troca emite crédito, compra consome e cancelamento restaura exatamente uma vez',async()=>{
 const c=await setup({price:5,stock:4,finance:true});await confirm(c,'chain-exchange');
 const serviceCredit=creditService(db),base={businessId:c.bid,spaceId:c.space,workspaceGeneration:0,clientId:'client'},auth={uid:c.uid};
 assert.equal((await serviceCredit.available({auth,data:base})).availableCents,500);
 const data={...base,saleId:'chain-sale',operationId:'chain-buy',items:[{productId:'new',quantity:1}],creditCents:300,paymentMethod:'dinheiro'};
 const q=await serviceCredit.quote({auth,data}),request={auth,data:{...data,fingerprint:q.fingerprint}};
 await serviceCredit.confirm(request);await serviceCredit.confirm(request);
 assert.equal((await serviceCredit.available({auth,data:base})).availableCents,200);
 assert.equal((await rows(c,'sales')).length,2);assert.equal((await rows(c,'stockMovements')).length,3);
 const sale=(await c.root.collection('sales').doc('chain-sale').get()).data(),income=financialIncomeService(db);
 await income.projectSale(c.bid,'chain-sale',sale);assert.equal((await db.doc(`financialSpaces/${c.space}/financialAccounts/cash`).get()).data().currentBalanceCents,200);
 const cancel={auth,data:{...base,saleId:'chain-sale',operationId:'chain-cancel'}};await serviceCredit.cancel(cancel);await serviceCredit.cancel(cancel);
 const cancelled=(await c.root.collection('sales').doc('chain-sale').get()).data();await income.projectSale(c.bid,'chain-sale',cancelled,{before:sale});
 assert.equal((await serviceCredit.available({auth,data:base})).availableCents,500);
 assert.equal((await c.root.collection('products').doc('new').get()).data().estoqueAtual,3);
 assert.equal((await rows(c,'stockMovements')).length,4);assert.equal((await rows(c,'sales')).length,2);
 assert.equal((await db.doc(`financialSpaces/${c.space}/financialAccounts/cash`).get()).data().currentBalanceCents,0);
 assert.deepEqual((await c.root.collection('sales').doc('original').get()).data(),c.sale);
 assert.equal((await service.checkUndo(c.request)).allowed,false);
});
t('projeção mínima paginada é escopada e guard de cancelamento preserva venda sem troca',async()=>{
 const c=await setup();assert.equal((await service.checkUndo(c.request)).allowed,true);await confirm(c);
 const r=await service.adjustments({auth:{uid:c.seller},data:{businessId:c.bid,spaceId:c.space,workspaceGeneration:0}});
 assert.equal(r.businessId,c.bid);assert.equal(r.items.length,1);assert.equal(r.items[0].differenceCents,0);assert.equal('requestHash' in r.items[0],false);assert.equal('custo' in r.items[0],false);
 await assert.rejects(service.adjustments({auth:{uid:c.seller},data:{businessId:c.bid,spaceId:'other-space'}}),/não autorizado/);
});
