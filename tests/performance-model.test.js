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
 for(const p of ['today','7d','30d','90d','month','previous','year'])assert.ok(M.range(p,new Date('2024-12-31T15:00:00Z')).days<=366);
 assert.equal(M.range('year',new Date('2024-12-31T15:00:00Z')).granularity,'month');
 assert.throws(()=>M.range('custom',new Date(),{start:'2026-02-30',end:'2026-03-04'}));
 assert.throws(()=>M.range('custom',new Date(),{start:'2020-01-01',end:'2026-03-04'}));
});
test('50k already-loaded thin rows aggregate without cloud access and reconcile',()=>{
 const rows=Array.from({length:50000},(_,i)=>sale(String(i),1,.4));const before=performance.now(),v=build(rows);
 assert.equal(v.current.revenue,50000);assert.equal(v.points.reduce((s,p)=>s+p.revenue,0),50000);assert.ok(performance.now()-before<15000);
});
