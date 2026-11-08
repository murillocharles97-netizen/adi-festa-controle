'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('js/firebase/firebase-ui.js','utf8'),code=source.slice(source.indexOf('function openPaymentReview('),source.indexOf('function openQueueDetails('));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const width of [390,1366])test(`receipt review UI at ${width}px never applies until explicit confirmation; export and denial preserve review`,async()=>{
 const dom=new JSDOM('<div id="modal"></div>',{url:'https://qa.example.invalid',runScripts:'outside-only'}),w=dom.window,calls=[];w.innerWidth=width;
 try{w.escape=s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;');w.money=v=>'R$ '+Number(v).toFixed(2);w.formattedTime=v=>String(v);w.openQueueDetails=()=>{};w.confirm=()=>false;
  w.SyncFirebase={exportPreservedPayment:async(...args)=>calls.push(['export',...args]),reviewPreservedPayment:async()=>{calls.push(['review']);return{status:'ready_for_explicit_confirmation',amount:100,clientId:'qa-client',date:'2026-11-01T20:00:00Z'};},recoverPreservedPayment:async(...args)=>{calls.push(['apply',...args]);return{confirmed:true};}};
  w.eval(code);w.openPaymentReview('original-qa');assert.equal(calls.length,0);const button=s=>w.document.querySelector(s);assert.equal(button('[data-payment-confirm]').hidden,true);
  button('[data-payment-export]').click();await tick();assert.equal(calls[0][0],'export');button('[data-payment-review]').click();await tick();assert.equal(button('[data-payment-confirm]').hidden,false);assert.match(button('[data-payment-result]').textContent,/sem gravação/);
  button('[data-payment-confirm]').click();await tick();assert.equal(calls.some(x=>x[0]==='apply'),false);w.confirm=()=>true;button('[data-payment-confirm]').click();await tick();assert.equal(calls.filter(x=>x[0]==='apply').length,1);assert.equal(calls.at(-1)[3].confirmed,true);assert.equal(button('[data-payment-confirm]').hidden,true);assert.match(button('[data-payment-result]').textContent,/leitura independente/);
  w.openPaymentReview('original-qa');w.SyncFirebase.reviewPreservedPayment=async()=>{throw Error('Prova insuficiente');};button('[data-payment-review]').click();await tick();assert.equal(button('[data-payment-confirm]').hidden,true);assert.match(button('[data-payment-result]').textContent,/Prova insuficiente/);assert.equal(calls.filter(x=>x[0]==='apply').length,1);
 }finally{w.close();}
});
