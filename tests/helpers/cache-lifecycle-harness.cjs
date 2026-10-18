'use strict';
const fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const copy=v=>v===undefined?undefined:structuredClone(v);
function harness(){
 const rows=new Map(),locks=new Map(),channels=[],events=[],storage=new Map();let tail=Promise.resolve(),failWrites=false;
 const transaction=(mode,action)=>{
  const task=tail.then(()=>new Promise((resolve,reject)=>{
   if(mode==='readwrite'&&failWrites)return reject(new DOMException('synthetic quota','QuotaExceededError'));
   const draft=new Map([...rows].map(([k,v])=>[k,copy(v)]));let pending=0,failed=false,result;
   const fail=e=>{failed=true;reject(e);},check=()=>queueMicrotask(()=>{if(!failed&&!pending){if(mode==='readwrite'){rows.clear();draft.forEach((v,k)=>rows.set(k,v));}resolve(result);}});
   const request=fn=>{const r={};pending++;queueMicrotask(()=>{if(failed)return;try{r.result=copy(fn());pending--;r.onsuccess?.();check();}catch(e){fail(e);}});return r;};
   const store={get:k=>request(()=>draft.get(k)),put:r=>draft.set(r.key,copy(r)),add:r=>{if(draft.has(r.key))throw Error('immutable collision');draft.set(r.key,copy(r));},delete:k=>draft.delete(k)};
   try{action(store,v=>{result=v;},fail);check();}catch(e){fail(e);}
  }));tail=task.catch(()=>{});return task;
 };
 function runtime({locking=true,broadcast=false}={}){
  const tasks=[],listeners=new Map(),s={console:{error(){},warn(){}},crypto:webcrypto,structuredClone,Blob,Date,Map,Set,JSON,Object,Array,String,Number,Error,Promise,DOMException,TextEncoder,
   navigator:{locks:locking?{request(name,options,callback){if(locks.has(name))return Promise.resolve(callback(null));locks.set(name,true);return Promise.resolve(callback({name})).finally(()=>locks.delete(name));}}:undefined},
   localStorage:{get length(){return storage.size;},key:n=>[...storage.keys()][n],getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
   queueMicrotask:f=>tasks.push(f),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
   addEventListener:(k,f)=>listeners.set(k,[...(listeners.get(k)||[]),f]),dispatchEvent:e=>{events.push(e);for(const f of listeners.get(e.type)||[])f(e);},Utils:{toast(){}},
   DB:{localRecords:{transaction,read:k=>transaction('readonly',(st,done)=>{const r=st.get(k);r.onsuccess=()=>done(r.result||null);}),list:scope=>tail.then(()=>[...rows.values()].filter(r=>r.scope===scope).map(copy))}}};s.window=s;
  if(broadcast)s.BroadcastChannel=class{constructor(){channels.push(this);}postMessage(data){for(const ch of channels)if(ch!==this)queueMicrotask(()=>ch.onmessage?.({data:copy(data)}));}};
  vm.createContext(s);vm.runInContext(fs.readFileSync('js/business-cache.js','utf8'),s);
  const empty=()=>({config:{},vendas:[],movimentacoesEstoque:[]}),key=uid=>`adiFestaDB_v1:qa-business:${uid}:permissions`,queue=uid=>`adiFesta:qa-business:${uid}:permissions:syncQueue`;
  return{s,cache:s.DB.businessCache,key,queue,open:uid=>s.DB.businessCache.open(key(uid),[],empty),drain:async()=>{while(tasks.length)tasks.shift()();await tail;},emit:(k,e)=>listeners.get(k)?.forEach(f=>f(e))};
 }
 return{rows,runtime,events,locks,settle:async()=>{await tail;await Promise.resolve();},failWrites:v=>failWrites=v};
}
module.exports={harness};
