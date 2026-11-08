'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('js/firebase/firebase-ui.js','utf8'),code=source.slice(source.indexOf('function openPaymentReview('),source.indexOf('function openQueueDetails('));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const width of [390,1366])test(`receipt review UI at ${width}px only recognizes and exports`,async()=>{
 const dom=new JSDOM('<div id="modal"></div>',{url:'https://qa.example.invalid',runScripts:'outside-only'}),w=dom.window,calls=[];w.innerWidth=width;
 try{w.escape=s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;');w.openQueueDetails=()=>{};w.confirm=()=>false;
  w.SyncFirebase={exportPreservedPayment:async(...args)=>calls.push(['export',...args]),recognizePreservedPayment:async id=>{calls.push(['recognize',id]);return{confirmed:true};}};
  w.eval(code);w.openPaymentReview('original-qa');assert.equal(calls.length,0);const button=s=>w.document.querySelector(s);assert.equal(button('[data-payment-confirm]'),null);
  button('[data-payment-export]').click();await tick();button('[data-payment-review]').click();await tick();
  assert.deepEqual(calls,[['export','original-qa'],['recognize','original-qa']]);
  assert.match(button('[data-payment-result]').textContent,/saldo atualizado/);
  w.openPaymentReview('original-qa');w.SyncFirebase.recognizePreservedPayment=async()=>{throw Error('Prova insuficiente');};
  button('[data-payment-review]').click();await tick();assert.equal(button('[data-payment-confirm]'),null);
  assert.match(button('[data-payment-result]').textContent,/Prova insuficiente/);
 }finally{w.close();}
});
