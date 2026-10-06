const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scope={window:null,console,Date,Intl,Math,Number,String,Set,Map,Object,Array,structuredClone};scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync('js/financial-engine.js','utf8'),scope);
const E=scope.FinancialEngine,{card,carousel,nearest,easing}=require('../js/financial-accounts-carousel');
const group=(extra={})=>({key:'inter',name:'Banco Inter',accounts:[],cards:[],availableBalanceCents:862,invoiceTotalCents:160591,...extra});
test('account-only and cash never invent a card or card limit',()=>{
 for(const type of ['bank_account','cash_wallet','digital_wallet']){const g=group({accounts:[{type,currentBalanceCents:862}]});const p=card.present(g,E),html=card.render(g,E,0,1);assert.equal(p.primaryCents,862);assert.equal(p.hasCard,false);assert.doesNotMatch(html,/vac-invoice|vac-limit-track|Fatura atual/);}
});
test('card-only never invents account balance; mixed institution reuses canonical balance',()=>{
 const c={name:'Inter',last4:'0937',limitCents:200000,committedCents:160591,currentInvoice:{amountDueCents:160591,remainingCents:160591,dueDate:'2026-10-13',status:'open'}};
 const only=card.present(group({cards:[c]}),E);assert.equal(only.primaryCents,160591);assert.equal(only.primaryLabel,'Fatura atual');assert.equal(only.identification,'Inter •••• 0937');assert.equal(only.percentage,80);
 const combined=card.present(group({accounts:[{type:'bank_account'}],cards:[c]}),E);assert.equal(combined.primaryCents,862);assert.equal(combined.kind,'Conta + Cartão');assert.equal(combined.invoiceCents,160591);
});
test('illiquid investment is displayed as patrimônio without changing available balance',()=>{
 const g=group({availableBalanceCents:0,accounts:[{type:'investment_account',currentBalanceCents:500000}]});const before=JSON.stringify(g),p=card.present(g,E);assert.equal(p.primaryLabel,'Patrimônio registrado');assert.equal(p.primaryCents,500000);assert.equal(g.availableBalanceCents,0);assert.equal(JSON.stringify(g),before);
});
test('unknown limits/commitment are omitted; real zero commitment remains valid',()=>{
 for(const c of [{},{limitCents:200000},{limitCents:null,committedCents:0}])assert.equal(card.present(group({cards:[c]}),E).limit,null);
 assert.equal(card.present(group({cards:[{limitCents:200000,committedCents:0}]}),E).percentage,0);
});
test('paid/no invoice and overdue states do not invent due dates or balances',()=>{
 assert.equal(card.present(group({cards:[{}]}),E).due,null);
 const paid=card.present(group({cards:[{currentInvoice:{status:'paid',dueDate:'2020-01-01',amountDueCents:1000,remainingCents:0}}]}),E);assert.equal(paid.invoiceLabel,'Fatura paga');assert.equal(paid.due,null);
 const g=group({cards:[{currentInvoice:{status:'overdue',dueDate:'2020-01-01',amountDueCents:1000,remainingCents:1000}}]});assert.match(card.render(g,E,0,1),/Fatura vencida/);
});
test('empty/single/many modes have actionable empty state, no autoplay and bounded pagination',()=>{
 assert.match(carousel.render([],E),/data-financial-add-product/);
 assert.doesNotMatch(carousel.render([group()],E),/data-vac-prev|data-vac-page|data-vac-status/);
 assert.equal((carousel.render(Array.from({length:3},()=>group()),E).match(/data-vac-page=/g)||[]).length,3);
 assert.doesNotMatch(carousel.render(Array.from({length:12},()=>group()),E),/data-vac-page=/);
 const source=fs.readFileSync('js/financial-accounts-carousel.js','utf8');assert.doesNotMatch(source,/fetch\(|localStorage|Firestore|setInterval|onSnapshot/);
});
test('presentation escapes names and snapping/easing is deterministic',()=>{
 assert.match(card.render(group({name:'<img onerror="bad">'}),E,0,1),/&lt;img/);
 assert.equal(nearest([0,376,752],411),1);assert.equal(nearest([0,376,752],710),2);assert.equal(easing(0),0);assert.equal(easing(1),1);
 let last=0;for(let i=0;i<=100;i++){assert.ok(easing(i/100)>=last);last=easing(i/100);}
});
test('loop duplicates presentation only; real indices/pagination remain bounded',()=>{
 for(const n of [1,2,4,12]){
  const data=Array.from({length:n},(_,i)=>group({key:'bank-'+i})),before=JSON.stringify(data),html=carousel.render(data,E);
  const indices=[...html.matchAll(/data-logical-index="(\d+)"/g)].map(m=>Number(m[1]));
  assert.ok(indices.every(i=>i>=0&&i<n));assert.equal(new Set(indices).size,n);
  assert.equal(indices.length===1,n===1);assert.equal(JSON.stringify(data),before);
  assert.doesNotMatch(html,/\sid="/);
 }
});
test('appearance uses exact institution keys, not substring guessing, and never mutates financial data',()=>{
 const g=group({name:'Banco Interior',key:'interior',accounts:[{institutionKey:'interior',currentBalanceCents:123}]});
 const before=JSON.stringify(g);assert.notEqual(card.appearance(g).color,card.presets.Laranja);assert.equal(JSON.stringify(g),before);
 assert.equal(card.appearance(group({key:'inter',name:'Nome editado'})).color,card.presets.Laranja);
 const p=card.present(group({presentation:{displayName:'Inter Principal',color:'#123456',gradientVariant:'solid'},accounts:[{type:'bank_account'}]}),E);
 assert.equal(p.name,'Inter Principal');assert.equal(p.primaryCents,862);assert.equal(p.style.end,'#123456');
});
test('text has AA contrast across gradient endpoints and color cannot inject CSS',()=>{
 for(const color of [...Object.values(card.presets),'#ffffff','#000000','#ffff00','#ff7a00','#888888','#80ffff']){
  for(const gradientVariant of ['solid','gradient']){const a=card.appearance(group({presentation:{color,gradientVariant}}));assert.ok(card.contrast(a.color,a.text)>=4.5);assert.ok(card.contrast(a.end,a.text)>=4.5);}
 }
 assert.notEqual(card.appearance(group({presentation:{color:'red;position:fixed'}})).color,'red;position:fixed');
});
test('missing invoice is stated once; large amounts and nicknames preserve semantics',()=>{
 const html=card.render(group({cards:[{name:'real',presentation:{cardNickname:'Meu cartão'},last4:'4521'}]}),E,0,1);
 assert.equal((html.match(/Sem fatura/g)||[]).length,1);assert.match(html,/Meu cartão/);assert.match(html,/4521/);assert.doesNotMatch(html,/Mastercard|Visa/);
 for(const cents of [862,676634,9876543,123456789]) assert.equal(card.present(group({accounts:[{type:'bank_account'}],availableBalanceCents:cents}),E).primaryCents,cents);
});
