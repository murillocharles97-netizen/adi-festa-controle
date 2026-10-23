'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/activity-center.js','utf8');
const date='2026-10-23T08:20:39.451Z';
const event=(id='sale-1',method='fiado')=>({id:`sale:${id}`,eventId:`sale:${id}`,type:'sale',entityId:id,operationId:`op:${id}`,businessId:'qa',spaceId:'qa-store',actorUid:'seller',createdAt:date,sourceUpdatedAt:date,status:'confirmed',summary:{amount:80,customerName:'QA',paymentMethod:method}});
function harness({rows={},events=[event()],reader,role='seller',code=source}={}){
  const cards=events.map(e=>({dataset:{activityId:e.eventId}})),handlers=new Map(),reads=[],writes=[],modal={innerHTML:'',querySelector:s=>s==='[data-activity-close]'?{}:null},input={addEventListener:()=>{}},root={querySelector:()=>input,querySelectorAll:s=>s==='[data-activity-id]'?cards:[],outerHTML:''};
  let data={vendas:[],pagamentos:[],movimentacoes:[],movimentacoesEstoque:[]},callback,stopped=0;
  const context={businessId:'qa',role,spaceAccess:'selected',allowedSpaceIds:['qa-store']},session={user:{uid:role==='owner'?'owner':'seller'}},space={id:'qa-store'};
  const c={console:{warn:()=>{}},setTimeout,clearTimeout,structuredClone,
    document:{querySelector:s=>s==='[data-activity-root]'?root:s==='#modal'?modal:input,querySelectorAll:()=>[]},
    addEventListener:(name,fn)=>{if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},
    DB:{carregar:()=>data,alterar:()=>{writes.push('DB.alterar');throw Error('no writes');},getWorkspaceGeneration:()=>0},
    BusinessContext:{get:()=>context},FirebaseSession:session,SpaceContext:{homeId:()=>space.id},
    TeamAccess:{has:p=>role==='owner'||p==='sales.create',canReadOperationalSales:()=>true,operationalReadScopeKey:()=>JSON.stringify([context,session.user.uid])},
    FirestoreRepositories:{sales:{getSaleStatusFromServer:async id=>{reads.push(id);return reader?reader(id):structuredClone(rows[id]||null);}}},
    SyncFirebase:{pendingActivityEvents:()=>[],subscribeRecentActivityEvents:fn=>{callback=fn;return()=>{stopped++;};}},
    Utils:{escapar:x=>String(x??'')},Vendas:{ultima:()=>data.vendas.at(-1),podeDesfazer:()=>true},
    requestSafeSaleUndo:()=>{writes.push('undo');},
  };
  c.window=c;vm.createContext(c);vm.runInContext(code,c);
  c.ActivityCenter.bind();
  const tick=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
  const publish=async list=>{callback(list,{},{});await tick();};
  return{c,context,session,space,root,reads,writes,rows,modal,cards,setData:v=>{data=v;},emit:async(name,detail)=>{for(const fn of handlers.get(name)||[])fn({detail});await tick();},publish,start:()=>publish(events),tick,stopped:()=>stopped};
}
const sale=(id='sale-1',extra={})=>({id,businessId:'qa',spaceId:'qa-store',status:'fiado',formaPagamento:'fiado',...extra});

for(const role of ['owner','seller'])for(const method of ['fiado','dinheiro'])test(`${role}: ${method} canceled source overrides stale confirmed History after reload`,async()=>{
  const e=event('sale-1',method),row=sale('sale-1',{formaPagamento:method,status:method==='fiado'?'fiado':'applied',applicationStatus:'applied',active:false,deletedAt:date,cancelledAt:date});
  const h=harness({role,rows:{'sale-1':row},events:[e]}),before=JSON.stringify([row,e]);
  await h.start();const result=h.c.ActivityCenter.events()[0];
  assert.equal(result.status,'Cancelada');assert.equal(result.statusTone,'danger');assert.match(result.subtitle,/Venda cancelada/);
  assert.equal(h.reads.length,1);h.c.ActivityCenter.render();h.c.ActivityCenter.bind();await h.tick();assert.equal(h.reads.length,1,'render must not repeat reads');
  assert.deepEqual(h.writes,[]);assert.equal(JSON.stringify([row,e]),before);
  const reload=harness({role,rows:{'sale-1':row},events:[e]});await reload.start();assert.equal(reload.c.ActivityCenter.events()[0].status,'Cancelada');assert.equal(reload.reads.length,1);
});
test('active Fiado remains pending and active cash remains concluded',async()=>{
  const h=harness({events:[event('credit'),event('cash','pix')],rows:{credit:sale('credit'),cash:sale('cash',{status:'applied',formaPagamento:'pix'})}});await h.start();
  const byId=new Map(h.c.ActivityCenter.events().map(e=>[e.resourceId,e.status]));assert.equal(byId.get('credit'),'Pendente');assert.equal(byId.get('cash'),'Concluída');
});
test('cancellation already present in event needs no extra read',async()=>{
  const h=harness({events:[{...event(),status:'cancelled'}]});await h.start();assert.equal(h.c.ActivityCenter.events()[0].status,'Cancelada');assert.equal(h.reads.length,0);
});
test('source absence, permission failure or mismatch never implies cancellation',async()=>{
  for(const row of [null,sale('different'),sale('sale-1',{businessId:'other',active:false}),sale('sale-1',{spaceId:'other',active:false}),sale('sale-1',{workspaceGeneration:2,active:false})]){
    const h=harness({rows:{'sale-1':row}});await h.start();assert.equal(h.c.ActivityCenter.events()[0].status,'Status não confirmado');assert.equal(h.reads.length,1);assert.deepEqual(h.writes,[]);
  }
  const h=harness({reader:()=>{throw Object.assign(Error('denied'),{code:'permission-denied'});}});await h.start();assert.equal(h.c.ActivityCenter.events()[0].status,'Status não confirmado');h.c.ActivityCenter.bind();await h.tick();assert.equal(h.reads.length,1);
});
test('sync refresh invalidates status, without another commercial operation',async()=>{
  const h=harness({rows:{'sale-1':sale()}});await h.start();assert.equal(h.c.ActivityCenter.events()[0].status,'Pendente');h.rows['sale-1'].active=false;h.rows['sale-1'].deletedAt=date;
  await h.emit('cloud-data-updated',{collection:'sales'});assert.equal(h.c.ActivityCenter.events()[0].status,'Cancelada');assert.equal(h.reads.length,2);assert.deepEqual(h.writes,[]);
});
test('updated History projection revalidates the canonical source',async()=>{
  const h=harness({rows:{'sale-1':sale()}});await h.start();h.rows['sale-1'].active=false;
  await h.publish([{...event(),sourceUpdatedAt:'2026-10-23T08:21:33.254Z'}]);assert.equal(h.c.ActivityCenter.events()[0].status,'Cancelada');assert.equal(h.reads.length,2);
});
test('old account callback/read cannot contaminate new account, business or space',async()=>{
  let resolve;const h=harness({reader:()=>new Promise(r=>{resolve=r;})});await h.start();
  h.session.user.uid='owner';h.context.businessId='other';h.space.id='other-store';await h.emit('firebase-session-cleared');
  resolve(sale('sale-1',{active:false}));await h.tick();assert.equal(h.c.ActivityCenter.events().length,0);assert.equal(h.stopped(),1);assert.deepEqual(h.writes,[]);
});
test('out-of-scope activity never triggers a sales read',async()=>{
  const h=harness({events:[{...event('x'),businessId:'other'},{...event('y'),spaceId:'other-store'}]});await h.start();assert.deepEqual(h.reads,[]);assert.equal(h.c.ActivityCenter.events().length,0);
});
test('space without Sales or plan without Sales triggers no denied source request',async()=>{
  const h=harness({rows:{'sale-1':sale('sale-1',{active:false})}});h.c.SpaceContext.salesSpaces=()=>[];await h.start();assert.deepEqual(h.reads,[]);assert.equal(h.c.ActivityCenter.events()[0].status,'Status não confirmado');
  h.c.SpaceContext.salesSpaces=()=>[{id:'qa-store'}];await h.emit('veconi-spaces-ready');assert.equal(h.reads.length,1);assert.equal(h.c.ActivityCenter.events()[0].status,'Cancelada');
  const blocked=harness();blocked.context.access={features:{basicSales:false}};await blocked.start();assert.deepEqual(blocked.reads,[]);
});
test('space change discards old in-flight source result',async()=>{
  let resolve;const h=harness({reader:()=>new Promise(r=>{resolve=r;})});await h.start();h.space.id='other-store';await h.emit('veconi-space-context-changed');resolve(sale('sale-1',{active:false}));await h.tick();assert.equal(h.c.ActivityCenter.events().length,0);assert.deepEqual(h.writes,[]);
});
test('bounded concurrency, pagination and updates do not duplicate cards',async()=>{
  const pending=[],list=Array.from({length:9},(_,i)=>event(`s${i}`));
  const h=harness({events:list,reader:id=>new Promise(r=>pending.push(()=>r(sale(id,{active:false}))))});await h.start();assert.equal(pending.length,4);
  while(pending.length){const batch=pending.splice(0);batch.forEach(fn=>fn());await h.tick();}
  assert.equal(h.reads.length,9);assert.equal(new Set(h.reads).size,9);assert.equal(h.c.ActivityCenter.events().length,9);assert.ok(h.c.ActivityCenter.events().every(e=>e.status==='Cancelada'));
});
test('search, cancelled/pending filters and counts use the corrected status without dropping history',async()=>{
  const h=harness({events:[event('cancel'),event('pending')],rows:{cancel:sale('cancel',{active:false}),pending:sale('pending')}});await h.start();
  assert.match(h.c.ActivityCenter.render(),/2 ações/);
  h.c.ActivityCenter.state.filters.status='danger';let html=h.c.ActivityCenter.render();assert.match(html,/1 ação/);assert.match(html,/sale:cancel/);assert.doesNotMatch(html,/sale:pending/);
  h.c.ActivityCenter.state.filters.status='warning';html=h.c.ActivityCenter.render();assert.match(html,/sale:pending/);assert.doesNotMatch(html,/sale:cancel/);
  h.c.ActivityCenter.state.filters.status='todos';h.c.ActivityCenter.state.query='cancelada';html=h.c.ActivityCenter.render();assert.match(html,/1 ação/);assert.match(html,/sale:cancel/);
});
test('canonical cancelled card/detail has no second-cancel action, even with stale active local sale',async()=>{
  const h=harness({rows:{'sale-1':sale('sale-1',{active:false,deletedAt:date})}});h.setData({vendas:[sale()]});await h.start();
  h.cards[0].onclick();assert.match(h.modal.innerHTML,/Esta venda foi cancelada\./);assert.doesNotMatch(h.modal.innerHTML,/data-history-cancel-sale|data-history-receipt/);assert.deepEqual(h.writes,[]);
});
test('second cancel stays disabled while canonical status is pending or unconfirmed',async()=>{
  let resolve;const h=harness({reader:()=>new Promise(r=>{resolve=r;})});h.setData({vendas:[sale('sale-1',{itens:[]})]});await h.start();h.cards[0].onclick();assert.match(h.modal.innerHTML,/data-history-cancel-sale="sale-1" disabled/);
  resolve(null);await h.tick();h.cards[0].onclick();assert.match(h.modal.innerHTML,/data-history-cancel-sale="sale-1" disabled/);assert.deepEqual(h.writes,[]);
});
test('local canonical tombstone also blocks a second-cancel button without source lookup',async()=>{
  const h=harness({events:[event()]});h.setData({vendas:[sale('sale-1',{active:false})]});await h.start();h.cards[0].onclick();assert.match(h.modal.innerHTML,/Esta venda foi cancelada\./);assert.doesNotMatch(h.modal.innerHTML,/data-history-cancel-sale/);
});
test('exact V197 reproduction stays pending; same input is cancelled with the presentation hotfix',async()=>{
  const {execFileSync}=require('node:child_process'),legacy=execFileSync('git',['-c','core.bare=false','show','234f144b93092ebd5fcf9c774007b8a122349e55:js/activity-center.js'],{encoding:'utf8'});
  const setup={rows:{'sale-1':sale('sale-1',{active:false,deletedAt:date,cancelledAt:date,applicationStatus:'applied'})}};
  const old=harness({...setup,code:legacy});await old.start();assert.equal(old.c.ActivityCenter.events()[0].status,'Pendente');
  const fixed=harness(setup);await fixed.start();assert.equal(fixed.c.ActivityCenter.events()[0].status,'Cancelada');assert.deepEqual(fixed.writes,[]);
});

function statusReader({row=sale('sale-1',{active:false,custoTotal:20,lucro:60,itens:[{nome:'private'}]}),collection='sales',read}={}){
  const repository=fs.readFileSync('js/firebase/firestore-repository.js','utf8'),body=repository.match(/async getSaleStatusFromServer\(id\) \{([\s\S]*?)\n    \},/)[1];
  let scope='seller:qa',calls=0;
  const c={collectionName:collection,repositoryScopeKey:()=>scope,documentRef:id=>id,timed:(_kind,_name,fn)=>fn(),getDocFromServer:async id=>{calls++;return read?read(id):row;},getDoc:()=>{throw Error('cache-capable read forbidden');},convert:s=>s};
  vm.createContext(c);const fn=vm.runInContext(`(async function(id){${body}\n})`,c);
  return{fn,calls:()=>calls,switchScope:()=>{scope='owner:other';}};
}
test('status reader always uses server, returning only lifecycle/scope fields and no financial data',async()=>{
  const h=statusReader(),result=await h.fn('sale-1');assert.equal(h.calls(),1);assert.equal(result.active,false);assert.equal(result.id,'sale-1');assert.equal('custoTotal'in result,false);assert.equal('lucro'in result,false);assert.equal('itens'in result,false);
});
test('status reader rejects stale session and propagates server failure without a cache fallback',async()=>{
  let resolve;const h=statusReader({read:()=>new Promise(r=>{resolve=r;})}),pending=h.fn('sale-1');h.switchScope();resolve(sale());await assert.rejects(pending,/sessão ou permissão mudou/);
  const offline=statusReader({read:()=>{throw Object.assign(Error('offline'),{code:'unavailable'});}});await assert.rejects(offline.fn('sale-1'),{code:'unavailable'});assert.equal(offline.calls(),1);
});
test('status reader returns null for absent source and cannot be used for financial collections',async()=>{
  assert.equal(await statusReader({row:null}).fn('missing'),null);const financial=statusReader({collection:'payments'});await assert.rejects(financial.fn('private'),/requires a sale/);assert.equal(financial.calls(),0);
});
