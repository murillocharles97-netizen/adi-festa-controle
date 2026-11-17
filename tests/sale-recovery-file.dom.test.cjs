'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{webcrypto}=require('node:crypto'),{JSDOM}=require('jsdom'),f=require('./helpers/customer-recovery-v205.cjs'),client=require('../js/sale-recovery-client');
const tick=()=>new Promise(r=>setTimeout(r,5));
function setup(){
 const dom=new JSDOM('<main><div id="app"><button data-export-recovery>Exportar arquivo de recuperação</button></div></main><div id="modal"></div>',{url:'https://qa.invalid/#/clientes',runScripts:'outside-only'}),w=dom.window,samples=[0,1].map(n=>f.sample(n)),sources=[{packets:samples.flatMap(s=>[s.original.packet,s.packet]),local:{vendas:samples.map(s=>s.original.localSale),movimentacoesEstoque:samples.flatMap(s=>s.original.localMovements)}}],before=JSON.stringify(sources),downloads=[],calls=[];
 const ctx={uid:f.seller,role:'seller',businessId:f.bid,business:{active:true,workspaceGeneration:0},member:{status:'active',spaceAccess:'selected',allowedSpaceIds:[f.spaceId]},userProfile:{uid:f.seller,active:false}};
 Object.assign(w,{MutationObserver:class{observe(){}},BusinessContext:{get:()=>ctx},FirebaseSession:{user:{uid:f.seller}},SpaceContext:{homeId:()=>f.spaceId},DB:{businessCache:{recoverySources:async()=>sources}},TextEncoder,TextDecoder,SyncFirebase:{downloadJsonFile:(...args)=>downloads.push(args)},FirebaseCallable:(...args)=>{calls.push(args);throw Error('Network forbidden');}});
 Object.defineProperty(w,'crypto',{value:webcrypto});w.eval(fs.readFileSync('js/sale-recovery-client.js','utf8'));w.eval(fs.readFileSync('js/sale-recovery-ui.js','utf8')+'\nwindow.QA={openRecoveryExport,mount,blockUpload(){busy=true;scanError="old upload failure";}};refresh=async()=>{};');ctx.userProfile.active=true;
 const select=()=>{w.document.querySelectorAll('[data-export-operation]').forEach(i=>i.checked=true);w.document.querySelector('[data-export-consent]').checked=true;},prepare=()=>w.document.querySelector('[data-export-prepare]'),save=()=>w.document.querySelector('[data-export-save]'),feedback=()=>w.document.querySelector('[data-export-result]');
 return{w,ctx,sources,before,downloads,calls,select,prepare,save,feedback,open:()=>w.QA.openRecoveryExport(),close:()=>w.close()};
}
test('Sync details export works while cloud-upload path is blocked; no automatic download or call',async()=>{
 const h=setup();try{h.w.QA.blockUpload();h.w.document.querySelector('[data-export-recovery]').click();await tick();assert.equal(h.w.document.querySelectorAll('[data-export-operation]').length,2);assert.equal(h.prepare().disabled,true);assert.equal(h.save().hidden,true);assert.equal(h.calls.length,0);assert.equal(h.downloads.length,0);assert.equal(JSON.stringify(h.sources),h.before);}finally{h.close();}
});
test('explicit selection, consent and saved code are required; output decrypts to the complete originals',async()=>{
 const h=setup();try{await h.open();await h.prepare().onclick();assert.match(h.feedback().textContent,/autorização/);assert.equal(h.downloads.length,0);h.select();await h.prepare().onclick();assert.equal(h.prepare().hidden,true);h.save().onclick();assert.match(h.feedback().textContent,/Guarde o código/);assert.equal(h.downloads.length,0);h.w.document.querySelector('[data-export-key-saved]').checked=true;h.save().onclick();assert.equal(h.downloads.length,1);assert.equal(h.calls.length,0);const code=h.w.document.querySelector('[data-export-code]').value,data=await client.openExport(h.downloads[0][0],code);assert.equal(data.records.length,2);assert.equal(JSON.stringify(h.sources),h.before);}finally{h.close();}
});
for(const change of ['session','space-access'])test(change+' before saving prevents release of a prepared file',async()=>{
 const h=setup();try{await h.open();h.select();await h.prepare().onclick();h.w.document.querySelector('[data-export-key-saved]').checked=true;if(change==='session')h.w.FirebaseSession.user={uid:'other'};else h.ctx.member.allowedSpaceIds=[];h.save().onclick();assert.equal(h.downloads.length,0);assert.match(h.feedback().textContent,/sessão ou o acesso/);}finally{h.close();}
});
test('unauthorized space is excluded; a raw envelope from it is never offered for selection',async()=>{
 const h=setup();try{h.ctx.member.allowedSpaceIds=[];await h.open();assert.equal(h.w.document.querySelectorAll('[data-export-operation]').length,0);assert.match(h.w.document.querySelector('[data-export-list]').textContent,/Nenhuma venda original/);assert.equal(h.downloads.length,0);}finally{h.close();}
});
test('local read failure is visible without a download, upload, clearing or retry',async()=>{
 const h=setup();try{h.w.DB.businessCache.recoverySources=async()=>{throw Error('Leitura local bloqueada');};await h.open();assert.equal(h.feedback().getAttribute('role'),'alert');assert.match(h.feedback().textContent,/Leitura local bloqueada/);assert.equal(h.downloads.length,0);assert.equal(h.calls.length,0);}finally{h.close();}
});
test('file extraction never invokes Sync diagnostics or its lazy legacy-queue adapter',async()=>{
 const h=setup();try{h.w.SyncFirebase.getQueueDiagnostics=()=>{throw Error('Lazy queue path must never be entered');};await h.open();h.select();await h.prepare().onclick();assert.equal(h.w.document.querySelector('[data-export-key]').hidden,false);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(h.sources),h.before);}finally{h.close();}
});
