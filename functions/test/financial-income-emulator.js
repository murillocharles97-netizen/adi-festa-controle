'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {financialIncomeService}=require('../src/services/financial-income-service');

async function main(){
  // Mandatory BEFORE initializing Admin or deleting even synthetic data.
  if(!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore Emulator required; production is forbidden');
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test';
  if(projectId!=='adi-festa-variations-test'&&!projectId.startsWith('demo-'))throw Error('Synthetic Emulator project required');
  const suffix=randomUUID().slice(0,8),businessId='financial-routing-'+suffix,owner='qa-owner-'+suffix;
  const qa='qa-no-finance-'+suffix,a='finance-a-'+suffix,b='finance-b-'+suffix,legacy='business_'+businessId;
  const app=initializeApp({projectId},businessId),db=getFirestore(app),service=financialIncomeService(db),root=db.doc('businesses/'+businessId);
  const scenarios=[],at='2026-10-15T12:00:00.000Z',activation='2026-10-01T00:00:00.000Z';
  const source=(spaceId,extra={})=>({businessId,spaceId,financialSpaceId:spaceId,status:'pago',valorFinal:25,formaPagamento:'pix',data:at,workspaceGeneration:0,...extra});
  const put=async(kind,id,value)=>{await root.collection(kind).doc(id).set(value);return value;};
  const sale=async(id,space,extra={})=>{const value=source(space,extra);await put('sales',id,value);return service.projectSale(businessId,id,value);};
  const payment=async(id,space,extra={})=>{const value=source(space,{status:'applied',applicationStatus:'applied',valor:10,effectiveAmount:10,...extra});await put('payments',id,value);return service.projectPayment(businessId,id,value);};
  const entries=async space=>(await db.collection('financialSpaces/'+space+'/entries').get()).docs.map(s=>s.data());
  const account=space=>db.doc('financialSpaces/'+space+'/financialAccounts/cash');
  const balance=async space=>(await account(space).get()).data().currentBalanceCents;
  async function canonicalSale(space,id){
    // The REAL canonical sale/stock implementation, not a second checkout.
    const productId='product-'+id,data={produtos:[{id:productId,nome:'QA isolation only',preco:25,custo:5,estoqueAtual:2,estoque:2,ativo:true,spaceAccessMode:'selected_spaces',allowedSpaceIds:[space]}],variacoesProdutos:[],clientes:[],vendas:[],movimentacoes:[],movimentacoesEstoque:[]};
    const ctx={console,Date,structuredClone,Utils:{uuid:randomUUID},DB:{getBusinessId:()=>businessId,carregar:()=>data,alterar:fn=>fn(data)},TeamAccess:{has:()=>true,actor:()=>({actorUid:owner})},SpaceContext:{requireSalesSpace:()=>space},Campanhas:{aplicarBeneficios:items=>items,aplicarVendaNoBanco:()=>[]},dispatchEvent(){},CustomEvent:function(){}};
    ctx.window=ctx;vm.createContext(ctx);
    for(const file of ['js/product-variations.js','js/vendas.js'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8'),ctx);
    const draft={id,operationId:'qa-sale:'+id,spaceId:space,status:'pago',formaPagamento:'pix',itens:[{produtoId:productId,quantidade:1,precoOriginal:25,precoFinalUnitario:25}]};
    const value=JSON.parse(JSON.stringify(ctx.Vendas.registrar(draft)));ctx.Vendas.registrar(draft);
    assert.equal(data.vendas.length,1);assert.equal(data.produtos[0].estoqueAtual,1);assert.equal(data.movimentacoesEstoque.length,1);
    const batch=db.batch();batch.set(root.collection('sales').doc(id),value);batch.set(root.collection('products').doc(productId),data.produtos[0]);await batch.commit();
    return {value,project:()=>service.projectSale(businessId,id,value)};
  }
  try{
    await root.set({active:true,ownerId:owner,workspaceGeneration:0});
    for(const space of [qa,a,b,legacy]){
      await db.doc('financialSpaces/'+space).set({id:space,businessId,linkedBusinessId:businessId,ownerUid:owner,active:true,type:'business',capabilities:{finance:space!==qa,sales:true},automation:{enabled:true,activatedAt:activation,defaultIncomeFinancialAccountId:'cash',autoIncome:{sales:true,customerPayments:true,onlineOrders:true}}});
      await account(space).set({ownerUid:owner,active:true,accessMode:'single_space',defaultFinancialSpaceId:space,currentBalanceCents:0});
    }
    const historic=db.doc('financialSpaces/'+legacy+'/entries/sale_historical-qa-25');
    await historic.set({id:'sale_historical-qa-25',sourceId:'historical-qa-25',amountCents:2500,description:'Historical QA R$25 — must remain untouched',financialSpaceId:legacy});
    const originalHistoric=(await historic.get()).data();

    const q=await canonicalSale(qa,'qa-canonical');
    assert.equal((await q.project()).skipped,'finance-disabled');
    assert.equal((await q.project()).skipped,'finance-disabled');
    assert.equal((await entries(qa)).length,0);assert.equal(await balance(qa),0);
    assert.equal((await root.collection('products').doc('product-qa-canonical').get()).data().estoqueAtual,1);
    assert.equal((await payment('qa-receipt',qa)).skipped,'finance-disabled');
    assert.equal((await sale('qa-online',qa,{onlineOrderId:'qa-order',operationId:'online-sale:qa-order'})).skipped,'finance-disabled');
    assert.equal((await sale('qa-renewal',qa,{isSubscriptionRenewal:true,customerSubscriptionId:'qa-recurring'})).skipped,'finance-disabled');
    scenarios.push('QA finance=false: canonical sale/stock, receipt, online and recurring; no financial entry/account change');

    const real=await canonicalSale(a,'enabled-canonical');
    const delivered=await Promise.all([real.project(),real.project(),real.project()]);
    assert.equal(delivered.filter(r=>r.created).length,1);assert.equal(await balance(a),2500);
    assert.equal((await entries(a)).length,1);assert.equal((await entries(legacy)).length,1);
    assert.equal((await entries(a))[0].sourceSpaceId,a);
    scenarios.push('finance=true: canonical sale/stock and 3 concurrent deliveries -> one correct entry/event/account delta');
    assert.equal((await sale('space-b-sale',b)).created,true);
    assert.equal(await balance(b),2500);assert.equal(await balance(a),2500);
    assert.equal((await entries(a)).some(e=>e.sourceId==='space-b-sale'),false);
    const engineContext={console,Date};engineContext.window=engineContext;vm.createContext(engineContext);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../js/financial-engine.js'),'utf8'),engineContext);
    const consolidated=engineContext.FinancialEngine.consolidate([{entries:await entries(a)},{entries:await entries(b)},{entries:await entries(qa)}]);
    assert.equal(consolidated.summary.totalInCents,5000);assert.equal(consolidated.summary.resultCents,5000);
    assert.equal(consolidated.entries.some(entry=>entry.sourceSpaceId===qa),false);
    const moved=source(b);await put('sales','enabled-canonical',moved);
    assert.equal((await service.projectSale(businessId,'enabled-canonical',moved)).skipped,'source-route-conflict');
    await put('sales','enabled-canonical',real.value);
    scenarios.push('two spaces: distinct destinations and immutable source route prevent cross-space retry');

    assert.equal((await sale('historical-qa-25',qa)).skipped,'finance-disabled');
    assert.equal((await sale('historical-qa-25',a)).skipped,'historical-entry-in-other-space');
    assert.deepEqual((await historic.get()).data(),originalHistoric);
    assert.equal((await service.reconcileBusiness(businessId,{limit:200,force:true})).created,0);
    const old=source(a);await put('sales','old-metadata-only',old);
    assert.equal((await service.projectSale(businessId,'old-metadata-only',{...old,note:'metadata'},{before:old})).skipped,'historical-source-update-requires-review');
    scenarios.push('historical R$25 byte-equivalent; no copy, retro reconciliation or metadata-triggered backfill');

    const approved=source(b);await put('sales','stale-approval',{...approved,status:'cancelado'});
    assert.equal((await service.projectSale(businessId,'stale-approval',approved)).skipped,'stale-source-event');
    assert.equal((await sale('cancelled-before-receipt',b,{status:'cancelado'})).skipped,'original-missing');
    assert.equal((await sale('credit-sale',b,{status:'fiado'})).skipped,'credit-sale-not-realized');
    assert.equal((await sale('terminal-sale',b,{formaPagamento:'cartao_presencial'})).skipped,'terminal-payment-is-receivable');
    const cancelled={...real.value,status:'cancelado',reversedAt:at};await put('sales','enabled-canonical',cancelled);
    const reversed=await Promise.all([service.projectSale(businessId,'enabled-canonical',cancelled),service.projectSale(businessId,'enabled-canonical',cancelled)]);
    assert.equal(reversed.filter(r=>r.created).length,1);assert.equal(await balance(a),0);
    assert.equal((await db.doc('financialSpaces/'+a+'/entries/sale_enabled-canonical').get()).data().reversedAmountCents,2500);
    scenarios.push('cancellation + duplicate reversal atomic; late APPROVED, fiado and terminal create no improper income');

    assert.equal((await payment('received-b',b)).created,true);
    assert.equal(await balance(b),3500);assert.equal(await balance(a),0);
    assert.equal((await service.projectPayment(businessId,'received-b',(await root.collection('payments').doc('received-b').get()).data())).created,false);
    assert.equal((await payment('direct-sale-payment',b,{saleId:'space-b-sale'})).skipped,'sale-receipt-is-canonical');
    assert.equal((await sale('recurring-sale',a,{isSubscriptionRenewal:true,customerSubscriptionId:'recurring-a'})).created,true);
    await db.doc('financialSpaces/'+a).update({'automation.autoIncome.onlineOrders':false});
    assert.equal((await sale('online-flag',a,{operationId:'online-sale:order-disabled'})).skipped,'online-orders-disabled');
    await db.doc('financialSpaces/'+a).update({'automation.autoIncome.onlineOrders':true});
    assert.equal((await sale('online-enabled',a,{operationId:'online-sale:order-ok'})).entry.relatedOrderId,'order-ok');
    const pending=source(a,{applicationStatus:'pending',status:'pending_sync',effectiveAmount:10});
    await put('payments','no-repair',pending);
    assert.equal((await service.projectPayment(businessId,'no-repair',pending)).skipped,'payment-not-applied');
    assert.deepEqual((await root.collection('payments').doc('no-repair').get()).data(),pending);
    assert.equal((await root.collection('balanceEvents').doc('payment_received:no-repair').get()).exists,false);
    scenarios.push('receipts and recurring sales use same explicit route; online V2 flag honored; pending payment not repaired');

    const unscoped=source(a);delete unscoped.spaceId;delete unscoped.financialSpaceId;
    assert.equal((await service.projectSale(businessId,'missing-space',unscoped)).skipped,'source-space-required');
    assert.equal((await service.projectSale(businessId,'wrong-business',source(a,{businessId:'another-business'}))).skipped,'source-business-mismatch');
    assert.equal((await service.projectSale('another-business','space-from-a',source(a,{businessId:'another-business'}))).skipped,'space-business-mismatch');
    assert.equal((await sale('wrong-financial-space',a,{financialSpaceId:b})).skipped,'source-space-conflict');
    // TOCTOU: disable after preflight, before the transactional write.
    const toggle=source(a);await put('sales','toggle-in-flight',toggle);
    const nativeRun=db.runTransaction.bind(db);let first=true;
    db.runTransaction=async(fn,...args)=>{if(first){first=false;await db.doc('financialSpaces/'+a).update({'capabilities.finance':false});}return nativeRun(fn,...args);};
    assert.equal((await service.projectSale(businessId,'toggle-in-flight',toggle)).skipped,'finance-disabled');
    db.runTransaction=nativeRun;
    await db.doc('financialSpaces/'+a).update({'capabilities.finance':true});
    scenarios.push('missing origin, business mismatch, conflicting alias, concurrent finance disable all fail closed');

    // Configured shared bank accounts remain supported, but the entry stays in A.
    await account(legacy).update({accessMode:'all_spaces'});
    await db.doc('financialSpaces/'+a).update({'automation.defaultIncomeFinancialAccountHomeSpaceId':legacy});
    const shared=await sale('explicit-shared-account',a);
    assert.equal(shared.entry.financialSpaceId,a);assert.equal(shared.entry.financialAccountHomeSpaceId,legacy);
    assert.equal(await balance(legacy),2500);assert.equal((await entries(legacy)).length,1);
    // A reversal must not select a newly configured account absent from its income.
    await db.doc('financialSpaces/'+b).update({'automation.defaultIncomeFinancialAccountId':null});
    const noAccount=source(b);await put('sales','no-bank-income',noAccount);
    assert.equal((await service.projectSale(businessId,'no-bank-income',noAccount)).entry.financialAccountId,null);
    const bankBefore=await balance(b);
    await db.doc('financialSpaces/'+b).update({'automation.defaultIncomeFinancialAccountId':'cash'});
    const refund={...noAccount,status:'cancelado',reversedAt:at};await put('sales','no-bank-income',refund);
    assert.equal((await service.projectSale(businessId,'no-bank-income',refund)).entry.financialAccountId,null);
    assert.equal(await balance(b),bankBefore);
    scenarios.push('explicitly shared account preserved; cancellation never credits/debits a newly configured bank');

    const network=source(b);await put('sales','network-retry',network);
    const networkBalance=await balance(b);
    db.runTransaction=async()=>{throw Error('QA network failed before commit');};
    await assert.rejects(service.projectSale(businessId,'network-retry',network),/network failed/);
    db.runTransaction=nativeRun;
    assert.equal(await balance(b),networkBalance);
    assert.equal((await service.projectSale(businessId,'network-retry',network)).created,true);
    const lost=source(b);await put('sales','lost-response',lost);
    db.runTransaction=async(...args)=>{await nativeRun(...args);throw Error('QA response lost after commit');};
    await assert.rejects(service.projectSale(businessId,'lost-response',lost),/response lost/);
    db.runTransaction=nativeRun;
    assert.equal((await service.projectSale(businessId,'lost-response',lost)).created,false);
    assert.equal(await balance(b),networkBalance+5000);
    scenarios.push('network failure before commit and lost response after commit both recover without duplicate income');
    assert.deepEqual((await historic.get()).data(),originalHistoric);
    return {ok:true,scenarios,historical2500Preserved:true,productionAccess:false};
  }finally{
    for(const id of [qa,a,b,legacy])await db.recursiveDelete(db.doc('financialSpaces/'+id));
    await db.recursiveDelete(root);await deleteApp(app);
  }
}
module.exports={main};
if(require.main===module)main().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
