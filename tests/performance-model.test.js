const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../js/performance-model');
const range=M.range('7d',new Date('2026-10-04T15:00:00Z'));
const sale=(id,amount,cost,extra={})=>({id,businessId:'biz',spaceId:'a',data:'2026-10-04T15:00:00Z',valorFinal:amount,custoTotal:cost,lucro:cost==null?undefined:amount-cost,status:'pago',itens:[{produtoId:id,nome:id,categoryNameSnapshot:'Bebidas',quantidade:1,subtotalFinal:amount}],...extra});
const build=(sales,extra={})=>M.build({sales,range,businessId:'biz',canCost:true,canProfit:true,...extra});
test('KPIs and every revenue breakdown share the same cents and historical snapshots',()=>{
 const v=build([sale('a',100,40),sale('b',50,20)]);
 assert.deepEqual([v.current.revenue,v.current.cost,v.current.profit,v.current.margin,v.current.ticket,v.current.count],[150,60,90,60,75,2]);
 for(const key of ['points','categories','products','payments','spaces'])assert.equal(v[key].reduce((sum,r)=>sum+r.revenue,0),150,key);
});
test('discount is allocated across items without changing historical costs or losing cents',()=>{
 const v=build([sale('a',90,40,{itens:[{nome:'A',quantidade:1,subtotalFinal:70,categoryNameSnapshot:'A'},{nome:'B',quantidade:2,subtotalFinal:30,categoryNameSnapshot:'B'}]})]);
 assert.equal(v.current.profit,50);assert.equal(v.categories.reduce((n,r)=>n+r.revenue,0),90);assert.equal(v.current.quantity,3);
});
test('credit sale counts once, duplicate ids and cancelled/deleted sales do not inflate totals',()=>{
 const a=sale('a',100,40,{status:'fiado',formaPagamento:'fiado'});
 const v=build([a,a,sale('b',500,1,{status:'cancelada'}),sale('c',500,1,{deleted:true}),sale('d',500,1,{desfeita:true}),sale('e',500,1,{active:false})]);
 assert.equal(v.current.revenue,100);assert.equal(v.payments[0].name,'Fiado');assert.equal(v.current.count,1);
});
test('missing cost is flagged rather than filled from today product cost',()=>{
 const v=build([sale('a',100,null)]);assert.equal(v.current.missingCost,1);
 assert.equal(build([sale('a',100,0)]).current.missingCost,0);
});
test('missing previous historical costs suppresses profit comparison, not revenue',()=>{
 const v=build([sale('a',100,40),sale('b',50,null,{data:'2026-09-23T15:00:00Z'})]);
 assert.equal(v.comparison.profit,null);assert.equal(v.comparison.revenue,100);
});
test('business and allowed-space restrictions exclude unauthorized rows, including unassigned legacy rows',()=>{
 const rows=[sale('a',100,40),sale('b',300,20,{businessId:'other'}),sale('c',500,20,{spaceId:'b'}),sale('d',800,20,{spaceId:null})];
 assert.equal(build(rows,{allowedSpaceIds:['a']}).current.revenue,100);
 assert.equal(build(rows,{spaceId:'b'}).current.revenue,500);
});
test('no cost/profit/margin in any model row without corresponding permission',()=>{
 const v=build([sale('a',100,40)],{canCost:false,canProfit:false});
 for(const row of [v.current,v.previous,...v.points,...v.spaces])for(const field of ['cost','profit','margin'])assert.equal(field in row,false);
});
test('Brazil midnight is not UTC midnight; today has 24 hour points',()=>{
 const r=M.range('today',new Date('2026-10-04T15:00:00Z'));
 const v=build([sale('a',100,40,{data:'2026-10-04T02:59:59Z'}),sale('b',50,20,{data:'2026-10-04T03:00:00Z'})],{range:r});
 assert.equal(v.current.revenue,50);assert.equal(v.previous.revenue,100);assert.equal(v.points.length,24);
 assert.equal(M.midnight('2026-10-04'),'2026-10-04T03:00:00.000Z');
});
test('Timestamp/Date/ISO yield identical reporting buckets',()=>{
 const iso='2026-10-04T15:00:00Z';assert.equal(M.day(iso),M.day(new Date(iso)));assert.equal(M.day(iso),M.day({seconds:Date.parse(iso)/1000}));
});
test('equivalent previous period, empty base and zero denominator never invent +100%',()=>{
 assert.equal(range.previousEnd,M.shift(range.start,-1));
 assert.equal(build([]).comparison.revenue,null);
 const v=build([sale('a',150,60),sale('b',100,40,{data:'2026-09-23T15:00:00Z'})]);assert.equal(v.comparison.revenue,50);
 assert.equal(M.compare(100,0,true),null);
});
test('integrated versus manual card; variants group under product and snapshot category survives changes',()=>{
 const v=build([sale('a',100,40,{formaPagamento:'cartao'}),sale('b',50,20,{paymentIntentId:'mock-1',paymentMetadata:{provider:'mock'},itens:[{produtoId:'a',variantId:'v2',nome:'Produto A',categoryNameSnapshot:'Histórica',quantidade:2,subtotalFinal:50}]})]);
 assert.deepEqual(v.payments.map(p=>p.name),['Cartão manual','Maquininha integrada']);assert.equal(v.products.length,1);assert.equal(v.products[0].quantity,3);assert.ok(v.categories.some(c=>c.name==='Histórica'));
});
test('all presets and leap year remain bounded; invalid custom intervals rejected',()=>{
 for(const p of ['today','yesterday','7d','30d','90d','month','previous','year'])assert.ok(M.range(p,new Date('2024-12-31T15:00:00Z')).days<=366);
 assert.equal(M.range('year',new Date('2024-12-31T15:00:00Z')).granularity,'month');
 assert.throws(()=>M.range('custom',new Date(),{start:'2026-02-30',end:'2026-03-04'}));
 assert.throws(()=>M.range('custom',new Date(),{start:'2020-01-01',end:'2026-03-04'}));
});
test('50k already-loaded thin rows aggregate without cloud access and reconcile',()=>{
 const rows=Array.from({length:50000},(_,i)=>sale(String(i),1,.4));const before=performance.now(),v=build(rows);
 assert.equal(v.current.revenue,50000);assert.equal(v.points.reduce((s,p)=>s+p.revenue,0),50000);assert.ok(performance.now()-before<15000);
});
test('yesterday is one Brazil day before today and compares with the day before',()=>{
 const r=M.range('yesterday',new Date('2026-10-04T15:00:00Z'));
 assert.deepEqual([r.start,r.end,r.days,r.previousStart,r.granularity],['2026-10-03','2026-10-03',1,'2026-10-02','hour']);
});
test('received cash separates upfront sales and fiado receipts without touching revenue',()=>{
 const pay=(id,valor,extra={})=>({id,businessId:'biz',spaceId:'a',tipo:'pagamento',valor,data:'2026-10-04T16:00:00Z',...extra});
 const fiado=sale('f',200,50,{status:'fiado',formaPagamento:'fiado'}),parcelado=sale('p',90,10,{installmentPlan:{version:1}});
 const receipts=[pay('r1',80),pay('r1',80),pay('r2',30,{status:'estornado'}),pay('r3',40,{deleted:true}),pay('r4',25,{businessId:'other'}),pay('r5',60,{spaceId:'b'}),pay('r6',15,{tipo:'ajuste_saldo'})];
 const v=build([sale('a',100,40),fiado,parcelado],{payments:receipts});
 assert.equal(v.current.revenue,390);
 assert.deepEqual([v.cash.current.upfront,v.cash.current.credit,v.cash.current.total,v.cash.current.creditCount],[100,140,240,2]);
 const a=v.spaces.find(s=>s.id==='a'),b=v.spaces.find(s=>s.id==='b');
 assert.deepEqual([a.upfront,a.credit,a.received],[100,80,180]);assert.deepEqual([b.revenue,b.credit,b.received,b.count],[0,60,60,0]);
 assert.equal(build([sale('a',100,40)],{payments:receipts,allowedSpaceIds:['a']}).cash.current.credit,80);
 assert.equal(build([sale('a',100,40)],{payments:receipts,spaceId:'b'}).cash.current.total,60);
 assert.equal(build([sale('a',100,40)]).cash,null);
});
test('space contribution shares add up to the consolidated revenue',()=>{
 const v=build([sale('a',300,1),sale('b',100,1,{spaceId:'b'})],{spaces:[{id:'a',name:'Táxi'},{id:'b',name:'Doces'}]});
 assert.deepEqual(v.spaces.map(s=>[s.name,s.revenue,s.share]),[['Táxi',300,75],['Doces',100,25]]);
 assert.equal(v.spaces.reduce((n,s)=>n+s.revenue,0),v.current.revenue);
});
test('receipt-only space rows never expose profit or cost to denied profiles',()=>{
 const v=build([],{payments:[{id:'r',businessId:'biz',spaceId:'z',tipo:'pagamento',valor:10,data:'2026-10-04T16:00:00Z'}],canCost:false,canProfit:false});
 for(const row of v.spaces)for(const f of ['cost','profit','margin'])assert.equal(f in row,false);
});
test('receipt coverage never infers completeness from row count or an old payment',()=>{
 const rows=(n,from)=>Array.from({length:n},(_,i)=>({id:'p'+i,businessId:'biz',tipo:'pagamento',valor:1,data:new Date(Date.parse(from)+i*60000).toISOString()}));
 assert.equal(M.receiptCoverage(rows(10,'2026-10-04T12:00:00Z'),'biz','2026-09-28').complete,false);
 assert.equal(M.receiptCoverage(rows(200,'2026-10-04T12:00:00Z'),'biz','2026-09-28').complete,false);
 assert.equal(M.receiptCoverage([...rows(199,'2026-10-04T12:00:00Z'),{id:'old',businessId:'biz',tipo:'pagamento',valor:1,data:'2026-09-01T12:00:00Z'}],'biz','2026-09-28').complete,false);
 assert.equal(M.receiptCoverage(rows(250,'2026-10-04T12:00:00Z').map(p=>({...p,businessId:'other'})),'biz','2026-09-28').localCount,0);
});
test('duplicate receipt operation IDs and unresolved/rejected rows never inflate cash',()=>{
 const pay=(id,status,operationId)=>({id,businessId:'biz',spaceId:'a',tipo:'pagamento',valor:70,data:'2026-10-04T16:00:00Z',status,operationId});
 const rows=[pay('original','applied','op-1'),pay('duplicate','applied','op-1'),...['pending','pendente','conflict','rejected','error','cancelled','superseded'].map((s,i)=>pay('bad-'+i,s,'bad-op-'+i))];
 const v=build([],{payments:rows});assert.equal(v.cash.current.credit,70);assert.equal(v.cash.current.creditCount,1);assert.equal(v.cash.coverage.complete,false);
});
test('fiado, partial receipt, crediário entry, renewal and reversals keep revenue, received and estimated cost apart',()=>{
 const pay=(id,valor,extra={})=>({id,businessId:'biz',spaceId:'a',tipo:'pagamento',valor,data:'2026-10-04T16:00:00Z',...extra});
 const sales=[
  sale('fiado',200,50,{status:'fiado',formaPagamento:'fiado'}),
  sale('cred',300,90,{formaPagamento:'crediario',installmentPlan:{version:1,downPaymentCents:5000,count:2}}),
  sale('renov',80,0,{formaPagamento:'pix',subscriptionId:'sub-1'}),
  sale('cancel',999,1,{status:'cancelada',formaPagamento:'pix'}),
 ];
 const receipts=[pay('parcial',70,{effectiveAmount:70,requestedAmount:200}),pay('entrada',50,{installmentSaleId:'cred'}),pay('estorno',90,{status:'estornado'}),pay('ajuste',30,{tipo:'ajuste_saldo'})];
 const v=build(sales,{payments:receipts});
 assert.equal(v.current.revenue,580);assert.equal(v.current.count,3);
 assert.equal(v.current.cost,140);assert.equal(v.current.profit,440);
 assert.deepEqual([v.cash.current.upfront,v.cash.current.credit,v.cash.current.total],[80,120,200]);
 assert.ok(!('expenses' in v.current),'estimated sale cost is never presented as a financial expense');
});
