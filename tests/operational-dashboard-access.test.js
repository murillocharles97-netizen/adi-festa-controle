'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8'),slice=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const now='2026-10-18T16:00:00.000Z',prior='2026-10-17T17:27:13.452Z';
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
function fixture(){
 const amounts=[25,30,40,45,50,55,60,96.6];
 return{config:{dashboard:{dailySalesGoal:1000,dailySalesGoalsBySpaceId:{a:1000,b:2000}}},
  vendas:[...amounts.map((value,n)=>({id:'sale-'+n,businessId:'biz',spaceId:'a',actorUid:n<4?'owner':n<6?'seller-a':'seller-b',status:'pago',data:now,createdAt:now,updatedAt:now,valorFinal:value,itens:[{produtoId:'p0',quantidade:1,precoFinalUnitario:value,subtotalFinal:value}]})),{id:'original',businessId:'biz',spaceId:'a',actorUid:'seller-a',status:'pago',data:prior,createdAt:prior,updatedAt:now,valorFinal:59.9,itens:[]}],
  clientes:Array.from({length:37},(_,i)=>({id:'client-'+i,businessId:'biz',nome:'QA '+i,ativo:true,active:true})),
  produtos:Array.from({length:180},(_,i)=>({id:'p'+i,businessId:'biz',ativo:true,active:true,spaceAccessMode:'single_space',allowedSpaceIds:['a'],defaultSpaceId:'a',estoqueAtual:10})),pagamentos:[],campanhas:[],progressosCampanha:[],recompensas:[],catalogOrders:[]};
}
function runtime(data=fixture()){
 let c,db=data;const handlers=new Map(),storage=new Map();
 const s={console,structuredClone,Date:Clock,Map,Set,Number,String,Array,Object,Math,JSON,Error,Promise,setTimeout,clearTimeout,performance,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},addEventListener:(name,fn)=>handlers.set(name,[...(handlers.get(name)||[]),fn]),dispatchEvent(){},queueMicrotask(){},MutationObserver:class{observe(){}},
  matchMedia:()=>({matches:true,addEventListener(){}}),localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
  document:{querySelector:()=>null,querySelectorAll:()=>[],documentElement:{dataset:{}}},BusinessContext:{get:()=>c},FirebaseSession:{},
  DB:{carregar:()=>db,getBusinessId:()=>c.businessId},Utils:{hoje:d=>new Clock(d).toDateString()===new Clock().toDateString(),dinheiro:n=>Number(n).toFixed(2),escapar:String},OperationMode:{enabled:()=>false},Campanhas:{metricas:()=>({}),status:()=>''},CustomerSubscriptions:{metrics:()=>({})},getProductStockStatus:()=> 'disponivel'};
 s.window=s;vm.createContext(s);
 const change=(uid,role='seller',permissions=['sales.create','customers.view','products.view','inventory.view'],space='a')=>{
  c={businessId:'biz',business:{name:'QA'},userProfile:{uid,businessId:'biz'},role,permissions:role==='owner'?['*']:permissions,permissionSignature:role+'-'+permissions.join(','),spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:role==='owner'?[]:[space]};s.FirebaseSession={businessId:'biz',user:{uid},profile:{uid,role,businessId:'biz'}};
 };
 change('owner','owner');
 for(const file of ['js/team-access.js','js/spaces.js','js/desktop-dashboard.js','js/home-mobile.js','js/activity-center.js'])vm.runInContext(read(file),s);
 const spaces=[{id:'a',businessId:'biz',name:'A',type:'business',capabilities:{sales:true,products:true,inventory:true,finance:true,goals:true}},{id:'b',businessId:'biz',name:'B',type:'business',capabilities:{sales:true,products:true,inventory:true,finance:true,goals:true}}];
 const login=(...args)=>{change(...args);s.SpaceContext.setSpaces(spaces);s.SpaceContext.selectHome('a');};login('owner','owner');
 return{s,login,context:()=>c,setData:d=>{db=d;},handlers};
}
test('real-shaped snapshot: 401.60/8 store sales, 37 customers, 180 products for owner and both sellers, daily/month periods equal',()=>{
 const data=fixture(),r=runtime(data),outputs=[];
 for(const [uid,role]of [['owner','owner'],['seller-a','seller'],['seller-b','seller'],['owner','owner']]){
  r.login(uid,role);const desktop=r.s.DesktopDashboard.aggregate(data,'today'),month=r.s.DesktopDashboard.aggregate(data,'month'),mobile=r.s.MobileHome.model();
  outputs.push([desktop.todayRevenue,desktop.today.length,desktop.clients.length,desktop.products.length,desktop.goalPercent,mobile.sold,mobile.today.length,mobile.clients.length,month.revenue]);
  assert.equal(desktop.todayRevenue,401.6);assert.equal(desktop.today.length,8);assert.equal(desktop.clients.length,37);assert.equal(desktop.products.length,180);assert.equal(desktop.goal,1000);assert.ok(Math.abs(desktop.goalPercent-40.16)<1e-8);assert.equal(month.revenue,461.5);
 }
 for(const result of outputs)assert.deepEqual(result,outputs[0]);
 // The old own-actor dataset explains 0 today versus 59.90 in 7 days.
 r.setData({...data,vendas:data.vendas.filter(s=>s.id==='original')});assert.equal(r.s.MobileHome.model().sold,0);assert.equal(r.s.DesktopDashboard.aggregate(r.s.DB.carregar(),'7d').revenue,59.9);
});
test('store metrics respond to owner, seller A and seller B operations; customer with no sale is counted and explicit foreign scopes are excluded',()=>{
 const data=fixture(),r=runtime(data);let expected=401.6;
 for(const actorUid of ['owner','seller-a','seller-b']){
  data.vendas.push({id:'added-'+actorUid,businessId:'biz',spaceId:'a',actorUid,data:now,status:'pago',valorFinal:10,itens:[]});expected+=10;
  for(const [uid,role]of [['owner','owner'],['seller-a','seller'],['seller-b','seller']]){r.login(uid,role);assert.equal(r.s.DesktopDashboard.aggregate(data,'today').todayRevenue,expected);}
 }
 data.clientes.push({id:'foreign',businessId:'another',ativo:true},{id:'b',businessId:'biz',spaceId:'b',ativo:true});
 data.vendas.push({id:'other',businessId:'biz',spaceId:'b',actorUid:'seller-b',data:now,status:'pago',valorFinal:1000,itens:[]});
 r.login('seller-a');assert.equal(r.s.DesktopDashboard.aggregate(data,'today').clients.length,37);assert.equal(r.s.DesktopDashboard.aggregate(data,'today').todayRevenue,expected);
});
test('sensitive routes, cost/profit projections and financial cache stay denied; no persistent grants change',()=>{
 const r=runtime();r.login('seller-a');const before=JSON.stringify(r.context());
 assert.equal(r.s.TeamAccess.canReadOperationalSales(),true);assert.equal(r.s.TeamAccess.has('sales.viewAll'),false);
 for(const route of ['financeiro','equipe','configuracoes','relatorios'])assert.equal(r.s.TeamAccess.canRoute(route),false);
 const data={produtos:[{custo:7}],vendas:[{custoTotal:7,lucro:3,itens:[{custoUnitario:7,lucro:3}]}],productFinancials:[{custo:7}],variantFinancials:[{cost:7}],saleFinancials:[{custoTotal:7,lucro:3}],stockMovementFinancials:[{custoUnitario:7}],financialEntries:[{amountCents:1000}]};
 r.s.TeamAccess.sanitizePrivateCache(data);assert.doesNotMatch(JSON.stringify(data),/custo|cost|lucro|Financials|financialEntries/);assert.equal(JSON.stringify(r.context()),before);
 r.login('stock','stock',['products.view','inventory.view']);assert.equal(r.s.TeamAccess.canReadOperationalSales(),false);
});
test('history shares only operational sales, filters other spaces/businesses, and keeps other-actor financial events hidden',()=>{
 const r=runtime();r.login('seller-a');
 const events=[['owner-sale','sale','owner','a','biz'],['seller-b-sale','sale','seller-b','a','biz'],['foreign-sale','sale','owner','b','biz'],['cross-business','sale','owner','a','foreign'],['owner-payment','payment','owner','a','biz']].map(([id,type,actorUid,spaceId,businessId])=>({id,eventId:id,type,entityId:id,actorUid,spaceId,businessId,createdAt:now,status:'confirmed',summary:{amount:10}}));
 assert.deepEqual(Array.from(r.s.ActivityCenter.events(events),e=>e.id).sort(),['owner-sale','seller-b-sale']);
});
function repositoryRuntime(){
 const r=runtime(),s=r.s;let rows=[],queries=[],listeners=[];const auth={currentUser:{uid:'owner'}};
 const snap=()=>({docs:rows.map(x=>({id:x.id,exists:()=>true,data:()=>x})),size:rows.length,metadata:{},docChanges:()=>[]});
 Object.assign(s,{auth,db:{},collection:(_db,...parts)=>({path:parts.join('/')}),doc:(_db,...parts)=>({path:parts.join('/')}),documentId:()=> '__name__',where:(field,op,value)=>({type:'where',field,op,value}),and:(...filters)=>({type:'and',filters}),or:(...filters)=>({type:'or',filters}),firebaseQuery:(ref,...constraints)=>({ref,constraints}),orderBy:(field,direction)=>({type:'orderBy',field,direction}),limit:max=>({type:'limit',max}),startAfter:cursor=>({type:'startAfter',cursor}),normalizeFirestoreData:x=>x,recordFirestoreOperation(){},listenerOpened(){},listenerClosed(){},getDocsFromServer:async q=>{queries.push(q);return snap();},getDocs:async q=>{queries.push(q);return snap();},onSnapshot:(q,fn,err)=>{listeners.push({q,fn,err});return()=>{};}});
 vm.runInContext(read('js/firebase/firestore-repository.js').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm,'').replaceAll('export ', '')+'\nwindow.createFirestoreRepository=createFirestoreRepository;window.visibilityConstraints=visibilityConstraints;',s);
 return{...r,queries,listeners,snap,setRows:x=>{rows=x;},login(uid,role='seller'){r.login(uid,role);auth.currentUser={uid};}};
}
test('actual repository query has space constraint without actor-only sales; history OR shares sale events only; cache is isolated owner -> seller -> owner',async()=>{
 const r=repositoryRuntime(),repo=r.s.createFirestoreRepository('sales');
 r.setRows([{id:'public-owner',createdAt:now}]);await repo.listRecent(100);assert.equal(r.queries.length,1);
 r.login('seller-a');r.setRows([{id:'same-store',createdAt:now}]);assert.equal((await repo.listRecent(100))[0].id,'same-store');assert.equal(r.queries.length,2);
 const filters=JSON.stringify(r.queries.at(-1));assert.match(filters,/spaceId/);assert.doesNotMatch(filters,/actorUid/);
 const history=JSON.stringify(r.s.visibilityConstraints('activityEvents'));assert.match(history,/"or"/);assert.match(history,/"type"/);assert.match(history,/"sale"/);assert.match(history,/actorUid/);
 r.login('owner','owner');assert.equal((await repo.listRecent(100))[0].id,'public-owner');assert.equal(r.queries.length,2);
});
test('late repository/history callbacks and in-flight reads cannot publish owner snapshots after login switch',async()=>{
 const r=repositoryRuntime(),repo=r.s.createFirestoreRepository('activityEvents');let received=0;repo.subscribeRecent(()=>received++);
 const old=r.listeners[0];r.login('seller-a');old.fn(r.snap());assert.equal(received,0);
 repo.subscribeRecent(()=>received++);r.listeners[1].fn(r.snap());assert.equal(received,1);
 let release;r.s.getDocsFromServer=()=>new Promise(resolve=>{release=resolve;});const pending=r.s.createFirestoreRepository('sales').listRecent(100,{force:true});r.login('owner','owner');release(r.snap());await assert.rejects(pending,/sessão ou permissão/);
});
test('shared history bounds OR queries/listeners to 15 spaces per group, avoiding a 60-disjunction query for 30 allowed spaces',async()=>{
 const r=repositoryRuntime();r.login('seller-a');r.context().allowedSpaceIds=Array.from({length:30},(_,i)=>'space-'+i);
 const repo=r.s.createFirestoreRepository('activityEvents');await repo.listAllPaged(5);assert.equal(r.queries.length,2);
 for(const q of r.queries){const group=q.constraints.find(c=>c.type==='and').filters.find(c=>c.field==='spaceId');assert.equal(group.value.length,15);}
 let calls=0;const stop=repo.subscribeRecent(()=>calls++);assert.equal(r.listeners.length,2);r.listeners[0].fn(r.snap());assert.equal(calls,0);r.listeners[1].fn(r.snap());assert.equal(calls,1);stop();
});
function pullRuntime(){
 const r=runtime(),s=r.s;let saved={},failFlush=false,full=0,delta=0,applied=0;
 Object.assign(s,{currentUser:{uid:'seller-a'},syncSessionGeneration:1,validateUser:async()=>{},activeBusinessId:()=> 'biz',canPullSource:()=>true,DEFAULT_PULL_NAMES:['sales'],CLOUD_NAMES:['sales'],INITIAL_FULL_NAMES:new Set(),INITIAL_RECENT_LIMITS:{sales:200},PULL_TTL_MS:300000,lastPullAt:0,
  readPullState:()=>structuredClone(saved),writePullState:state=>{saved=structuredClone(state);},performance,now:()=>now,syncStep:async(_stage,fn)=>fn(),state:{cloudCounts:{},cloudNewest:{}},rememberSnapshotMetadata(){},newestTimestamp:docs=>docs.at(-1)?.updatedAt||'',emit(){},
  applyCloudCollectionBatch:()=>{applied++;return 8;},repositories:{sales:{listAllPaged:async()=>{full++;return fixture().vendas;},listChangedSince:async()=>{delta++;return[];},getLastReadMetadata:()=>({})}}});
 s.DB.flush=async()=>{if(failFlush)throw Error('durability failed');};r.login('seller-a');
 vm.runInContext(slice(read('js/firebase/sync.js'),'async function pullCloudCollections(','async function ensureClientProjection(')+'\nwindow.pullCloudCollections=pullCloudCollections;',s);
 saved['biz:sales']=now;
 return{...r,pull:()=>s.pullCloudCollections({force:true,names:['sales']}),saved:()=>structuredClone(saved),counts:()=>({full,delta,applied}),failFlush:()=>{failFlush=true;}};
}
test('read policy expands via one complete paginated read despite newer own-only cursor; reload then uses incremental path without touching queues',async()=>{
 const r=pullRuntime();await r.pull();assert.equal(r.counts().full,1);assert.equal(r.counts().delta,0);assert.match(r.saved()['biz:sales:readScope'],/store-sales-v2/);
 await r.pull();assert.equal(r.counts().full,1);assert.equal(r.counts().delta,1);
 const previous=r.s.TeamAccess.operationalReadScopeKey();r.login('seller-b');r.s.currentUser={uid:'seller-b'};assert.notEqual(previous,r.s.TeamAccess.operationalReadScopeKey());await r.pull();assert.equal(r.counts().full,2);
});
test('failed durable cache write never advances read-policy cursor; retired session never applies its old snapshot',async()=>{
 const r=pullRuntime(),before=r.saved();r.failFlush();await assert.rejects(r.pull(),/durability/);assert.deepEqual(r.saved(),before);
 const retired=pullRuntime();retired.s.repositories.sales.listAllPaged=async()=>{retired.s.syncSessionGeneration++;return fixture().vendas;};await assert.rejects(retired.pull(),{code:'sync-session-retired'});assert.equal(retired.counts().applied,0);assert.equal(retired.saved()['biz:sales:readScope'],undefined);
});
test('history subscription is renewed on UID/permission changes, not only businessId; no stale pagination clears the new cursor',()=>{
 const r=runtime(),s=r.s;let callback,stops=0,received=0;
 Object.assign(s,{currentUser:{uid:'owner'},syncSessionGeneration:1,activitySubscriptionGeneration:0,activityEventsCursor:null,activityEventsHasMore:false,activityEventsRepository:{subscribeRecent:fn=>{callback=fn;return()=>stops++;}}});
 vm.runInContext(slice(read('js/firebase/sync.js'),'function subscribeRecentActivityEvents(','addEventListener("online"')+'\nwindow.subscribeRecentActivityEvents=subscribeRecentActivityEvents;',s);
 const old=s.subscribeRecentActivityEvents(()=>received++),late=callback;const fresh=s.subscribeRecentActivityEvents(()=>received++);callback([],{},{cursor:'fresh',hasMore:true});old();late([],{},{cursor:'old',hasMore:false});assert.equal(s.activityEventsCursor,'fresh');assert.equal(received,1);fresh();assert.equal(stops,2);
});
