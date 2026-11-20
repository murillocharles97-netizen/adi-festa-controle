'use strict';
// V240 — linking a manual financial space (e.g. Táxi, type "other") to its own
// sales. Synthetic data, Firestore Emulator only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {financialIncomeService}=require('../src/services/financial-income-service');
const {financialSpaceAutomationService}=require('../src/services/financial-space-automation-service');

async function main(){
  if(!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore Emulator required; production is forbidden');
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test';
  if(projectId!=='adi-festa-variations-test'&&!projectId.startsWith('demo-'))throw Error('Synthetic Emulator project required');
  const s=randomUUID().slice(0,8),bid='taxi-link-'+s,other='taxi-other-biz-'+s,owner='qa-owner-'+s,seller='qa-seller-'+s;
  const TAXI='qa-taxi-'+s,STORE='business_'+bid,FOREIGN='qa-foreign-'+s,NOFIN='qa-nofin-'+s;
  const app=initializeApp({projectId},bid),db=getFirestore(app),income=financialIncomeService(db),root=db.doc('businesses/'+bid);
  let clock=new Date('2026-11-20T12:00:00.000Z');
  const auto=financialSpaceAutomationService(db,{now:()=>clock});
  const scenarios=[];
  const code=async(promise,expected)=>{try{await promise;}catch(e){assert.equal(e.code,expected,e.message);return e;}assert.fail('expected '+expected);};
  const req=(uid,data)=>({auth:uid?{uid}:null,data:{businessId:bid,spaceId:TAXI,...data}});
  const enable={enabled:true,sales:true,customerPayments:true,onlineOrders:false,defaultIncomeFinancialAccountId:null};
  const entries=async space=>(await db.collection(`financialSpaces/${space}/entries`).get()).docs.map(d=>d.data());
  const snapshotAll=async space=>Object.fromEntries(await Promise.all(['entries','financialAccounts','creditCards','events'].map(async c=>
    [c,(await db.collection(`financialSpaces/${space}/${c}`).get()).docs.map(d=>[d.id,d.data()]).sort()])));
  const sale=async(id,space,extra={})=>{const v={businessId:bid,spaceId:space,financialSpaceId:space,status:'pago',formaPagamento:'pix',valorFinal:180,data:clock.toISOString(),workspaceGeneration:0,...extra};
    await root.collection('sales').doc(id).set(v);return {v,project:()=>income.projectSale(bid,id,v)};};
  const payment=async(id,space,valor,extra={})=>{const v={businessId:bid,spaceId:space,financialSpaceId:space,status:'applied',applicationStatus:'applied',valor,effectiveAmount:valor,
    clienteId:'qa-client',data:clock.toISOString(),workspaceGeneration:0,...extra};await root.collection('payments').doc(id).set(v);return income.projectPayment(bid,id,v);};
  try{
    await root.set({active:true,ownerId:owner,workspaceGeneration:0});
    await db.doc('businesses/'+other).set({active:true,ownerId:owner,workspaceGeneration:0});
    const space=(id,extra)=>db.doc('financialSpaces/'+id).set({id,businessId:bid,ownerUid:owner,active:true,status:'active',...extra});
    // Táxi as found in the audit: type "other", no linkedBusinessId, no automation, manual history.
    await space(TAXI,{name:'Táxi QA',type:'other',linkedBusinessId:null,operationalType:'operation',capabilities:{finance:true,sales:true}});
    await space(STORE,{name:'Loja QA',type:'business',linkedBusinessId:bid,capabilities:{finance:true,sales:true},
      automation:{enabled:true,linkedBusinessId:bid,activatedAt:'2026-01-01T00:00:00.000Z',autoIncome:{sales:true,customerPayments:true,onlineOrders:true}}});
    await space(FOREIGN,{name:'Outra QA',type:'other',businessId:other,linkedBusinessId:null,capabilities:{finance:true,sales:true}});
    await space(NOFIN,{name:'Sem financeiro',type:'other',linkedBusinessId:null,capabilities:{finance:false,sales:true}});
    for(const [id,e] of [['manual-in',{direction:'in',sourceType:'manual_income',amountCents:450000,description:'Corridas (manual)'}],
      ['fuel',{direction:'out',sourceType:'credit_card_purchase',amountCents:16302,description:'Etanol'}]])
      await db.doc(`financialSpaces/${TAXI}/entries/${id}`).set({id,financialSpaceId:TAXI,status:'paid',occurredAt:'2026-10-07T15:00:00.000Z',...e});
    await db.doc(`financialSpaces/${TAXI}/financialAccounts/cash`).set({ownerUid:owner,active:true,accessMode:'single_space',defaultFinancialSpaceId:TAXI,currentBalanceCents:12345});
    await db.doc(`financialSpaces/${STORE}/financialAccounts/store-cash`).set({ownerUid:owner,active:true,accessMode:'single_space',defaultFinancialSpaceId:STORE,currentBalanceCents:0});
    const preserved=await snapshotAll(TAXI);

    // Before linking: manual space ignores sales (current production behavior).
    clock=new Date('2026-11-19T12:00:00.000Z');
    const ride=await sale('ride-180',TAXI);
    assert.equal((await ride.project()).skipped,'automation-disabled');
    clock=new Date('2026-11-20T12:00:00.000Z');
    scenarios.push('manual Táxi space: paid sale not projected (explains R$ 0 in Financeiro)');

    // Authorization and integrity, validated on the server.
    await code(auto.configure(req(null,{operationId:'op-unauth-0001',expectedRevision:0,...enable})),'unauthenticated');
    await code(auto.configure(req(seller,{operationId:'op-seller-0001',expectedRevision:0,...enable})),'permission-denied');
    await code(auto.configure(req(owner,{spaceId:FOREIGN,operationId:'op-foreign-001',expectedRevision:0,...enable})),'permission-denied');
    await code(auto.configure(req(owner,{spaceId:NOFIN,operationId:'op-nofin-0001',expectedRevision:0,...enable})),'failed-precondition');
    await code(auto.configure(req(owner,{operationId:'op-account-001',expectedRevision:0,...enable,defaultIncomeFinancialAccountId:'store-cash',defaultIncomeFinancialAccountHomeSpaceId:STORE})),'failed-precondition');
    await code(auto.configure(req(owner,{operationId:'op-stale-00001',expectedRevision:7,...enable})),'aborted');
    assert.equal((await db.doc('financialSpaces/'+TAXI).get()).data().automation,undefined);
    scenarios.push('server rejects: no auth, non-owner, other company, finance off, foreign account, stale revision');

    // Concurrent enable: exactly one wins; same id replays.
    const results=await Promise.allSettled([
      auto.configure(req(owner,{operationId:'op-enable-0001',expectedRevision:0,...enable,defaultIncomeFinancialAccountId:'cash'})),
      auto.configure(req(owner,{operationId:'op-enable-0002',expectedRevision:0,...enable}))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'aborted');
    const winner=results.find(r=>r.status==='fulfilled').value,winId=winner.operationId;
    const replay=await auto.configure(req(owner,{operationId:winId,expectedRevision:0,...enable,defaultIncomeFinancialAccountId:winId==='op-enable-0001'?'cash':null}));
    assert.equal(replay.replayed,true);assert.equal(replay.revision,1);
    await code(auto.configure(req(owner,{operationId:winId,expectedRevision:1,...enable,sales:false})),'already-exists');
    const linked=(await db.doc('financialSpaces/'+TAXI).get()).data();
    assert.equal(linked.type,'other');assert.equal(linked.linkedBusinessId,null);
    assert.equal(linked.automation.linkedSalesSpaceId,TAXI);assert.equal(linked.automation.linkedBusinessId,bid);
    assert.equal(linked.automation.activatedAt,'2026-11-20T12:00:00.000Z');assert.equal(linked.automationRevision,1);
    assert.deepEqual(await snapshotAll(TAXI),preserved,'entries, accounts, cards and events untouched');
    scenarios.push('concurrent link: one wins, replay idempotent, reused id refused; same space id, type kept, data preserved');

    // Only events after activation; Fiado is not cash; partial receipt by amount received.
    assert.equal((await ride.project()).skipped,'before-activation');
    clock=new Date('2026-11-20T13:00:00.000Z');
    const fiado=await sale('ride-fiado',TAXI,{status:'fiado',formaPagamento:'fiado'});
    assert.equal((await fiado.project()).skipped,'credit-sale-not-realized');
    assert.equal((await payment('partial-50',TAXI,50)).created,true);
    const fuel=require('../src/shared/flexible-service');
    const estimate=fuel.estimate({model:'fuel',kmPerLiter:8,pricePerLiter:3.7,feePercent:0},{version:1,id:'qa-execution-240',configurationId:'qa-config-240',km:20,minutes:0,source:'particular',calculationVersion:2},90);
    const paid=await sale('ride-paid',TAXI,{valorFinal:90,itens:[{produtoId:'qa-ride',quantidade:1,serviceCostSnapshot:estimate}]});
    const delivered=await Promise.all([paid.project(),paid.project(),paid.project()]);
    assert.equal(delivered.filter(r=>r.created).length,1);
    const auto1=(await entries(TAXI)).filter(e=>!['manual-in','fuel'].includes(e.id));
    assert.deepEqual(auto1.map(e=>e.amountCents).sort((a,b)=>a-b),[5000,9000]);
    assert.ok(auto1.every(e=>e.direction==='in'&&e.financialSpaceId===TAXI));
    assert.equal((await entries(TAXI)).filter(e=>e.direction==='out').length,1,'expenses stay manual');
    assert.equal(estimate.fuel.estimatedCost,9.25);
    assert.equal((await entries(TAXI)).some(e=>e.direction==='out'&&e.sourceId==='ride-paid'),false,'fuel estimate is not a cash expense');
    for(const [id,amount] of [['manual-maintenance',12000],['manual-toll',750]])
      await db.doc(`financialSpaces/${TAXI}/entries/${id}`).set({id,financialSpaceId:TAXI,direction:'out',sourceType:'manual_expense',status:'paid',amountCents:amount});
    assert.equal((await entries(TAXI)).filter(e=>e.direction==='out').length,3);
    scenarios.push('fuel estimate R$9.25 does not create an expense; maintenance and toll remain manual');
    scenarios.push('after activation: old ride not imported, Fiado skipped, partial receipt R$50, paid ride once under 3 deliveries');

    // No redirection between spaces; changing a projected sale's space is refused.
    await sale('store-sale',STORE,{valorFinal:25}).then(x=>x.project());
    assert.equal((await entries(TAXI)).some(e=>e.sourceId==='store-sale'),false);
    assert.equal((await entries(STORE)).some(e=>e.sourceId==='ride-paid'),false);
    const moved={...paid.v,spaceId:STORE,financialSpaceId:STORE};await root.collection('sales').doc('ride-paid').set(moved);
    assert.equal((await income.projectSale(bid,'ride-paid',moved)).skipped,'source-route-conflict');
    scenarios.push('isolation: Táxi and store keep their own revenue; space change after projection refused');

    // Balance regularization is a balanceAdjustment, never revenue: no income projector exists for it.
    const index=fs.readFileSync(path.resolve(__dirname,'../src/index.js'),'utf8');
    assert.doesNotMatch(index,/balanceAdjustments\/\{[^}]+\}'\},[^\n]*financialIncome/);
    scenarios.push('regularization (balanceAdjustments) has no income projector');

    // Reversible: undo the last change restores the previous state; history stays.
    const before=(await entries(TAXI)).length;
    const undo=await auto.configure(req(owner,{operationId:'op-revert-0001',expectedRevision:1,revertOperationId:winId}));
    assert.equal(undo.revision,2);
    const reverted=(await db.doc('financialSpaces/'+TAXI).get()).data();
    assert.equal(reverted.automation,undefined);assert.equal(reverted.automationRevision,2);
    clock=new Date('2026-11-20T14:00:00.000Z');
    assert.equal((await (await sale('ride-after-undo',TAXI)).project()).skipped,'automation-disabled');
    assert.equal((await entries(TAXI)).length,before);
    await code(auto.configure(req(owner,{operationId:'op-revert-0002',expectedRevision:2,revertOperationId:winId})),'failed-precondition');
    // Re-enabling uses a NEW activation instant: nothing from the off period is imported.
    const again=await auto.configure(req(owner,{operationId:'op-enable-0003',expectedRevision:2,...enable}));
    assert.equal(again.automation.activatedAt,'2026-11-20T14:00:00.000Z');
    const audit=(await db.collection(`financialSpaces/${TAXI}/automationChanges`).get()).docs.map(d=>d.data().kind).sort();
    assert.deepEqual(audit,['configure','configure','revert']);
    scenarios.push('rollback: undo restores manual mode, keeps entries; re-enable gets new activation; audit trail kept');

    console.log(JSON.stringify({ok:true,scenarios},null,1));
  }finally{await deleteApp(app);}
}
main().catch(e=>{console.error(e);process.exit(1);});
