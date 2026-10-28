'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),Policy=require('../functions/src/shared/permission-policy');
function setup(width=390,member={}){
 const dom=new JSDOM('<main id="app"></main><div id="modal"></div>',{url:'https://qa.example.invalid',runScripts:'outside-only'}),w=dom.window;
 let context={businessId:'qa',businessName:'Loja fictícia QA',role:'owner',permissions:['*']},calls=[],resolve,reject;
 w.BusinessContext={get:()=>context};w.FirebaseSession={user:{uid:'qa-owner'}};w.matchMedia=()=>({matches:width<=640});w.lucide={createIcons(){}};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.SpaceContext={homeSpaces:()=>[{id:'qa-a',name:'Loja QA',businessId:'qa'},{id:'qa-b',name:'QA adicional',businessId:'qa'}]};w.VeconiPermissionPolicy=Policy;
 for(const file of ['js/team-permission-model.js','js/team-access.js','js/team-permission-editor.js'])w.eval(fs.readFileSync(file,'utf8'));
 w.TeamService={updateMember:async(uid,input)=>{calls.push({uid,input});return new Promise((a,b)=>{resolve=a;reject=b;});}};
 const original={uid:'qa-seller',name:'Pessoa fictícia QA',email:'pessoa@example.invalid',role:'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:['qa-a'],permissions:{'customers.view':true},permissionsVersion:2,...member};
 w.TeamPermissionEditor.open(original);const q=s=>w.document.querySelector(s),click=s=>q(s).click();
 return{w,q,click,calls,original,finish:()=>resolve({member:calls.at(-1).input}),fail:()=>reject(Error('QA sem rede')),change:()=>{context={...context,businessId:'other'};w.dispatchEvent(new w.Event('business-context-changed'));},close:async()=>{await new Promise(setImmediate);w.close();}};
}
for(const width of [320,360,390,430,768,1440])test('real DOM '+width+'px: independent customer toggles, descriptions and protected save',async()=>{
 const h=setup(width);for(const key of ['customers.view','customers.create','customers.edit','customers.archive'])assert.ok(h.q('[data-tp-key="'+key+'"]'));
 assert.match(h.w.document.body.textContent,/Não permite editar clientes existentes/);assert.equal(h.q('[data-tp-save]').disabled,true);
 const create=h.q('[data-tp-key="customers.create"]');create.checked=true;create.dispatchEvent(new h.w.Event('change'));assert.equal(h.q('[data-tp-preset="custom"]').getAttribute('aria-pressed'),'true');
 h.click('[data-tp-save]');assert.match(h.q('#modal').textContent,/Cadastrar clientes/);assert.equal(h.calls.length,0);h.click('[data-tp-dialog-confirm]');h.click('[data-tp-save]');assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].input.permissions['customers.edit'],false);assert.equal(h.calls[0].input.permissionsVersion,2);assert.deepEqual(Array.from(h.calls[0].input.allowedSpaceIds),['qa-a']);
 h.finish();await new Promise(setImmediate);assert.match(h.w.document.body.textContent,/Permissões salvas/);assert.equal(h.q('[data-tp-save]').disabled,true);await h.close();
});
test('legacy preview preserves 3 already-authorized duties; opening/cancel never migrates a member',async()=>{
 const h=setup(390,{permissionsVersion:1,permissions:{'customers.view':true,'customers.edit':true}}),original=JSON.stringify(h.original);
 for(const key of ['customers.create','customers.edit','customers.archive'])assert.equal(h.q('[data-tp-key="'+key+'"]').checked,true);
 assert.match(h.w.document.body.textContent,/Nenhum funcionário foi alterado automaticamente/);h.click('[data-tp-back]');assert.equal(h.calls.length,0);assert.equal(JSON.stringify(h.original),original);await h.close();
});
test('revoke parent disables dependents, preserves spaces; network failure preserves draft without success',async()=>{
 const h=setup();const input=h.q('[data-tp-key="customers.create"]');input.checked=true;input.dispatchEvent(new h.w.Event('change'));
 h.click('[data-tp-save]');h.click('[data-tp-dialog-confirm]');h.fail();await new Promise(setImmediate);assert.match(h.w.document.body.textContent,/QA sem rede/);assert.equal(h.q('[data-tp-key="customers.create"]').checked,true);
 const view=h.q('[data-tp-key="customers.view"]');view.checked=false;view.dispatchEvent(new h.w.Event('change'));assert.equal(h.q('[data-tp-key="customers.create"]').checked,false);assert.equal(h.q('[data-tp-space="qa-a"]').checked,true);await h.close();
});
test('session switch during pending save cannot announce old success or alter next editor',async()=>{
 const h=setup();const input=h.q('[data-tp-key="customers.create"]');input.checked=true;input.dispatchEvent(new h.w.Event('change'));h.click('[data-tp-save]');h.click('[data-tp-dialog-confirm]');h.change();h.finish();await new Promise(setImmediate);assert.match(h.w.document.body.textContent,/sessão ou empresa mudou/);assert.doesNotMatch(h.w.document.body.textContent,/Permissões salvas/);await h.close();
});
test('compatible rollback pauses permission saves but keeps existing access and drafts intact',async()=>{
 const h=setup();h.w.AdiFestaBuild={permissionsV2EditingPaused:true};const input=h.q('[data-tp-key="customers.create"]');input.checked=true;input.dispatchEvent(new h.w.Event('change'));h.click('[data-tp-save]');assert.equal(h.calls.length,0);assert.match(h.w.document.body.textContent,/pausada para manutenção/);assert.equal(h.q('[data-tp-key="customers.create"]').checked,true);await h.close();
});
