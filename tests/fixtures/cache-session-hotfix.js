/* Local fixture only: independent browsing contexts, actual IDB/Web Locks. No Firebase SDK. */
(async()=>{
 'use strict';const params=new URLSearchParams(location.search),worker=params.has('worker'),business='qa-local-cache',key=uid=>`adiFestaDB_v1:${business}:${uid}:qa`,queue=uid=>`adiFesta:${business}:${uid}:qa:syncQueue`;
 const sample={queueId:'qa-original-queue',operationId:'qa-original-operation',status:'pending',businessId:business,userId:'owner',payload:{writes:[{entityType:'sales',entityId:'qa-original-sale',operation:'create',data:{valorFinal:25}}]}};
 if(params.has('manual')){
  document.querySelector('#run').hidden=true;document.querySelector('#manual').hidden=false;let uid='';
  const display=async(action,task)=>{try{const result=await task();document.querySelector('#result').textContent=JSON.stringify({status:'PASS',action,uid,result},null,2);}catch(e){document.querySelector('#result').textContent=JSON.stringify({status:'BLOCKED',action,code:e.code,message:e.message},null,2);}};
  document.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>display('open',async()=>{await DB.useBusiness(business,{uid:button.dataset.open,permissionSignature:'qa'});uid=button.dataset.open;return{principal:DB.getPrincipal(),ready:DB.businessCache.ready()};}));
  document.querySelector('#save-qa').onclick=()=>display('preserve QA queue',async()=>{DB.businessCache.keyValue.setItem(queue(uid),JSON.stringify([{...sample,userId:uid}]));await DB.flush();return{operationId:sample.operationId,pending:1,commercialOperations:0};});
  document.querySelector('#release-qa').onclick=()=>display('release',async()=>{await DB.releaseBusiness();return{ready:DB.businessCache.ready()};});
  document.querySelector('#read-qa').onclick=()=>display('read',async()=>({principal:DB.getPrincipal(),ready:DB.businessCache.ready(),queue:DB.businessCache.keyValue.getItem(queue(uid))}));return;
 }
 if(worker){document.body.hidden=true;addEventListener('message',async({data,source,origin})=>{if(origin!==location.origin||!data?.qaRequest)return;
  try{let result;switch(data.command){
   case'open':result=await DB.useBusiness(business,{uid:data.uid,permissionSignature:'qa'});break;
   case'write':DB.alterar(d=>{d.config.qaWriter=data.value;});await DB.flush();result=true;break;
   case'queue':DB.businessCache.keyValue.setItem(queue(data.uid),JSON.stringify([sample]));await DB.flush();result=true;break;
   case'snapshot':result={writer:DB.carregar().config.qaWriter,queue:DB.businessCache.keyValue.getItem(queue(data.uid)),principal:DB.getPrincipal()};break;
   case'release':await DB.releaseBusiness();result=true;break;
   case'stale':try{DB.businessCache.stage(DB.carregar(),key(data.uid));result='UNEXPECTED';}catch(e){result=e.code;}break;
   case'rows':result=await DB.localRecords.list('business-cache:v156:'+key(data.uid));break;
   case'preserved':result=await DB.localRecords.transaction('readonly',(store,done)=>{const request=store.index('scope').getAll(IDBKeyRange.bound('business-cache:v156:'+key(data.uid)+':preserved:','business-cache:v156:'+key(data.uid)+':preserved:\uffff'));request.onsuccess=()=>done(request.result);});break;
   default:throw Error('Unknown fixture command');
  }source.postMessage({qaResponse:data.qaRequest,result},origin);
  }catch(e){source.postMessage({qaResponse:data.qaRequest,error:{code:e.code,message:e.message}},origin);}
 });parent.postMessage({qaReady:params.get('worker')},location.origin);return;}
 const out=document.querySelector('#result'),pending=new Map(),ready=new Map();let seq=0;
 addEventListener('message',({data,origin})=>{if(origin!==location.origin)return;if(data?.qaReady)ready.get(data.qaReady)?.();if(data?.qaResponse){const p=pending.get(data.qaResponse);if(!p)return;clearTimeout(p.timer);pending.delete(data.qaResponse);data.error?p.reject(Object.assign(Error(data.error.message),{code:data.error.code})):p.resolve(data.result);}});
 async function frame(id,legacy=false){const f=document.createElement('iframe');const loaded=new Promise(resolve=>ready.set(id,resolve));f.src=`./cache-session-hotfix.html?worker=${id}${legacy?'&legacy=1':''}`;document.body.append(f);await loaded;return f;}
 function rpc(f,command,args={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture request timeout '+command));},10000);pending.set(id,{resolve,reject,timer});f.contentWindow.postMessage({qaRequest:id,command,...args},location.origin);});}
 const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Mismatch '+JSON.stringify([a,b]));},expect=async(fn,code)=>{try{await fn();throw Error('Expected '+code);}catch(e){equal(e.code,code);}};
 document.querySelector('#run').onclick=async event=>{const button=event.currentTarget;button.disabled=true;const results=[],frames=[];let a,b;try{
  a=await frame('a');b=await frame('b');frames.push(a,b);await rpc(a,'open',{uid:'owner'});await rpc(a,'write',{value:'owner-v1'});await rpc(a,'queue',{uid:'owner'});
  await expect(()=>rpc(b,'open',{uid:'owner'}),'local-cache-in-use');results.push('PASS: duas abas/contextos, apenas um escritor por namespace');
  await rpc(a,'release');await rpc(b,'open',{uid:'owner'});let s=await rpc(b,'snapshot',{uid:'owner'});equal(s.writer,'owner-v1');equal(JSON.parse(s.queue),[sample]);results.push('PASS: liberação e nova abertura preservam fila original/IDs');
  await rpc(a,'open',{uid:'seller'});await rpc(a,'write',{value:'seller-v1'});equal((await rpc(b,'snapshot',{uid:'owner'})).writer,'owner-v1');results.push('PASS: usuários diferentes, caches e locks separados');
  await rpc(b,'release');await rpc(a,'release');await rpc(a,'open',{uid:'owner'});equal((await rpc(a,'snapshot',{uid:'owner'})).writer,'owner-v1');equal(await rpc(a,'stale',{uid:'seller'}),'local-cache-scope-changed');results.push('PASS: owner → seller → owner; callback de namespace antigo rejeitado');
  await rpc(a,'release');a.remove();b.remove();a=await frame('legacy-a',true);b=await frame('legacy-b',true);frames.push(a,b);await rpc(a,'open',{uid:'legacy'});await rpc(b,'open',{uid:'legacy'});
  await rpc(a,'write',{value:'durable-new'});await expect(()=>rpc(b,'write',{value:'stale-pending'}),'local-cache-conflict');equal((await rpc(a,'snapshot',{uid:'legacy'})).writer,'durable-new');results.push('PASS: CAS legítimo continua bloqueando sobrescrita sem Web Locks');
  await rpc(b,'release');const preserved=await rpc(b,'preserved',{uid:'legacy'});if(!preserved.some(r=>r.reason==='local-cache-conflict')||!preserved.some(r=>r.field==='config'&&r.value?.qaWriter==='stale-pending'))throw Error('Missing preserved delta');results.push('PASS: delta conflitante preservado em IDB, sem efeitos comerciais');
  await rpc(a,'release');a.remove();a=await frame('reload-a');frames.push(a);await rpc(a,'open',{uid:'owner'});s=await rpc(a,'snapshot',{uid:'owner'});equal(JSON.parse(s.queue),[sample]);results.push('PASS: reload em contexto novo mantém operação original intacta');
  out.textContent=JSON.stringify({status:'PASS',cases:results,productionRequests:0,commercialOperations:0,webLocks:typeof navigator.locks?.request==='function',indexedDB:'real browser'},null,2);
 }catch(e){out.textContent=JSON.stringify({status:'FAIL',cases:results,code:e.code,error:e.message},null,2);}finally{for(const f of frames){try{if(f.isConnected)await rpc(f,'release');}catch{}f.remove();}button.disabled=false;}};
})();
