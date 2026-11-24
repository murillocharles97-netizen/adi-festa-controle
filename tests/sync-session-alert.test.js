const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
test('session hotfix keeps app/SW version and both Sync singleton imports aligned', () => {
  const read = file => fs.readFileSync(file, 'utf8');
  const build = read('js/build-info.js');
  const version = build.match(/release:\s*"(\d+)"/)[1];
  const appVersion = build.match(/APP_VERSION = "(\d+(?:\.\d+)?)"/)[1];
  const releaseTag = appVersion.replace('.', '');
  assert.ok(Number(version) >= 173);

  const listeners = {};
  const precache = vm.runInNewContext(`${read('service-worker.js')}\nARQUIVOS`, {
    self: { addEventListener: (name, handler) => { listeners[name] = handler; } },
  });
  let reported;
  listeners.message({ data: 'GET_VERSION', ports: [{ postMessage: value => { reported = value; } }] });
  assert.equal(reported.release, version);
  assert.equal(reported.appVersion, appVersion);
  assert.ok(reported.cache.startsWith(`veconi-v${releaseTag}-`));

  const modules = ['auth.js', 'firebase-ui.js'];
  const syncImports = modules.map(file => {
    const imports = [...read(`js/firebase/${file}`).matchAll(/^\s*import\s+['"](\.\/sync\.js(?:\?v=[\w-]+)?)['"];?/gm)];
    assert.equal(imports.length, 1, `${file} must load a single Sync module`);
    return imports[0][1];
  });
  assert.equal(syncImports[0], syncImports[1], 'both entry points must load the same Sync module URL');

  const htmlSources = [...read('index.html').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(m => m[1]);
  const htmlScript = file => {
    const paths = htmlSources.filter(src => src.split('?')[0] === `./js/${file}`);
    assert.equal(paths.length, 1, `HTML must load ${file} exactly once`);
    return paths[0];
  };
  const entryUrls = modules.map(file => htmlScript(`firebase/${file}`));
  const minor = Number(appVersion.split('.')[1] || '0');
  if (Number(version) < 242 || (version === '242' && minor <= 6)) {
    // V191 reuses Sync V190. V242 through V242.6 reuse Sync V241 and, after the visual release, UI V242.1.
    const syncVersion = ({ '191': '190', '242': '241' })[version] || version;
    const uiVersion = version === '242' && minor > 0 ? '2421' : syncVersion;
    assert.equal(syncImports[0], `./sync.js?v=${syncVersion}`);
    assert.deepEqual(entryUrls, modules.map(file => `./js/firebase/${file}?v=${uiVersion}`));
    return;
  }

  const syncUrl = `./js/firebase/${syncImports[0].slice(2)}`;
  for (const url of [...entryUrls, syncUrl, htmlScript('build-info.js')]) {
    const pin = url.split('?v=')[1];
    assert.match(pin || '', new RegExp(`^${releaseTag}(?:-[\\w-]+)?$`), `${url} must use the current release tag`);
    assert.ok(precache.includes(url), `${url} must be precached under the exact versioned URL`);
  }
});
function runtime() {
  const queues = new Map([['qa-business:owner', [{operationId:'persisted-operation', status:'pending', payload:{safe:true}}]]]);
  let starts = 0, stops = 0;
  const c = {console:{error(){},warn(){}}, Date, structuredClone, currentUser:null, syncSessionGeneration:0,
    state:{status:'idle',message:'Sessão encerrada',syncTrace:[],syncFailureHistory:[],sessionTrace:[]},
    DB:{getWorkspaceGeneration:()=>0},cloudReadController:null,cloudReadRestartTimer:null,signalCollections:new Set(),signalVersions:new Map(),signalPullTimer:null,
    addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}},
    canonicalClientSnapshots:new Map(),lastDataAuditRaw:null,cloudPaused:false,readOnlyMode:false,lastUserValidationAt:0,
    lastError:'',lastErrorCode:'',currentPath:'',auth:{currentUser:{uid:'owner'}},
    now:()=>new Date().toISOString(),friendlyError:e=>e.code,errorCode:e=>e.code,
    queueCounts:()=>({total:(queues.get(`qa-business:${c.currentUser?.uid||'anonymous'}`)||[]).length,pending:0,errors:0}),
    readSyncTime:()=>'',lastSyncKey:()=>'',lastAttemptKey:()=>'',lastCompleteKey:()=>'',
    emit:patch=>Object.assign(c.state,patch),stopAutoSync(){},stopCloudSubscriptions(){stops++},startCloudSubscriptions(){starts++},startAutoSync(){},
    migrateOwnerBusinessQueue(){},migrateLegacyQueue(){},migrateScopedQueueCompatibility(){},validateQueueOwnership(){},installOfflineFirstStorage(){},resumePreparedSales(){},updateQueueState(){},
    // Module state setUser resets on every session change (sync.js top-level lets).
    queueRetryTimer:null,queueRetryWakes:new Map(),
    listenerRegistry:new Map(),repositories:{},
    activeBusinessId:()=>c.state.userProfile?.businessId||'qa-business',
    window:{BusinessContext:{get:()=>({access:{readOnly:false}})}},
  };
  vm.createContext(c);
  vm.runInContext(section('const permissionSignature =', 'const queueKey ='),c);
  vm.runInContext(section('function reportError(', 'function enrich(')+section('function setUser(', 'function pendingActivityEvents(')+section('function captureCloudReadScope(', 'function startCloudSubscriptions('),c);
  const start=(uid='owner')=>{c.auth.currentUser={uid};c.setUser({uid},{uid,businessId:'qa-business'},{id:'qa-business',active:true,ownerId:uid});};
  return {c,start,queues,status:()=>({starts,stops}),identity:()=>vm.runInContext('namespace()',c)};
}
test('authenticated restart cannot retain the signed-out status/message',()=>{
  const h=runtime();h.start();assert.equal(h.c.state.status,'waiting');assert.match(h.c.state.message,/Preparando/);assert.doesNotMatch(h.c.state.message,/encerrada/);
});
test('stop/restart preserves the exact durable queue; zero signed-out count is not deletion',()=>{
  const h=runtime(),before=JSON.stringify([...h.queues]);h.start();assert.equal(h.c.queueCounts().total,1);
  h.c.setUser(null,null,null,{reason:'bootstrap_replaced'});assert.equal(h.c.queueCounts().total,0);
  assert.equal(JSON.stringify([...h.queues]),before);h.start();assert.equal(h.c.queueCounts().total,1);
  assert.equal(JSON.stringify([...h.queues]),before);assert.equal(h.c.state.sessionTrace.at(-2).pendingBefore,1);
});
test('active permission failure records read path/actors/queue and does not sign out or delete queue',()=>{
  const h=runtime();h.start();const before=JSON.stringify([...h.queues]);
  h.c.reportError(Object.assign(Error('Missing permissions'),{code:'permission-denied'}),'Realtime collection listener',{operation:'listen',collection:'settings/default',path:'businesses/qa-business/settings/default',subscriptionUid:'owner'});
  assert.equal(h.c.state.status,'error');assert.equal(h.c.currentUser.uid,'owner');assert.equal(JSON.stringify([...h.queues]),before);
  const entry=h.c.state.syncFailureHistory.at(-1);assert.equal(entry.path,'businesses/qa-business/settings/default');assert.equal(entry.authUid,'owner');assert.equal(entry.actorUid,'owner');assert.equal(entry.queue.total,1);
  h.c.state.syncFailure=null;assert.equal(h.c.state.syncFailureHistory.length,1);
});
test('diagnostic history is isolated when a different user logs in',()=>{
  const h=runtime();h.start();h.c.reportError(Object.assign(Error('denied'),{code:'permission-denied'}));
  h.c.setUser(null);h.start('seller');assert.equal(h.c.state.syncFailureHistory.length,0);assert.ok(h.c.state.sessionTrace.every(entry=>entry.actorUid==='seller'));
});
test('errors are bounded and a space filter does not replace identity or queue',()=>{
  const h=runtime();h.start();const before=JSON.stringify([...h.queues]),identity=h.identity();
  for(let n=0;n<15;n++)h.c.reportError(Object.assign(Error('denied'),{code:'permission-denied'}));
  assert.equal(h.c.state.syncFailureHistory.length,10);
  h.c.window.SpaceContext={currentSpaceId:'space-a'};h.c.window.SpaceContext.currentSpaceId='space-b';
  assert.equal(h.identity(),identity);assert.equal(h.c.currentUser.uid,'owner');assert.equal(h.c.syncSessionGeneration,1);assert.equal(JSON.stringify([...h.queues]),before);
});
test('obsolete collection callbacks cannot overwrite the new session; active denial is not swallowed',()=>{
  const h=runtime();h.start();let denied;
  h.c.repositories.settings={subscribeById(id,documents,error){denied=error;return()=>{}}};
  h.c.registerRealtimeCollection('settings','document');const old=denied;
  h.c.setUser(null);h.c.listenerRegistry.clear();h.start();
  h.c.registerRealtimeCollection('settings','document');
  old(Object.assign(Error('old context'),{code:'permission-denied'}));assert.equal(h.c.state.syncFailure,null);
  denied(Object.assign(Error('current context'),{code:'permission-denied'}));assert.equal(h.c.state.syncFailure.code,'permission-denied');assert.equal(h.c.state.syncFailure.path,'businesses/qa-business/settings/default');
});
test('sync signal callbacks are fenced too; a current denial retains its exact document path',()=>{
  const h=runtime();h.start();const c=h.c;let signal,denied;
  Object.assign(c,{canPullSource:()=>false,unsubscribers:[],usageSnapshot:()=>({activeListeners:0}),rememberSnapshotMetadata(){throw Error('stale callback ran');}});
  c.repositories.settings={subscribeById(){return()=>{}}};
  c.syncSignalRepository={subscribeById(id,callback,onError){signal=callback;denied=onError;return()=>{}}};
  vm.runInContext(section('function startCloudSubscriptions(', 'function stopCloudSubscriptions('),c);
  c.startCloudSubscriptions();const oldSignal=signal,oldDenied=denied;
  c.setUser(null);c.listenerRegistry.clear();h.start();
  oldSignal({revision:'obsolete'});oldDenied(Object.assign(Error('old'),{code:'permission-denied'}));assert.equal(c.state.syncFailure,null);
  denied(Object.assign(Error('active'),{code:'permission-denied'}));assert.equal(c.state.syncFailure.path,'businesses/qa-business/syncMetadata/last-sync');
});
