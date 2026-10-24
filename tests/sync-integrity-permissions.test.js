'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {harness,operational}=require('./helpers/sync-integrity-scope-harness.cjs');
const documents={products:[{id:'p',nome:'QA',preco:10,estoque:3}],productVariants:[{id:'v',parentProductId:'p',stock:2}],clients:[{id:'c',nome:'QA',saldo:0}],sales:[{id:'s',operationId:'sale-op',spaceId:'qa-space',status:'pago',valorFinal:10}],payments:[{id:'pay',clienteId:'c',valor:5,saldoAnterior:-5,saldoNovo:0,data:'2026-10-19T10:00:00Z'}],balanceAdjustments:[]};
const privateNames=['payments','balanceAdjustments','balanceEvents','productFinancials','variantFinancials','saleFinancials'];
test('seller complete audit reads only operational permissions; no forbidden request or fake financial zero',async()=>{
  const h=harness({documents}),before=JSON.stringify(h.local),report=await h.compare();
  assert.deepEqual(h.reads,['products','productVariants','clients','sales']);
  for(const name of privateNames){assert.equal(h.reads.includes(name),false);assert.equal(h.localReads.includes(name),false);assert.equal(report.collections[name],undefined);}
  assert.equal(report.financial.status,'not_audited');assert.equal(report.financial.localBalance,undefined);
  assert.equal(report.financial.message,'Financeiro não auditado neste perfil');
  assert.equal(report.auditScope.financialAudited,false);assert.equal(report.integrity.actionable,false);
  assert.equal(h.s.state.integrityStatus,'completed');assert.equal(h.s.state.integrityFailure,null);
  assert.equal(JSON.stringify(h.local),before);assert.equal(JSON.stringify(h.queue),h.beforeQueue);
  const html=h.html(report);assert.match(html,/Financeiro não auditado neste perfil/);assert.match(html,/no escopo auditado/);
  assert.doesNotMatch(html,/Saldos assinados|Auditoria dos saldos|Saldo ativo:|R\$ 0,00/);
});
test('owner complete audit retains payments, adjustments, projections and canonical ledger reads',async()=>{
  const h=harness({role:'owner',permissions:['*'],documents}),report=await h.compare();
  for(const name of privateNames)assert.equal(h.reads.includes(name),true,name);
  assert.equal(report.financial.status,'audited');assert.equal(report.financial.balanceAudit.clientsChecked,1);
  assert.equal(report.financial.balanceAudit.ledgerEvents,1);assert.equal(report.auditScope.financialAudited,true);
  assert.equal(h.s.state.integrityStatus,'completed');assert.match(h.html(report),/Auditoria dos saldos/);
});
test('effective permissions, not seller role label, decide audit scope',async()=>{
  for(const permission of ['financial.view','customers.receiveDebt','customers.adjustBalance']){
    const h=harness({permissions:[...operational,permission],documents}),report=await h.compare();
    assert.equal(report.auditScope.financialAudited,false);assert.equal(report.financial.reason,'partial_space_scope');assert.equal(h.reads.includes('payments'),true);
    assert.equal(h.reads.includes('balanceEvents'),false);
    h.context.spaceAccess='all';h.reads.length=0;const full=await h.compare();assert.equal(full.auditScope.financialAudited,true);
    assert.equal(h.reads.includes('balanceEvents'),true);assert.equal(h.reads.includes('productFinancials'),false);
  }
});
test('prefetched financial data is not consumed or exposed when the current seller cannot read it',async()=>{
  const h=harness({documents}),entries=Object.entries(documents).map(([name,rows])=>({name,documents:rows}));
  for(const name of privateNames.filter(n=>!entries.some(e=>e.name===n)))entries.push({name,documents:[{id:'private',amount:99999}]});
  const report=await h.compare({prefetched:{businessId:'qa-audit',sessionScope:h.s.namespace(),entries}});
  assert.equal(h.reads.length,0);assert.equal(report.financial.status,'not_audited');
  assert.equal(JSON.stringify(report).includes('99999'),false);assert.equal(JSON.stringify(report).includes('"pay"'),false);
});
test('login/reload and owner -> seller -> owner preserve isolated audit results and original queue',async()=>{
  const h=harness({role:'owner',permissions:['*'],documents});await h.compare();
  for(const [role,permissions]of [['seller',operational],['seller',operational],['owner',['*']],['owner',['*']],['seller',operational]]){
    h.identity(role,permissions);h.reads.length=0;const report=await h.compare();
    assert.equal(report.auditScope.financialAudited,role==='owner');assert.equal(h.reads.includes('payments'),role==='owner');
    assert.equal(h.s.state.integrityStatus,'completed');assert.equal(JSON.stringify(h.queue),h.beforeQueue);
  }
});
test('manual Sync and audit complete for seller without permission-denied, upload or queue rewrite',async()=>{
  const h=harness({documents}),result=await h.manualSync();
  assert.equal(result.complete,true);assert.equal(result.dataSynced,true);assert.equal(result.sent,0);
  assert.equal(result.integrityStatus,'completed');assert.equal(h.s.state.integrityFailure,null);
  assert.equal(h.reads.includes('payments'),false);assert.equal(JSON.stringify(h.queue),h.beforeQueue);
});
test('manual owner Sync keeps full financial audit',async()=>{
  const h=harness({role:'owner',permissions:['*'],documents}),result=await h.manualSync();
  assert.equal(result.complete,true);assert.equal(result.integrityStatus,'completed');assert.equal(h.reads.includes('payments'),true);
});
test('real permission/network errors on an authorized collection remain failures, never silently skipped',async()=>{
  for(const role of ['owner','seller']){
    const h=harness({role,permissions:role==='owner'?['*']:operational,documents,read:async name=>{
      if(name==='clients')throw Object.assign(Error('genuine denied'),{code:'permission-denied'});return documents[name]||[];
    }});
    await assert.rejects(h.compare(),{code:'permission-denied'});assert.equal(h.s.state.integrityStatus,'failed');
    assert.equal(h.s.state.integrityFailure.collection,'clients');assert.equal(JSON.stringify(h.queue),h.beforeQueue);
  }
});
test('genuine authorized operational differences still alert even when Finance is skipped',async()=>{
  const h=harness({documents,localDocuments:{...documents,products:[{...documents.products[0],estoque:99}]}}),report=await h.compare();
  assert.equal(report.financial.status,'not_audited');assert.equal(report.integrity.actionable,true);
  assert.ok(report.integrity.issues.some(x=>x.entityType==='products'));assert.match(h.html(report),/Financeiro não auditado neste perfil/);
});
test('no customer/sales access means not audited, not a zero ledger or missing data',async()=>{
  const h=harness({role:'stock',permissions:['products.view'],documents}),report=await h.compare();
  assert.equal(report.clients.status,'not_audited');assert.equal(report.financial.status,'not_audited');
  assert.equal(h.reads.includes('clients'),false);assert.equal(h.reads.includes('sales'),false);
  assert.match(h.html(report),/Não auditado neste perfil/);
});
test('missing permission resolver fails closed without making financial reads',async()=>{
  const h=harness({documents});h.s.TeamAccess=null;const report=await h.compare();
  assert.equal(h.reads.length,0);assert.equal(report.auditScope.financialAudited,false);
});
test('obsolete audit cannot publish into the new identity or resume later financial reads',async()=>{
  let resolveRead,entered;const ready=new Promise(resolve=>entered=resolve);
  const h=harness({documents,read:async name=>{if(name==='products'){entered();return new Promise(resolve=>resolveRead=resolve);}return documents[name]||[];}});
  const pending=h.compare();await ready;h.identity('owner',['*']);resolveRead(documents.products);
  await assert.rejects(pending,{code:'sync-session-retired'});
  assert.equal(h.s.state.dataAudit,null);assert.equal(h.s.state.integrityStatus,'not_checked');assert.equal(h.reads.includes('payments'),false);
});
test('technical count comparison never treats unread financial sources as zero/divergent for seller; owner still compares them',async()=>{
  const source=fs.readFileSync('js/firebase/sync.js','utf8');
  for(const role of ['seller','owner']){
    const h=harness({role,permissions:role==='owner'?['*']:operational,documents}),s=h.s;
    s.localSummary=()=>({clientes:1,produtos:1,vendas:1,pagamentos:4,fiado:40});
    s.state.cloudCounts={clients:1,products:1,sales:1,payments:0};s.state.cloudFinancial={fiado:0};s.state.cloudNewest={};
    vm.runInContext(source.slice(source.indexOf('async function compareLocalAndCloud('),source.indexOf('function describeSyncResult(')),s);
    const result=await s.compareLocalAndCloud();assert.equal(result.ok,role==='seller');
    assert.equal(result.scope.financialAudited,role==='owner');assert.equal(result.scope.collections.includes('payments'),role==='owner');
    s.state.cloudCounts.products=2;assert.equal((await s.compareLocalAndCloud()).ok,false);
  }
});
test('authorized owner financial denials are still reported with exact collection instead of being called permission-scope skips',async()=>{
  for(const failed of ['payments','balanceEvents']){
    const h=harness({role:'owner',permissions:['*'],documents,read:async name=>{
      if(name===failed)throw Object.assign(Error('authorized read denied'),{code:'permission-denied'});return documents[name]||[];
    }});
    await assert.rejects(h.compare(),{code:'permission-denied'});assert.equal(h.s.state.integrityStatus,'failed');
    assert.equal(h.s.state.integrityFailure.collection,failed);assert.equal(h.s.state.dataAudit,null);
  }
});
test('financial read without all authorized ledger sources is explicitly incomplete and never invents a balanced ledger',async()=>{
  const h=harness({permissions:['products.view','financial.view'],documents});h.context.spaceAccess='all';const report=await h.compare();
  assert.equal(report.financial.status,'not_audited');assert.equal(report.financial.reason,'incomplete_authorized_sources');
  assert.equal(report.financial.balanceAudit,undefined);assert.equal(h.reads.includes('balanceEvents'),false);
});
test('prefetch from another identity/permission namespace is never reused even inside the same business',async()=>{
  const h=harness({documents}),report=await h.compare({prefetched:{businessId:'qa-audit',sessionScope:'old-owner-namespace',entries:[{name:'sales',documents:[{id:'foreign-space',valorFinal:999999}]}]}});
  assert.equal(h.reads.includes('sales'),true);assert.equal(JSON.stringify(report).includes('foreign-space'),false);
});
