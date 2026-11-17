'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {JSDOM}=require('jsdom');
const current=fs.readFileSync('js/sale-recovery-ui.js','utf8');
const baseline=()=>cp.execFileSync('git',['show','31d0ccb:js/sale-recovery-ui.js'],{encoding:'utf8'});
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function setup({source=current,noModal=false,send=async()=>({sent:2,evidence:{verification:'verified',missingCustomers:0}})}={}){
 const dom=new JSDOM('<main><div id="app"></div></main>'+(noModal?'':'<div id="modal"></div>'),{url:'https://qa.invalid/#/inicio',runScripts:'outside-only'}),w=dom.window,calls=[];
 let ctx={uid:'qa-seller',role:'seller',businessId:'qa-business',business:{active:true,workspaceGeneration:0},member:{status:'active'},userProfile:{uid:'qa-seller',active:false}},senderOptions;
 Object.assign(w,{MutationObserver:class{observe(){}},BusinessContext:{get:()=>ctx},FirebaseSession:{user:{uid:ctx.uid}},SpaceContext:{homeId:()=>ctx.space||'qa-space'},DB:{businessCache:{recoverySources:async()=>[]}},SaleRecoveryClient:{create:options=>{senderOptions=options;return{send:()=>send(options)};},entries:()=>[],describe:()=> 'Dois pacotes conferidos remotamente. Nenhum efeito comercial aplicado.'},FirebaseCallable:async(...args)=>{calls.push(args);return{items:[],nextCursor:null};}});
 w.eval(source+'\nwindow.QA={confirmSend,mount,refresh,set(k,v){if(k==="busy")busy=v;if(k==="scanError")scanError=v;if(k==="message")message=v;},prime(){count=2;customerCount=2;mount();},get busy(){return busy;}};');
 ctx.userProfile.active=true;w.QA.prime();
 return{w,dom,calls,get options(){return senderOptions;},ctx,button:()=>w.document.querySelector('[data-send-recovery]'),confirm:()=>w.document.querySelector('[data-recovery-confirm]'),result:()=>w.document.querySelector('[data-recovery-result]'),close:()=>w.close()};
}
for(const fixed of [false,true])test((fixed?'fixed':'published baseline')+': click after banner replacement '+(fixed?'opens confirmation':'loses handler'),async()=>{
 const h=setup({source:fixed?current:baseline()});try{const bar=h.button().closest('section');bar.innerHTML=bar.innerHTML;h.button().click();await tick();assert.equal(Boolean(h.confirm()),fixed);assert.equal(h.calls.length,0);}finally{h.close();}
});
for(const fixed of [false,true])test((fixed?'fixed':'published baseline')+': missing modal root '+(fixed?'is recreated':'silently does nothing'),async()=>{
 const h=setup({source:fixed?current:baseline(),noModal:true});try{h.button().click();await tick();assert.equal(Boolean(h.confirm()),fixed);assert.equal(h.calls.length,0);}finally{h.close();}
});
test('refresh preserves action node identity and its delegated click',async()=>{
 const h=setup();try{const button=h.button();h.w.QA.set('message','Conferindo');h.w.QA.mount();assert.equal(button,h.button());button.click();await tick();assert.ok(h.confirm());}finally{h.close();}
});
for(const guard of ['busy','scanError','session','offline'])test(guard+' produces an actionable alert without upload',async()=>{
 const h=setup();try{if(guard==='session')h.ctx.userProfile.active=false;else if(guard==='offline')Object.defineProperty(h.w.navigator,'onLine',{value:false});else h.w.QA.set(guard,guard==='busy'?true:'Falha de leitura local.');h.button().click();await tick();assert.match(h.w.document.querySelector('[role="alert"]').textContent,/andamento|preservados|registros|internet/);assert.equal(h.calls.length,0);}finally{h.close();}
});
test('setup exception from modal is visible and does not leave busy locked',async()=>{
 const h=setup();try{const root=h.w.document.querySelector('#modal');Object.defineProperty(root,'innerHTML',{set(){throw Error('Falha sintética ao abrir confirmação');}});h.button().click();await tick();assert.match(h.w.document.querySelector('[role="alert"]').textContent,/Falha sintética/);assert.equal(h.w.QA.busy,false);}finally{h.close();}
});
test('double confirmation uploads once, shows progress in dialog and only then verified result',async()=>{
 let finish,n=0;const h=setup({send:options=>{n++;options.onProgress({sent:1,total:2});return new Promise(resolve=>finish=resolve);}});
 try{h.button().click();await tick();const button=h.confirm(),first=button.onclick();assert.equal(button.disabled,true);assert.equal(h.w.document.querySelector('[data-view-recovery]').disabled,true);assert.match(h.result().textContent,/1 de 2/);await button.onclick();assert.equal(n,1);finish({sent:2,evidence:{verification:'verified',missingCustomers:0}});await first;assert.equal(h.confirm(),null);assert.match(h.result().textContent,/conferidos remotamente/);assert.equal(h.w.QA.busy,false);}finally{h.close();}
});
for(const code of ['permission-denied','unavailable','deadline-exceeded','internal'])test(code+': upload failure visible; uncertain response offers read only',async()=>{
 let sends=0;const h=setup({send:async()=>{sends++;throw Object.assign(Error('Falha sintética'),{code:'functions/'+code});}});
 try{h.button().click();await tick();await h.confirm().onclick();assert.equal(h.result().getAttribute('role'),'alert');assert.equal(h.w.QA.busy,false);if(code!=='permission-denied'){assert.equal(h.confirm().textContent,'Consultar recebimento');await h.confirm().onclick();assert.deepEqual(h.calls.map(c=>c[0]),['listSaleRecoveryReviews']);}assert.equal(sends,1);}finally{h.close();}
});
for(const change of ['space','session'])test(change+' changing during upload prevents stale progress and success',async()=>{
 let finish;const h=setup({send:()=>new Promise(resolve=>finish=resolve)});
 try{h.button().click();await tick();const promise=h.confirm().onclick();if(change==='space')h.ctx.space='other-space';else h.ctx.userProfile.active=false;h.w.QA.mount();h.options.onProgress({sent:1,total:2});finish({sent:2,evidence:{verification:'verified',missingCustomers:0}});await promise;assert.doesNotMatch(h.w.document.body.textContent,/conferidos remotamente/);assert.match(h.w.document.querySelector('[role="alert"]').textContent,/contexto mudou|sessão ou o espaço mudou/);assert.equal(h.w.QA.busy,false);}finally{h.close();}
});
test('30-second evidence timeout is surfaced without a second request',async()=>{
 const h=setup();try{let requests=0;h.w.FirebaseCallable=()=>{requests++;return new Promise(()=>{});};const real=h.w.setTimeout;h.w.setTimeout=(fn,ms)=>real(fn,ms===30000?1:ms);await assert.rejects(h.options.call('submitSaleRecovery',{}),e=>e.code==='deadline-exceeded');assert.equal(requests,1);}finally{h.close();}
});
