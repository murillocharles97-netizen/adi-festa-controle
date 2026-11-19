'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const source=require('node:path').resolve(process.env.VECONI_TEST_FUNCTION_SOURCE||'functions');
const {operationalCommitService}=require(source+'/src/services/operational-commit-service');
const {readHistoryInput}=require(source+'/src/services/fiado-history-service'),History=require(source+'/src/shared/fiado-history-account');
let app,db,seq=0;
test.before(()=>{app=initializeApp({projectId:'demo-veconi-space-regularization'},'regularization');db=getFirestore(app);});
test.after(async()=>{await db.terminate();await deleteApp(app);});
async function setup(){
 const bid='regularization-'+crypto.randomUUID(),owner='owner-'+(++seq),space='taxi-'+bid,other='store-'+bid,clientId='qa-client',root=db.doc('businesses/'+bid);
 await root.set({businessId:bid,ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const [uid,role]of [[owner,'owner'],['seller-'+seq,'seller'],['manager-'+seq,'manager']]){
  await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role});
  await root.collection('members').doc(uid).set({uid,role,status:'active',spaceAccess:'all',permissionsVersion:2,permissions:{'customers.view':true,'customers.adjustBalance':true,'customers.receiveDebt':true,'sales.create':true}});
 }
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,active:true,type:'business',ownerUid:owner,capabilities:{sales:true,finance:true}});
 await root.collection('clients').doc(clientId).set({id:clientId,businessId:bid,nome:'Pessoa QA',saldo:0,financialVersion:0,workspaceGeneration:0,active:true,ativo:true,customerSpaceIds:[space,other]});
 const writer=operationalCommitService(db),reader=process.env.VECONI_TEST_RECEIPT_SOURCE?require(require('path').resolve(process.env.VECONI_TEST_RECEIPT_SOURCE,'src/services/operational-commit-service')).operationalCommitService(db):writer;
 const svc={commit:writer.commit,receipt:reader.receipt},req=(kind,input={},uid=owner)=>({auth:{uid},data:{businessId:bid,workspaceGeneration:0,spaceId:space,clientId,kind,...input}});
 const preview=extra=>svc.receipt(req('fiado_space_regularization_preview',extra));
 const intent=async(total,extra={})=>{const q=await preview(extra);return req('fiado_space_regularization',{...extra,operationId:crypto.randomUUID(),quoteHash:q.quoteHash,financialVersion:q.financialVersion,targetDebtCents:total,purpose:'historical_debt',reason:'Dívida anterior conferida em anotações',confirmed:true,localQueueChecked:true});};
 const apply=async(total,extra={})=>svc.commit(await intent(total,extra));
 const read=async(col,id)=>(await root.collection(col).doc(id).get()).data();
 const account=async()=>db.runTransaction(async tx=>{const client=await read('clients',clientId);return History.project(await readHistoryInput({tx,c:{bid,business:{workspaceGeneration:0},owner:true,has:()=>true,space:async()=>({})},ref:(b,col,id)=>db.doc(`businesses/${b}/${col}/${id}`),clientId,client}),undefined,{scoped:true});},{readOnly:true});
 return{bid,owner,space,other,clientId,root,svc,req,preview,intent,apply,read,account};
}
test('untouched zero: confirmed final 1889 creates only adjustment, proof and receipt, no fictitious sale/payment/cash/stock',async()=>{
 const c=await setup(),q=await c.preview();assert.equal(q.currentDebtCents,0);
 const request=await c.intent(188900),r=await c.svc.commit(request);assert.equal(r.newDebtCents,188900);
 assert.equal((await c.read('clients',c.clientId)).saldo,-1889);assert.equal((await c.account()).totalCents,188900);
 for(const col of ['sales','payments','stockMovements','paymentAllocations'])assert.equal((await c.root.collection(col).get()).size,0);
 assert.equal((await db.collection(`financialSpaces/${c.space}/entries`).get()).size,0);
 assert.equal((await c.root.collection('balanceAdjustments').get()).size,1);
 const again=await c.svc.commit(request);assert.equal(again.replayed,true);
 const status=await c.svc.receipt(c.req('fiado_space_regularization_status',{operationId:request.data.operationId}));assert.equal(status.status,'confirmed');
 assert.equal((await c.root.collection('balanceEvents').get()).size,1);
});
test('two spaces: current 180 to final 1889 applies only 1709; correction and zero preserve other-space debt',async()=>{
 const c=await setup();await c.apply(7000,{spaceId:c.other});await c.apply(18000);
 assert.equal((await c.preview()).currentDebtCents,18000);
 const r=await c.apply(188900);assert.equal(r.deltaDebtCents,170900);
 assert.equal((await c.read('clients',c.clientId)).saldo,-1959);
 await c.apply(15000);let a=await c.account();assert.equal(a.entries.filter(e=>e.spaceId===c.other).reduce((n,e)=>n+e.remainingCents,0),7000);
 await c.apply(0);a=await c.account();assert.equal(a.totalCents,7000);assert.ok(a.entries.every(e=>e.spaceId===c.other));
});
test('simultaneous confirmations: one commits; stale quote cannot overwrite balance; original replay remains valid',async()=>{
 const c=await setup(),a=await c.intent(15000),b=await c.intent(19000);
 const results=await Promise.allSettled([c.svc.commit(a),c.svc.commit(b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'aborted');
 const winner=results[0].status==='fulfilled'?a:b;
 assert.equal((await c.svc.commit(winner)).replayed,true);
 await assert.rejects(c.svc.commit({...winner,data:{...winner.data,targetDebtCents:1}}),e=>e.code==='already-exists');
 assert.equal((await c.root.collection('balanceAdjustments').get()).size,1);
});
test('server blocks seller, subordinate manager, foreign tenant, unlinked space and forged generation',async()=>{
 const c=await setup();for(const uid of ['seller-'+seq,'manager-'+seq])await assert.rejects(c.svc.receipt(c.req('fiado_space_regularization_preview',{},uid)),e=>e.code==='permission-denied');
 await assert.rejects(c.svc.receipt({data:c.req('fiado_space_regularization_preview').data}),e=>e.code==='unauthenticated');
 await c.root.collection('members').doc('manager-'+seq).update({role:'owner'});
 await assert.rejects(c.svc.receipt(c.req('fiado_space_regularization_preview',{},'manager-'+seq)),e=>e.code==='permission-denied');
 await assert.rejects(c.svc.receipt(c.req('fiado_space_regularization_preview',{businessId:'foreign'})));
 await assert.rejects(c.preview({workspaceGeneration:1}));
 await c.root.collection('clients').doc(c.clientId).update({customerSpaceIds:[c.other]});await assert.rejects(c.preview(),/Vincule/);
});
test('pending receipt, unproved balance, invalid reason and absent explicit confirmation block without financial writes',async()=>{
 const c=await setup(),r=await c.intent(15000);
 for(const data of [{reason:'x'},{confirmed:false},{localQueueChecked:false},{targetDebtCents:-1},{targetDebtCents:1.5}])await assert.rejects(c.svc.commit({...r,data:{...r.data,...data}}));
 await c.root.collection('payments').doc('pending').set({id:'pending',businessId:c.bid,clienteId:c.clientId,status:'pending_sync',valor:70});
 await assert.rejects(c.preview(),/pendente/);await c.root.collection('payments').doc('pending').delete();
 await c.root.collection('clients').doc(c.clientId).update({saldo:-190});await assert.rejects(c.preview(),/comprovação|conferência/);
 assert.equal((await c.root.collection('balanceAdjustments').get()).size,0);
});
test('real existing receipt route can receive adjustment debt and preserves scoped receipt identity',async()=>{
 const c=await setup();await c.apply(15000);await c.apply(7000,{spaceId:c.other});
 const route=await c.svc.receipt(c.req('fiado_receipt_route',{scopedReceiptVersion:1}));
 assert.equal(route.mode,'space');assert.equal(route.dueCents,15000);assert.equal(route.scopedReceiptVersion,1);
});
test('partial receipt 70 leaves 80, other space stays 70, replay yields exactly one payment and cash entry',async()=>{
 const c=await setup();await c.apply(15000);await c.apply(7000,{spaceId:c.other});
 const route=await c.svc.receipt(c.req('fiado_receipt_route',{scopedReceiptVersion:1}));
 const h=require('../helpers/owner-receipt-v219.cjs').harness({businessId:c.bid,spaceId:c.space,uid:c.owner});
 try{
  Object.assign(h.rows(),{clientes:[await c.read('clients',c.clientId)],vendas:[],pagamentos:[],alocacoesPagamento:[]});
  h.w.SyncFirebase.assertFiadoReceiptQueueClear=()=>true;
  const payment=h.w.Fiados.receber(c.clientId,70,'Pix recebido em QA',{spaceId:c.space,paymentMethod:'pix',receiptRoute:route,fiadoAccount:route.scopedAccount});
  const request={auth:{uid:c.owner},data:{businessId:c.bid,clientRelease:238,item:{operationId:payment.operationId,businessId:c.bid,userId:c.owner,workspaceGeneration:0,payloadVersion:4,payload:{eventKind:'payment',fiadoHistoryVersion:1,
   fiadoReceiptRoute:{version:1,mode:route.mode,spaceId:c.space,quoteHash:route.quoteHash,scopedReceiptVersion:1},writes:h.writes()}}}};
  const unscoped=structuredClone(request);delete unscoped.data.item.payload.fiadoReceiptRoute;
  await assert.rejects(c.svc.commit(unscoped),/recebimento verificado do espaço/);
  const paymentWriter=process.env.VECONI_TEST_REGULARIZATION_ROLLBACK_SOURCE?require(require('path').resolve(process.env.VECONI_TEST_REGULARIZATION_ROLLBACK_SOURCE,'src/services/operational-commit-service')).operationalCommitService(db):c.svc;
  await paymentWriter.commit(request);await paymentWriter.commit(request);
  const a=await c.account();assert.equal(a.entries.filter(e=>e.spaceId===c.space).reduce((n,e)=>n+e.remainingCents,0),8000);
  assert.equal(a.entries.filter(e=>e.spaceId===c.other).reduce((n,e)=>n+e.remainingCents,0),7000);
  assert.equal((await c.root.collection('payments').get()).size,1);
  const income=require('../../functions/src/services/financial-income-service').financialIncomeService(db),remote=await c.read('payments',payment.id);
  await db.doc('financialSpaces/'+c.space).update({automation:{enabled:true,activatedAt:'2026-01-01T00:00:00Z'}});
  await income.projectPayment(c.bid,payment.id,remote);await income.projectPayment(c.bid,payment.id,remote);
  const entries=await db.collection(`financialSpaces/${c.space}/entries`).get();assert.equal(entries.size,1);assert.equal(entries.docs[0].data().amountCents,7000);
 }finally{h.close();}
});
test('old PWA company-wide adjustment cannot bypass a regularized space account',async()=>{
 const c=await setup();await c.apply(15000);await c.apply(7000,{spaceId:c.other});
 const {harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs'),h=harness({businessId:c.bid,spaceId:c.space,uid:c.owner});
 h.data().clientes=[await c.read('clients',c.clientId)];h.c.PhoneUtils={normalizeBrazilianPhone:v=>v};h.c.addEventListener=()=>{};
 require('node:vm').runInContext(require('node:fs').readFileSync('js/clientes.js','utf8'),h.c);
 const before=bridge(h.data()),adjustment=h.c.Clientes.ajustarSaldo(c.clientId,-1,'Ajuste antigo sintético');
 await assert.rejects(c.svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,clientRelease:238,item:{operationId:adjustment.operationId,businessId:c.bid,userId:c.owner,workspaceGeneration:0,payloadVersion:4,
  payload:{eventKind:'balance_adjustment',fiadoHistoryVersion:1,writes:[...bridge(h.c.diffWrites(before,h.data())),{entityType:'balanceAdjustments',entityId:adjustment.id,operation:'create',data:bridge(adjustment)}]}}}}),/Use Regularizar saldo/);
 assert.equal((await c.read('clients',c.clientId)).saldo,-220);
});
test('existing 180 sale is counted in final 1889; new sale and its cancellation keep adjustment debt',async()=>{
 const c=await setup(),{harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs'),h=harness({businessId:c.bid,spaceId:c.space,uid:c.owner});
 h.data().clientes=[await c.read('clients',c.clientId)];await db.doc('financialSpaces/'+c.space).update({'capabilities.inventory':true});
 await c.root.collection('products').doc('qa-product').set(bridge(h.data().produtos[0]));
 let before=bridge(h.data()),sale=h.c.Vendas.registrar({id:crypto.randomUUID(),operationId:crypto.randomUUID(),businessId:c.bid,spaceId:c.space,clienteId:c.clientId,status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoOriginal:180,precoFinalUnitario:180}]});
 const commitSale=(s,prior)=>c.svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,clientRelease:238,item:{operationId:s.operationId,businessId:c.bid,userId:c.owner,workspaceGeneration:0,payloadVersion:4,payload:{eventKind:'sale',fiadoHistoryVersion:1,writes:bridge(h.c.diffWrites(prior,h.data()))}}}});
 await commitSale(sale,before);assert.equal((await c.preview()).currentDebtCents,18000);const r=await c.apply(188900);assert.equal(r.deltaDebtCents,170900);
 h.data().clientes=[await c.read('clients',c.clientId)];h.data().produtos[0].estoqueAtual=2;h.data().produtos[0].estoque=2;h.data().produtos[0].totalStock=2;
 before=bridge(h.data());sale=h.c.Vendas.registrar({id:crypto.randomUUID(),operationId:crypto.randomUUID(),businessId:c.bid,spaceId:c.space,clienteId:c.clientId,status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoOriginal:14,precoFinalUnitario:14}]});
 await commitSale(sale,before);assert.equal((await c.preview()).currentDebtCents,190300);
 const undo=h.undo(sale.id);undo.packet.payload.fiadoHistoryVersion=1;
 await c.svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,clientRelease:238,item:undo.packet}});
 assert.equal((await c.preview()).currentDebtCents,188900);
});
test('installment calendar in another space is immutable; regularization cannot consume its principal',async()=>{
 const c=await setup();await c.apply(15000);
 const {harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs'),h=harness({businessId:c.bid,spaceId:c.other,uid:c.owner});
 h.data().clientes=[await c.read('clients',c.clientId)];await db.doc('financialSpaces/'+c.other).update({'capabilities.inventory':true});
 await c.root.collection('products').doc('qa-product').set(bridge(h.data().produtos[0]));
 const before=bridge(h.data()),account=await c.account(),Plan=require('../../functions/src/shared/installment-plan');
 const sale=h.c.Vendas.registrar({id:crypto.randomUUID(),operationId:crypto.randomUUID(),businessId:c.bid,spaceId:c.other,clienteId:c.clientId,status:'fiado',formaPagamento:'fiado',
  itens:[{produtoId:'qa-product',quantidade:1,precoOriginal:2800,precoFinalUnitario:2800}],installmentAccount:account,installmentTerms:{downPayment:0,count:10,firstDueDate:Plan.month(Plan.today(),1)}});
 await c.svc.commit({auth:{uid:c.owner},data:{businessId:c.bid,clientRelease:238,item:{operationId:sale.operationId,businessId:c.bid,userId:c.owner,workspaceGeneration:0,payloadVersion:4,
  payload:{eventKind:'sale',fiadoHistoryVersion:1,writes:bridge(h.c.diffWrites(before,h.data()))}}}});
 const original=await c.read('sales',sale.id);await c.apply(12000);
 assert.deepEqual(await c.read('sales',sale.id),original);
 await assert.rejects(c.apply(279900,{spaceId:c.other}),/parcelas/);
 const a=await c.account();assert.equal(a.entries.filter(e=>e.spaceId===c.space).reduce((n,e)=>n+e.remainingCents,0),12000);
 assert.equal(a.entries.filter(e=>e.spaceId===c.other).reduce((n,e)=>n+e.remainingCents,0),280000);
});
test('compatible containment rollback preserves existing proof and original replay, pausing only new adjustments',{skip:!process.env.VECONI_TEST_REGULARIZATION_ROLLBACK_SOURCE},async()=>{
 const c=await setup(),request=await c.intent(15000);await c.svc.commit(request);
 const rollback=require(require('path').resolve(process.env.VECONI_TEST_REGULARIZATION_ROLLBACK_SOURCE,'src/services/operational-commit-service')).operationalCommitService(db);
 assert.equal((await rollback.commit(request)).replayed,true);
 await assert.rejects(rollback.commit(await c.intent(12000)),/temporariamente pausadas/);
 assert.equal((await c.preview()).currentDebtCents,15000);assert.equal((await c.root.collection('balanceAdjustments').get()).size,1);
 // An older PWA must fail closed rather than reinterpret V2 as company-wide legacy debt.
 await assert.rejects(c.svc.receipt(c.req('fiado_account')),/Atualize/);
});
test('existing definitive cutoff stays immutable; scoped adjustment uses the same epoch and never recounts archived history',async()=>{
 const c=await setup(),Opening=require('../../functions/src/shared/fiado-opening-balance'),Plan=require('../../functions/src/shared/installment-plan');
 const client={...await c.read('clients',c.clientId),saldo:-190},collections=Object.fromEntries(['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations','processedOperations'].map(k=>[k,[]]));
 collections.sales=[{id:'archived-qa',clienteId:c.clientId,formaPagamento:'fiado',valorFinal:999,active:true,spaceId:c.other}];
 const input={businessId:c.bid,generation:0,client,collections,complete:true,stable:true},day=Plan.today(),plan=Opening.createPlan(input,{day,spaceIds:[c.other,c.space]}),at=new Date(Date.now()-60000).toISOString(),evidenceDigest='a'.repeat(64),reviewHash=Opening.digest([plan,evidenceDigest]);
 const details={plan,at,actorUid:c.owner,requestId:'synthetic-cutoff',reviewHash},hash=Opening.digest(details),audit={...details,type:'fiado_confirmed_opening',version:1,businessId:c.bid,workspaceGeneration:0,clientId:c.clientId,evidenceDigest,hash};
 await c.root.collection('fiadoOpeningBalances').doc(c.clientId).set(audit);
 await c.root.collection('clients').doc(c.clientId).set({...client,financialVersion:1,fiadoHistoryVersion:1,fiadoOpeningBalance:{version:1,hash}});
 await c.root.collection('sales').doc('archived-qa').set(collections.sales[0]);
 await c.apply(188900);await c.apply(15000,{spaceId:c.other});
 assert.deepEqual((await c.read('clients',c.clientId)).fiadoOpeningBalance,{version:1,hash});
 assert.deepEqual(await c.read('fiadoOpeningBalances',c.clientId),audit);
 const adjustment=(await c.root.collection('balanceAdjustments').get()).docs[0].data();assert.equal(adjustment.fiadoOpeningHash,hash);
 await c.root.collection('sales').doc('archived-qa').update({valorFinal:9999,active:false});
 const account=await c.account();assert.equal(account.totalCents,203900);
 assert.equal(account.entries.filter(e=>e.spaceId===c.space).reduce((n,e)=>n+e.remainingCents,0),188900);
});
