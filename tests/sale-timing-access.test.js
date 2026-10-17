'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=fs.readFileSync('js/sale-timing-policy.js','utf8'),recorder=fs.readFileSync('js/sale-timing.js','utf8'),access=fs.readFileSync('js/sale-timing-access.js','utf8');
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))};
function harness({search='?fiado-timing=1',role='owner',owner='owner',status='active',businessId='adi-festa',failure=false,delayed=false}={}) {
 const listeners={},timers=[],controls={},stats={reads:0,imports:0,mounts:0},user={uid:'owner'};
 const control=key=>controls[key]||=( {disabled:false,textContent:'',onclick:null} );
 const panel={querySelector:control,setAttribute(){},append(){},remove(){stats.mounts=0},innerHTML:''};
 let release;
 const pending=delayed?new Promise(r=>release=r):Promise.resolve();
 const FixedDate=class extends Date {static now(){return Date.parse('2026-10-17T12:00:00Z')}};
 const c={URL,URLSearchParams,Date:FixedDate,performance:{now:()=>0},Set,WeakMap,Map,Object,JSON,Math,Promise,queueMicrotask,
  location:{origin:'https://veconi.app.br',search,href:'https://veconi.app.br/'+search+'#/configuracoes'},
  history:{replaceState(){}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},
  addEventListener:(name,fn)=>{listeners[name]=fn},
  document:{createElement:tag=>tag==='section'?panel:{},querySelector:()=>({before(){stats.mounts++}})},
  FirebaseSession:{user,businessId,business:{id:businessId,ownerId:'owner',subscription:{planId:'internal',status:'active'}},member:{role:'owner',status:'active'}},
  deps:{config:async()=>{stats.imports++;return {auth:{currentUser:user},db:{}}},
    firestore:async()=>({doc:(_db,...parts)=>parts.join('/'),getDocFromServer:async path=>{stats.reads++;await pending;if(failure)throw Error('private payload');return {exists:()=>true,id:path==='businesses/adi-festa'?'adi-festa':'owner',data:()=>path==='businesses/adi-festa'?{ownerId:owner,subscription:{planId:'internal',status:'active'}}:{role,status}}}}),
    recorder:async()=>({createSaleTiming:(options)=>c.createSaleTiming(options)})}
 };
 c.window=c;vm.createContext(c);
 vm.runInContext(policy.replaceAll('export ',''),c);
 vm.runInContext(recorder.replace('export function','function'),c);
 vm.runInContext(access.replace(/^import .*;\r?\n/m,'')
   .replace("import('./firebase/firebase-config.js')",'deps.config()')
   .replace("import('./firebase/workspace-firestore.js')",'deps.firestore()')
   .replace("import('./sale-timing.js?v=178')",'deps.recorder()'),c);
 return {c,stats,controls,listeners,timers,release};
}
test('flag absent: no server reads, recorder, UI, storage or capture',async()=>{
 const h=harness({search:''});await settle();assert.equal(h.stats.reads,0);assert.equal(h.stats.imports,0);assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.mounts,0);
});
test('URL flag alone cannot grant ordinary business access',async()=>{
 const h=harness({businessId:'another-business'});await settle();assert.equal(h.stats.reads,0);assert.equal(h.c.VeconiSaleTiming,undefined);
});
test('server membership and owner must agree; local profile cannot override them',async()=>{
 for(const config of [{role:'seller'},{owner:'other-owner'},{status:'disabled'}]){const h=harness(config);await settle();assert.equal(h.stats.reads,2);assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.mounts,0)}
});
test('server authorized internal owner still starts disabled; captures one attempt then disarms',async()=>{
 const h=harness();await settle();const api=h.c.VeconiSaleTiming;assert.ok(api);assert.equal(h.stats.reads,2);assert.equal(api.report().enabled,false);
 h.controls['[data-timing-enable]'].onclick();assert.equal(api.report().enabled,true);const token=api.begin();api.finish('ok',token);await settle();
 assert.equal(api.report().enabled,false);assert.equal(api.enable().enabled,false);assert.equal(api.begin(),null);assert.equal(h.stats.reads,2);assert.match(h.controls['[data-timing-status]'].textContent,/Coleta encerrada/);
});
test('signout destroys traces, API, panel and prevents stale callbacks from arming',async()=>{
 const h=harness();await settle();const api=h.c.VeconiSaleTiming;api.enable();api.begin();h.listeners['firebase-session-cleared']();await settle();assert.equal(api.report().traces.length,0);assert.equal(api.enable().enabled,false);assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.mounts,0);
});
test('stale authorization response after signout is ignored',async()=>{
 const h=harness({delayed:true});await settle();h.listeners['firebase-session-cleared']();h.release();await settle();assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.mounts,0);
});
test('network errors fail closed without affecting Auth/Sync or logging payloads',async()=>{
 const h=harness({failure:true});await settle();assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.mounts,0);assert.doesNotMatch(access,/console\.|setDoc|updateDoc|deleteDoc|localStorage|sessionStorage|indexedDB/);
});
test('TTL clears diagnostics only; session and operational state preserved',async()=>{
 const h=harness();await settle();const session=h.c.FirebaseSession;h.c.VeconiSaleTiming.enable();h.timers.at(-1)();await settle();assert.equal(h.c.VeconiSaleTiming,undefined);assert.strictEqual(h.c.FirebaseSession,session);
});
test('membership update revokes collection immediately without new reads',async()=>{
 const h=harness();await settle();h.c.VeconiSaleTiming.enable();h.c.FirebaseSession.member.role='seller';h.listeners['business-context-changed']();await settle();assert.equal(h.c.VeconiSaleTiming,undefined);assert.equal(h.stats.reads,2);
});
test('production origin, exact flag and expiry are required; no link to enable for normal users',()=>{
 const c={Date,URLSearchParams};vm.createContext(c);vm.runInContext(policy.replaceAll('export ',''),c);
 const origin='https://veconi.app.br',now=Date.parse('2026-10-17T12:00:00Z');
 assert.equal(c.requestsSaleTiming({origin,search:'?fiado-timing=1'},now),true);
 for(const location of [{origin:'https://fake.example',search:'?fiado-timing=1'},{origin,search:'?fiado-timing=true'},{origin,search:''}])assert.equal(c.requestsSaleTiming(location,now),false);
 assert.equal(c.requestsSaleTiming({origin,search:'?fiado-timing=1'},Date.parse('2026-10-25T00:00:00Z')),false);
});
test('V178 updates worker and keeps the same Sync singleton at both imports',()=>{
 const read=p=>fs.readFileSync(p,'utf8');assert.match(read('js/build-info.js'),/release: "178"/);assert.match(read('service-worker.js'),/veconi-v178-temporary-fiado-timing/);assert.match(read('service-worker.js'),/release:'178'/);
 for(const p of ['js/firebase/auth.js','js/firebase/firebase-ui.js'])assert.match(read(p),/import '\.\/sync\.js\?v=178'/);
 assert.match(read('index.html'),/type="module" src="\.\/js\/sale-timing-access.js\?v=178"/);
});
