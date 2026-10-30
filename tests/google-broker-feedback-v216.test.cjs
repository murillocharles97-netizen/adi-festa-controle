'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom'),client=require('../js/google-registration-client.js');
const adapter=fs.readFileSync('js/firebase/google-auth.js','utf8'),callSource=adapter.slice(adapter.indexOf('async function call('),adapter.indexOf('function picker('));
for(const [name,code]of [['TimeoutError','google/request-timeout'],['AbortError','google/request-timeout'],['TypeError','google/network-unavailable']])test('broker '+name+' produces clear recoverable feedback without retry',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;let calls=0;
 w.AbortSignal.timeout=ms=>{assert.equal(ms,30000);return{};};w.fetch=async()=>{calls++;throw name==='TypeError'?new w.TypeError('private transport details'):Object.assign(new w.Error('private transport details'),{name});};
 w.eval("const GOOGLE_BROKER_BASE_URL='https://qa.invalid';"+callSource+';window.brokerCall=call;');
 await assert.rejects(w.brokerCall('prepareGoogleAccountAccess',{step:'begin'}),e=>{assert.equal(e.code,code);assert.match(client.message(e),/conectar|demorou/i);assert.doesNotMatch(client.message(e),/private transport/);return true;});assert.equal(calls,1);w.close();
});
test('broker refusal is propagated without retries or credential calls',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;let calls=0;w.AbortSignal.timeout=()=>({});w.fetch=async()=>{calls++;return{ok:false,json:async()=>({error:{code:'access-unavailable'}})};};w.eval("const GOOGLE_BROKER_BASE_URL='https://qa.invalid';"+callSource+';window.brokerCall=call;');
 await assert.rejects(w.brokerCall('prepareGoogleAccountAccess',{step:'begin'}),e=>e.code==='access-unavailable');assert.equal(calls,1);w.close();
});
test('actual password handler marks only its in-flight request and releases marker on error',async()=>{
 const dom=new JSDOM('<form id="login-form"><input name="email" value="qa@example.test"><input name="password" value="qa-only"><button id="login-submit">Entrar</button></form>',{runScripts:'outside-only'}),w=dom.window,form=w.document.querySelector('form');let reject,authCalls=0,loginCalls=0;
 w.googleAuth={busy:()=>false};w.auth={};w.setButtonLoading=(b,on)=>b.disabled=on;w.signInWithEmailAndPassword=()=>{authCalls++;return new Promise((_,r)=>reject=r);};w.friendly=()=> 'Mensagem QA';w.login=()=>loginCalls++;
 const authSource=fs.readFileSync('js/firebase/auth.js','utf8'),start=authSource.indexOf("  document.querySelector('#login-form').onsubmit=async"),end=authSource.indexOf('\n  };',start)+6;w.eval(authSource.slice(start,end));
 const pending=form.onsubmit({preventDefault(){},currentTarget:form});assert.equal(form.dataset.passwordAuthBusy,'true');assert.equal(authCalls,1);reject({code:'auth/invalid-credential'});await pending;assert.equal(form.dataset.passwordAuthBusy,undefined);assert.equal(loginCalls,1);w.close();
});
