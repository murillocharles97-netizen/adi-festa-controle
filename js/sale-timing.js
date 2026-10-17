'use strict';
export function createSaleTiming({isAuthorized=()=>false,onChange=()=>{}}={}) {
  // Temporary opt-in, memory-only instrumentation. No payloads, IDs, storage or I/O.
  const kinds = new Set(['local','persistence','firestore','queue_wait','control','ui']);
  const stages = new Set(('click local.validation local.stock_check local.sale_create local.customer_projection local.sale_confirmation ui.processing ui.processing_exit ui.submission ui.final ui.receipt customer.prepare customer.read_before customer.read_previous_sale customer.previous_confirmation customer.apply_before queue.drain queue.wait_existing queue.session_validation queue.dependency transaction.commit transaction.dependency transaction.attempt transaction.read_idempotency transaction.read_resolution transaction.read_client transaction.read_stock transaction.read_variant transaction.read_sale transaction.read_stock_movement transaction.read_document transaction.read_campaign transaction.read_financial_effect transaction.read_conflict transaction.stage_sale transaction.stage_client transaction.stage_financial_effect transaction.committed sale.verify sale.verify_read effect.verify_read sale.reread client.reread sale.apply_confirmed client.apply_confirmed local.flush').split(' '));
  let enabled=false,active=null,sequence=0,consumed=false;
  const traces=[],live=new WeakMap(),clock=()=>performance.now(),round=n=>Math.round(n*1000)/1000;
  const safe=fn=>(...args)=>{try{return fn(...args)}catch{return null}};
  const notify=safe(onChange);
  const current=()=>enabled&&active&&live.get(active)?.open?active:null;
  function start(stage,kind,token=current()) {
    const trace=token&&live.get(token);
    if(!enabled||!trace?.open||!stages.has(stage)||!kinds.has(kind))return null;
    if(trace.rows.length>=400){trace.truncated=true;return null;}
    const span={stage,kind,start:clock(),end:null,outcome:'running'};
    trace.rows.push(span);return {trace,span};
  }
  const end=safe((handle,ok=true)=>{if(handle&&handle.span.end===null){handle.span.end=clock();handle.span.outcome=ok?'ok':'error';}});
  const mark=safe((stage,kind='control',token=current())=>{const h=start(stage,kind,token);end(h);});
  function finish(outcome='ok',token=current()) {
    const trace=token&&live.get(token);if(!trace?.open)return;
    const at=clock();trace.end=at;trace.open=false;trace.outcome=['ok','error','aborted','interrupted'].includes(outcome)?outcome:'error';
    for(const row of trace.rows)if(row.end===null){row.end=at;row.outcome='interrupted';}
    trace.target=null;if(active===token)active=null;
    enabled=false;notify(); // One checkout attempt only; never re-arm on retry.
  }
  function begin(){
    if(!enabled||consumed||!isAuthorized())return null;
    consumed=true;
    const token={},trace={id:'trace-'+(++sequence),at:new Date().toISOString(),start:clock(),end:null,open:true,outcome:'running',rows:[],target:null,truncated:false,processingAt:null,processingMs:null};
    active=token;live.set(token,trace);traces.push(trace);if(traces.length>10)traces.shift();
    mark('click','control',token);trace.validation=start('local.validation','local',token);return token;
  }
  const validated=safe(token=>end(live.get(token)?.validation));
  const bind=safe((operationId,token=current())=>{const t=token&&live.get(token);if(t?.open)t.target=operationId;});
  const isTarget=safe((operationId,token=current())=>Boolean(token&&live.get(token)?.target===operationId));
  function observe(stage,kind,promise,token=current()) {
    const h=start(stage,kind,token);if(h){if(promise&&typeof promise.then==='function')promise.then(()=>end(h),()=>end(h,false));else end(h);}
    return promise; // The original promise and rejection are never replaced.
  }
  function measureSync(stage,kind,fn,token=current()){
    const h=safe(start)(stage,kind,token);let ok=false;try{const result=fn();ok=true;return result}finally{end(h,ok)}
  }
  const state=safe(value=>{
    const token=current(),t=token&&live.get(token);if(!t)return;
    if(value==='processing'&&t.processingAt===null){t.processingAt=clock();mark('ui.processing','ui',token);}
    if(['success','error','conflict'].includes(value)){
      if(t.processingAt!==null&&t.processingMs===null){t.exitAt=clock();t.processingMs=t.exitAt-t.processingAt;}
      mark('ui.processing_exit','ui',token);if(value!=='success')finish('error',token);
    }
  });
  function report(){return {schemaVersion:1,enabled,limits:{traces:1,spansPerTrace:400},notes:['firestore includes SDK, network and server time; not pure wire latency','nested/inclusive spans must not be added; exclusive totals use a priority partition','persistence includes local CPU and IndexedDB wait','no customer, amount, business, operation or document identifiers are exported'],traces:traces.map(t=>{
    const until=t.end??clock(),rows=t.rows.map(r=>({stage:r.stage,kind:r.kind,startedAt:new Date(Date.parse(t.at)+r.start-t.start).toISOString(),startMs:round(r.start-t.start),durationMs:round((r.end??until)-r.start),outcome:r.outcome}));
    const edges=[...new Set([0,until-t.start,...rows.flatMap(r=>[r.startMs,r.startMs+r.durationMs])])].sort((a,b)=>a-b),exclusiveMs={firestore:0,queue_wait:0,persistence:0,ui:0,local:0,unattributed:0};
    for(let n=1;n<edges.length;n++){const a=edges[n-1],b=edges[n],mid=(a+b)/2,k=['firestore','queue_wait','persistence','ui','local'].find(kind=>rows.some(r=>r.kind===kind&&r.startMs<=mid&&r.startMs+r.durationMs>=mid))||'unattributed';exclusiveMs[k]+=b-a;}
    return {traceId:t.id,startedAt:t.at,outcome:t.outcome,truncated:t.truncated,totalMs:round(until-t.start),clickToProcessingExitMs:t.exitAt===undefined?null:round(t.exitAt-t.start),processingMs:t.processingMs===null?null:round(t.processingMs),exclusiveMs:Object.fromEntries(Object.entries(exclusiveMs).map(([k,v])=>[k,round(v)])),rows};
  })};}
  const download=safe(()=>{if(!isAuthorized())return false;const url=URL.createObjectURL(new Blob([JSON.stringify(report(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='veconi-fiado-timing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;});
  const clear=safe(()=>{finish('interrupted');enabled=false;active=null;traces.length=0;notify();});
  return Object.freeze({enable:safe(()=>{if(!isAuthorized()||consumed)return {enabled:false};enabled=true;notify();return {enabled:true,memoryOnly:true}}),disable:safe(()=>{finish('interrupted');enabled=false;notify();return {enabled:false}}),clear,begin:safe(begin),current:safe(current),validated,bind,isTarget,start:safe(start),end,mark,state,finish:safe(finish),observe:safe(observe),measureSync,report:safe(report),download});
}
