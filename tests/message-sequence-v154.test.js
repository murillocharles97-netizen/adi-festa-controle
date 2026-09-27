const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('js/firebase/sync.js','utf8');
const publish=source.slice(source.indexOf('async function publishConfirmedMessage('),source.indexOf('async function queryClientsPage('));
function harness() {
  const records=new Map([['businesses/business/clients/client',{id:'client',businessId:'business',saldo:-550,financialVersion:7,lastChargeAt:'2026-09-28T12:00:00Z'}]]),writes=[];
  let businessId='business',actor='owner',permitted=true;
  const context={Error,Date,Number,currentUser:{uid:'owner'},activeBusinessId:()=>businessId,
    validateUser:async()=>({user:{uid:actor}}),window:{Mensagens:{canSend:()=>permitted}},db:{},
    doc:(_db,...path)=>path.join('/'),sanitizeForFirestore:x=>x,normalizeFirestoreData:x=>x,safePublishSyncSignal:async()=>true,
    runTransaction:async(_db,fn)=>{const staged=[];await fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,value)=>staged.push([ref,value]),update:(ref,value)=>staged.push([ref,{...records.get(ref),...value}])});for(const [ref,value]of staged){records.set(ref,value);writes.push({ref,value})}}
  };
  vm.runInNewContext(publish+';this.publish=publishConfirmedMessage',context);
  const event={id:'operation',operationId:'operation',sequenceId:'sequence',businessId:'business',actorUid:'owner',customerId:'client',clientId:'client',clientName:'Teste',type:'charge',status:'sent_confirmed',confirmedByUser:true,sentAt:'2026-09-26T12:00:00Z',finalMessage:'Olá',amountAtSend:550};
  return {context,event,records,writes,setBusiness:value=>businessId=value,setActor:value=>actor=value,deny:()=>permitted=false};
}
test('confirmed outbox replay is idempotent and never writes financial values',async()=>{
  const h=harness();await h.context.publish(h.event);await h.context.publish(h.event);
  assert.equal(h.writes.length,2);assert.equal(h.records.size,3);
  const client=h.records.get('businesses/business/clients/client');assert.equal(client.saldo,-550);assert.equal(client.financialVersion,7);
  assert.equal(client.lastChargeAt,'2026-09-28T12:00:00Z','delayed event cannot roll lastChargeAt backwards');
});
test('only explicit confirmation from the authorized business/actor can be published',async()=>{
  for(const patch of [{confirmedByUser:false},{status:'opened_whatsapp'},{businessId:'foreign'},{actorUid:'foreign'}]){
    const h=harness();await assert.rejects(h.context.publish({...h.event,...patch}));assert.equal(h.writes.length,0);
  }
  const h=harness();h.deny();await assert.rejects(h.context.publish(h.event));assert.equal(h.writes.length,0);
});
test('campaign/notice confirmation writes no customer or charge',async()=>{
  for(const type of ['campaign','notice','custom']){const h=harness();await h.context.publish({...h.event,type});assert.equal(h.writes.length,1);assert.match(h.writes[0].ref,/messageHistory/)}
});
test('legacy confirmation updates the original event and charge instead of duplicating them',async()=>{
  const h=harness(),event={...h.event,id:'legacy-event',legacyEventId:'legacy-event',legacyChargeId:'legacy-charge'};
  h.records.set('businesses/business/messageHistory/legacy-event',{...event,status:'opened_whatsapp'});
  h.records.set('businesses/business/charges/legacy-charge',{id:'legacy-charge',messageId:'legacy-event'});
  await h.context.publish(event);await h.context.publish(event);
  assert.equal(h.records.size,3);assert.equal(h.writes.length,2);
  assert.equal(h.records.get('businesses/business/messageHistory/legacy-event').status,'sent_confirmed');
});
test('sequence UI uses durable store, explicit confirmation and coalesced lifecycle events',()=>{
  const engine=fs.readFileSync('js/message-sequence.js','utf8'),ui=fs.readFileSync('js/message-sequence-ui.js','utf8');
  assert.doesNotMatch(engine,/DB\.alterar|localStorage\.setItem|sessionStorage\.setItem/);
  assert.match(engine,/AWAITING_CONFIRMATION/);assert.match(engine,/currentIndex !== expected.currentIndex/);assert.match(engine,/syncedAt/);
  assert.match(ui,/persistProjection: false, force/);assert.match(ui,/await engine\(\)\.prepare/);
  for(const event of ['visibilitychange','pageshow','focus'])assert.ok(ui.includes(event));
  assert.match(ui,/Sim, enviado/);assert.match(engine,/confirmedByUser: true/);
});
