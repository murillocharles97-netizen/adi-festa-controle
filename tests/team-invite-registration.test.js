const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/auth.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function runtime(){
  const nodes=new Map(),calls={create:0,accept:0,reload:0},events=[];let resolve;
  const c={INVITE_TOKEN:'synthetic-invitation-token-not-a-production-secret',pendingInviteToken:'synthetic-invitation-token-not-a-production-secret',inviteRegistrationInFlight:false,
    loadInvitePreview:async()=>({email:'seller@example.test',name:'QA Seller',businessName:'QA',role:'seller'}),screen(){},brandMarkup:()=>'',esc:x=>String(x),
    document:{querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},
    FormData:class{constructor(){return new Map([['password','synthetic-test-only'],['confirm','synthetic-test-only']]);}},
    auth:{currentUser:null},createUserWithEmailAndPassword:()=>{calls.create++;return new Promise(r=>resolve=r);},setButtonLoading(){},login(){},friendly:x=>x,
    location:{href:'https://example.test/?teamInvite=synthetic-token#/inicio',reload(){calls.reload++;}},history:{replaceState(...args){events.push(args);}},URL,
    setBootstrapState(){},bootstrapLog(){},bootstrapLogout(){},assertCurrentRun(){},console:{warn(){}},normalizedCode:e=>e.code,
  };c.window=c;c.FirebaseCallable=async()=>{calls.accept++;return {data:{}};};
  vm.createContext(c);vm.runInContext(section('function clearInviteToken(','function collectRegister('),c);
  vm.runInContext(section('async function bootstrapCore(','  const profileRef=')+'\n}',c);
  return{c,calls,events,async form(){await c.inviteRegister();return nodes.get('#invite-register-form').onsubmit;},release(){resolve({user:{uid:'qa-seller'}});}};
}
test('registration creates Auth only; canonical bootstrap owns acceptance and navigation',async()=>{
  const h=runtime(),submit=await h.form(),pending=submit({preventDefault(){},currentTarget:{}});h.release();await pending;
  assert.equal(h.calls.create,1);assert.equal(h.calls.accept,0);assert.equal(h.calls.reload,0);
  await h.c.bootstrapCore({uid:'qa-seller'},{});assert.equal(h.calls.accept,1);
});
test('double submit cannot create two Auth operations',async()=>{
  const h=runtime(),submit=await h.form(),one=submit({preventDefault(){},currentTarget:{}}),two=submit({preventDefault(){},currentTarget:{}});
  assert.equal(h.calls.create,1);h.release();await Promise.all([one,two]);
});
test('accepted invite is cleared in memory and URL; later rebootstrap does not redeem it again',async()=>{
  const h=runtime();await h.c.bootstrapCore({uid:'qa-seller'},{});await h.c.bootstrapCore({uid:'qa-seller'},{});
  assert.equal(h.calls.accept,1);assert.equal(h.c.pendingInviteToken,'');assert.equal(h.events[0][2],'/#/inicio');
});
test('failed Auth creation releases the local guard and does not accept or log credentials',async()=>{
  const h=runtime();h.c.createUserWithEmailAndPassword=async()=>{throw Object.assign(Error('offline'),{code:'auth/network-request-failed'});};
  const submit=await h.form();await submit({preventDefault(){},currentTarget:{}});
  assert.equal(h.c.inviteRegistrationInFlight,false);assert.equal(h.calls.accept,0);
});
