'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/auth.js','utf8');
function element(tagName='BUTTON'){
  return {tagName,className:'avatar',textContent:'V',dataset:{},attributes:{},listeners:[],
    setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,handler){this.listeners.push({name,handler});},
    click(){for(const listener of this.listeners)if(listener.name==='click')listener.handler();}
  };
}
function harness({uid='seller',tagName='BUTTON',visible=true}={}){
  let avatar=visible?element(tagName):null,exits=0;
  if(avatar)avatar.replaceWith=replacement=>{avatar=replacement;};
  const s={auth:{currentUser:{uid}},window:{FirebaseSession:{user:{uid},member:{role:'seller',permissions:{'settings.manage':false,'financial.view':false}}}},
    document:{querySelector:()=>avatar,createElement:()=>element()},logout:()=>{exits++;return Promise.resolve();}};
  vm.createContext(s);vm.runInContext(source.slice(source.indexOf('function bindAccountExit('),source.indexOf('function showFirstBusinessOnboarding(')),s);
  return {s,get avatar(){return avatar;},get exits(){return exits;}};
}
test('account exit is a native, labelled header button, outside the Settings route',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/<button type="button" class="avatar" aria-label="Sair ou trocar de conta"/);
  assert.match(source,/bindAccountExit\(user\);/);
  assert.match(fs.readFileSync('css/firebase.css','utf8'),/button\.avatar:focus-visible/);
});
test('seller and cashier can request sign-out without Settings or financial permissions; owner uses the same exit',()=>{
  for(const role of ['seller','cashier','owner']){
    const h=harness({uid:role});h.s.window.FirebaseSession.member.role=role;
    h.s.bindAccountExit({uid:role});h.avatar.click();
    assert.equal(h.exits,1);assert.equal(h.avatar.type,'button');
    assert.equal(h.avatar.attributes['aria-label'],'Sair ou trocar de conta');
    assert.equal(h.s.window.FirebaseSession.member.permissions['financial.view'],false);
    assert.equal(h.s.window.FirebaseSession.member.permissions['settings.manage'],false);
  }
});
test('repeated bootstrap binding never duplicates the click callback',()=>{
  const h=harness();h.s.bindAccountExit({uid:'seller'});h.s.bindAccountExit({uid:'seller'});
  assert.equal(h.avatar.listeners.length,1);h.avatar.click();assert.equal(h.exits,1);
});
test('stale avatar cannot sign out a different Auth or runtime identity during account switch',()=>{
  const h=harness();h.s.bindAccountExit({uid:'seller'});
  h.s.auth.currentUser={uid:'owner'};h.avatar.click();assert.equal(h.exits,0);
  h.s.window.FirebaseSession={user:{uid:'owner'}};h.avatar.click();assert.equal(h.exits,0);
  h.s.bindAccountExit({uid:'owner'});h.avatar.click();assert.equal(h.exits,1);
  assert.equal(h.avatar.listeners.length,1);
  h.s.window.FirebaseSession=null;h.avatar.click();assert.equal(h.exits,1);
  h.s.auth.currentUser=null;h.avatar.click();assert.equal(h.exits,1);
});
test('older cached shell avatar is upgraded to an accessible button without losing its initial',()=>{
  const h=harness({tagName:'SPAN'});h.s.bindAccountExit({uid:'seller'});
  assert.equal(h.avatar.tagName,'BUTTON');assert.equal(h.avatar.className,'avatar');
  assert.equal(h.avatar.textContent,'V');h.avatar.click();assert.equal(h.exits,1);
});
test('binding before the header exists is harmless and creates no session or data',()=>{
  const h=harness({visible:false});h.s.bindAccountExit({uid:'seller'});assert.equal(h.exits,0);
});
test('avatar reuses confirmation: opening or cancelling never signs out or touches a queue',async()=>{
  const cancel=[{},{}],confirmButton={},root={innerHTML:'',querySelectorAll:()=>cancel,querySelector:()=>confirmButton};
  let exits=0;
  const s={window:{SyncFirebase:{getFirebaseDiagnostic:()=>({pendingOperations:1})}},document:{querySelector:()=>root},bootstrapLogout:()=>{exits++;},googleAuth:{},mountGoogleAccount:()=>{},Promise};
  vm.createContext(s);vm.runInContext(source.slice(source.indexOf('function logoutConfirmation('),source.indexOf('async function bootstrapCore(')),s);
  await s.logout();assert.equal(exits,0);assert.match(root.innerHTML,/continuarão salvas na fila/);
  cancel[0].onclick();assert.equal(root.innerHTML,'');assert.equal(exits,0);
  await s.logout();const button={disabled:false,textContent:'Sair'};await confirmButton.onclick({currentTarget:button});
  assert.equal(exits,1);assert.equal(button.disabled,true);
});
test('binding and confirmation contain no commercial capture, retry, cache removal or permission mutation',()=>{
  const binding=source.slice(source.indexOf('function bindAccountExit('),source.indexOf('function showFirstBusinessOnboarding('));
  assert.doesNotMatch(binding,/DB\.|localStorage|sessionStorage|processSyncQueue|retry|permissions\s*=/);
  const confirmation=source.slice(source.indexOf('function logoutConfirmation('),source.indexOf('async function bootstrapCore('));
  assert.doesNotMatch(confirmation,/removeItem|clear\(|processSyncQueue|retry|DB\./);
});
