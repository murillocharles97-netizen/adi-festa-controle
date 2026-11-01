'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),P=require('../functions/src/shared/permission-policy'),M=require('../js/team-permission-model');
const read=p=>fs.readFileSync(p,'utf8');
const member=(daily,history)=>({role:'seller',status:'active',permissionsVersion:3,permissions:{'sales.create':true,'performance.daily':daily,'performance.history':history}});
function harness(){
 const d=new JSDOM('<main id="app"></main><div id="modal"></div>',{runScripts:'outside-only',url:'http://127.0.0.1/qa'}),w=d.window;
 let closed=false;w.queueMicrotask=fn=>queueMicrotask(()=>{if(!closed)fn();});w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};
 for(const p of ['tests/fixtures/performance-v224.js','functions/src/shared/permission-policy.js','js/team-access.js','js/team-permission-model.js','js/team-permission-editor.js','js/performance-access.js','js/desktop-dashboard.js','js/home-mobile.js'])w.eval(read(p));
 return{w,q:s=>w.document.querySelector(s),close:()=>{closed=true;w.PerformanceAccess.invalidate();w.close();},async settle(){await new Promise(setImmediate);}};
}
test('legacy access preserved without mutation; V3 explicitly separates sales from performance',()=>{
 for(const permissions of [{'sales.create':true},{'sales.viewAll':true},{'reports.view':true}])for(const version of [1,2]){const x={role:'seller',permissionsVersion:version,permissions},before=JSON.stringify(x);assert.equal(P.has(x,'performance.history'),true);assert.equal(P.has(x,'performance.daily'),true);assert.equal(JSON.stringify(x),before);assert.deepEqual(M.explicit(x),P.effective(x));}
 assert.equal(P.has({role:'stock',permissions:{'inventory.view':true}},'performance.daily'),false);
 for(const version of [1,2,3])assert.equal(P.has({permissionsVersion:version,permissions:{'sales.create':true,'performance.history':false}},'performance.history'),false);
 assert.equal(P.has(member(true,false),'sales.create'),true);assert.equal(P.has(member(true,false),'performance.history'),false);assert.equal(P.has(member(false,false),'performance.daily'),false);
 assert.equal(M.preset('seller')['performance.daily'],true);assert.equal(M.preset('seller')['performance.history'],false);assert.equal(M.preset('seller')['financial.view'],false);
 assert.equal(P.has({role:'owner',permissionsVersion:3,permissions:{}},'performance.history'),true);
});
test('company timezone boundary, DST and yesterday never become today by local machine timezone',()=>{
 assert.deepEqual(P.dayWindow(new Date('2026-11-01T02:59:59Z'),'America/Sao_Paulo'),{day:'2026-10-31',zone:'America/Sao_Paulo',from:'2026-10-31T03:00:00.000Z',to:'2026-11-01T03:00:00.000Z'});
 assert.equal(P.dayWindow(new Date('2026-11-01T03:00:00Z')).day,'2026-11-01');
 const dst=P.dayWindow(new Date('2026-03-08T15:00:00Z'),'America/New_York');assert.equal((Date.parse(dst.to)-Date.parse(dst.from))/3600000,23);
 assert.equal(P.visiblePerformanceRecord(member(true,false),{data:'2026-11-01T02:59:00Z'},new Date('2026-11-01T03:01:00Z')),false);
});
test('daily desktop/mobile use canonical scalar read, all store operators; no old rows or comparisons in model or markup',async()=>{
 const h=harness(),{w}=h;try{w.document.querySelector('#app').innerHTML=w.DesktopDashboard.render();w.DesktopDashboard.bind();await h.settle();const text=w.document.body.textContent;
 assert.match(text,/200,00/);assert.match(text,/2 vendas/);assert.match(text,/300,00/);assert.match(text,/40%/);assert.doesNotMatch(text,/7777|7\.777|Melhor dia|Ticket médio|Crescimento|Média diária|vs\.|Últimos 7/);
 assert.equal(w.DesktopDashboard.aggregate(w.qaV224.data).restricted,true);assert.equal(w.DesktopDashboard.aggregate(w.qaV224.data).sales,undefined);assert.equal(w.MobileHome.model().restricted,true);assert.equal(w.MobileHome.model().sales,undefined);
 assert.equal(w.qaV224.effects.calls.length,1);assert.equal(w.qaV224.effects.calls[0].name,'getDailySalesPerformance');assert.equal(w.qaV224.effects.commercialWrites,0);
 }finally{h.close();}
});
test('daily scope filters history by date, company and space; reports and export routes cannot override history denial',()=>{
 const h=harness(),{w}=h;try{
 assert.equal(w.PerformanceAccess.filter(w.qaV224.data.vendas).length,2);assert.equal(w.PerformanceAccess.recordAllowed({...w.qaV224.data.vendas[0],spaceId:'forbidden'}),false);assert.equal(w.PerformanceAccess.recordAllowed({...w.qaV224.data.vendas[0],businessId:'other'}),false);
 const c=w.qaV224.context();w.qaV224.change({member:{...c.member,permissions:{...c.member.permissions,'reports.view':true,'settings.manage':true}}});assert.equal(w.TeamAccess.canRoute('relatorios'),false);assert.equal(w.TeamAccess.canRoute('crm'),false);
 assert.match(read('js/app.js'),/function baixarBackup[^]*?performance\.history/);assert.match(read('js/activity-center.js'),/recordAllowed/);
 }finally{h.close();}
});
test('lost read response, retry and offline preserve originals/queues; stale principal response cannot republish old totals',async()=>{
 const h=harness(),{w}=h;try{
 const before=JSON.stringify(w.qaV224.data);let resolve,reads=0;w.FirebaseCallable=()=>{reads++;return new Promise(r=>resolve=r);};
 const pending=w.PerformanceAccess.refresh();await h.settle();w.qaV224.change({businessId:'another-business',userProfile:{uid:'new-user',businessId:'another-business'}});
 resolve({data:{businessId:'qa-business'}});await pending;assert.equal(w.PerformanceAccess.state().ready,false);assert.equal(JSON.stringify(w.qaV224.data),before);assert.equal(reads,1);
 }finally{h.close();}
});
test('revocation invalidates visible numbers immediately; late grant keeps UID and does not trigger writes',async()=>{
 const h=harness(),{w}=h;try{
 h.q('#app').innerHTML=w.DesktopDashboard.render();w.DesktopDashboard.bind();await h.settle();assert.match(w.document.body.textContent,/200,00/);
 const c=w.qaV224.context(),uid=w.FirebaseSession.user.uid;w.qaV224.change({member:{...c.member,permissions:{'sales.create':true,'performance.daily':false,'performance.history':false}}});assert.doesNotMatch(w.document.body.textContent,/200,00|300,00/);assert.match(w.document.body.textContent,/Pronto para atender/);assert.equal(w.TeamAccess.has('sales.create'),true);assert.equal(w.FirebaseSession.user.uid,uid);assert.equal(w.qaV224.effects.commercialWrites,0);
 }finally{h.close();}
});
test('owner and explicitly authorized employee retain full dashboard without widening cost/finance grants',()=>{
 const h=harness(),{w}=h;try{
 const c=w.qaV224.context();w.qaV224.change({member:{...c.member,permissions:{...c.member.permissions,'performance.history':true}}});assert.equal(w.PerformanceAccess.restricted(),false);assert.match(w.DesktopDashboard.render(),/Melhor dia|Desempenho de vendas/);assert.equal(w.TeamAccess.has('financial.view'),false);
 w.qaV224.change({role:'owner',member:w.qaV224.owner,userProfile:{uid:'qa-owner',businessId:'qa-business'},spaceAccess:'all'});assert.equal(w.TeamAccess.has('performance.history'),true);assert.equal(w.PerformanceAccess.restricted(),false);
 }finally{h.close();}
});
test('compatible rollback suspends staff performance without changing grants, UID, queues or owner access',()=>{
 const h=harness(),{w}=h;try{const before=JSON.stringify(w.qaV224.data),grants=JSON.stringify(w.qaV224.context().member);
 w.AdiFestaBuild={performanceViewsPaused:true};assert.equal(w.TeamAccess.has('performance.daily'),false);assert.equal(w.TeamAccess.has('performance.history'),false);assert.equal(w.TeamAccess.has('sales.create'),true);assert.match(w.PerformanceAccess.render(),/Pronto para atender/);assert.equal(JSON.stringify(w.qaV224.data),before);assert.equal(JSON.stringify(w.qaV224.context().member),grants);
 w.qaV224.change({role:'owner',member:w.qaV224.owner,userProfile:{uid:'qa-owner',businessId:'qa-business'},spaceAccess:'all'});assert.equal(w.TeamAccess.has('performance.history'),true);
 }finally{h.close();}
});
test('explicit daily restriction fails closed when the reporting renderer is unavailable',()=>{
 const h=harness(),{w}=h,access=w.PerformanceAccess;try{w.PerformanceAccess=undefined;
 assert.equal(w.TeamAccess.requiresDailyDashboard(),true);assert.doesNotMatch(w.DesktopDashboard.render(),/7777|Melhor dia|Crescimento/);assert.match(w.DesktopDashboard.render(),/Não foi possível carregar/);assert.equal(w.DesktopDashboard.aggregate(w.qaV224.data).restricted,true);assert.equal(w.MobileHome.model().restricted,true);
 }finally{w.PerformanceAccess=access;h.close();}
});
test('read failure and lost response permit only a bounded retry; offline keeps original commercial payloads',async()=>{
 const h=harness(),{w}=h;try{
 const original=JSON.stringify(w.qaV224.data);let reads=0;w.FirebaseCallable=async()=>{reads++;throw Error('Falha fictícia de rede');};await w.PerformanceAccess.refresh();await w.PerformanceAccess.refresh();assert.equal(reads,1);assert.match(w.PerformanceAccess.state().error,/rede/);await w.PerformanceAccess.refresh({force:true});assert.equal(reads,2);assert.equal(w.PerformanceAccess.state().ready,false);assert.equal(JSON.stringify(w.qaV224.data),original);assert.equal(w.qaV224.effects.commercialWrites,0);
 }finally{h.close();}
});
test('midnight retires yesterday summary; a fresh read confirms the new company day, no queue writes',async()=>{
 const h=harness(),{w}=h;try{let time=Date.parse('2026-11-01T02:59:59Z');const Native=w.Date;
 w.Date=class extends Native{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};
 await w.PerformanceAccess.refresh();assert.equal(w.PerformanceAccess.state().value.day,'2026-10-31');assert.equal(w.PerformanceAccess.state().ready,true);
 time=Date.parse('2026-11-01T03:00:00Z');assert.equal(w.PerformanceAccess.state().ready,false);assert.doesNotMatch(w.PerformanceAccess.render(),/200,00/);await w.PerformanceAccess.refresh({force:true});assert.equal(w.PerformanceAccess.state().value.day,'2026-11-01');assert.equal(w.qaV224.effects.commercialWrites,0);
 }finally{h.close();}
});
for(const width of [320,360,390,430,768,1440])test('editor real DOM '+width+'px: two independent permissions, explicit V3 save and no mutation on cancel',async()=>{
 const h=harness(),{w}=h;try{w.matchMedia=()=>({matches:width<641,addEventListener(){}});w.qaV224.change({role:'owner',member:w.qaV224.owner,userProfile:{uid:'qa-owner',businessId:'qa-business'},permissions:['*'],spaceAccess:'all'});w.TeamPermissionEditor.open(w.qaV224.seller,{onClose:()=>{}});
 assert.ok(h.q('[data-tp-key="performance.daily"]'));assert.ok(h.q('[data-tp-key="performance.history"]'));assert.equal(h.q('[data-tp-key="performance.history"]').checked,false);assert.match(w.document.body.textContent,/Financeiro, custos ou lucro/);assert.equal(w.qaV224.effects.permissionWrites,0);h.q('[data-tp-back]').click();assert.equal(w.qaV224.effects.permissionWrites,0);
 const serialized=M.serialize(w.qaV224.seller,{role:'seller',spaceAccess:'selected',allowedSpaceIds:['qa-a'],permissions:M.explicit(w.qaV224.seller)});assert.equal(serialized.permissionsVersion,3);assert.equal(serialized.permissions['sales.create'],true);assert.equal(serialized.permissions['performance.history'],false);
 }finally{h.close();}
});
