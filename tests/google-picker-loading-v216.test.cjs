'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function harness(){
 const dom=new JSDOM('<div id="picker"></div>',{runScripts:'outside-only'}),w=dom.window;let timer,cleared=0;
 w.setTimeout=(fn,ms)=>{assert.equal(ms,12000);timer=fn;return 1;};w.clearTimeout=()=>cleared++;
 w.eval(fs.readFileSync('js/google-identity-picker.js','utf8').replace('export async function','async function')+';window.mountPicker=mountGoogleIdentityPicker;');
 return{w,target:w.document.getElementById('picker'),script:()=>w.document.querySelector('script'),timeout:()=>timer(),cleared:()=>cleared,mount:()=>w.mountPicker(w.document.getElementById('picker'),{clientId:'qa-only',nonce:'qa-nonce',onCredential:()=>{},onError:()=>{}})};
}
for(const cause of ['network','missing-sdk','timeout'])test('GIS '+cause+' releases loader and permits a fresh attempt',async()=>{
 const h=harness(),first=h.mount(),rejected=assert.rejects(first,e=>e.code===(cause==='timeout'?'google/provider-timeout':'link/google-unavailable')),old=h.script();
 if(cause==='network')old.onerror();else if(cause==='missing-sdk')old.onload();else h.timeout();await rejected;
 assert.equal(h.script(),null);assert.equal(h.cleared(),1);
 let initialized,rendered=0;const second=h.mount(),fresh=h.script();assert.notEqual(fresh,old);
 h.w.google={accounts:{id:{initialize:o=>initialized=o,renderButton:()=>rendered++}}};fresh.onload();const dispose=await second;
 assert.equal(rendered,1);assert.equal(initialized.nonce,'qa-nonce');assert.equal(initialized.auto_select,false);assert.equal(initialized.button_auto_select,false);assert.equal(initialized.ux_mode,'popup');dispose();h.w.close();
});
