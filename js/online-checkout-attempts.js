(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OnlineCheckoutAttempts=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function create(records,token){
    const scope=`public-catalog:${token}`,key=`${scope}:attempt`;
    const pending=async()=>(await records.read(key))?.payload||null;
    async function prepare(payload){return records.transaction('readwrite',(store,done)=>{const get=store.get(key);get.onsuccess=()=>{if(get.result){done(get.result.payload);return;}store.put({key,scope,type:'checkout-attempt',createdAt:new Date().toISOString(),payload});done(payload);};});}
    async function accept(payload,order){await records.transaction('readwrite',(store,done)=>{store.put({key:`${scope}:order:${order.id}`,scope,type:'order',id:order.id,accessToken:payload.orderAccessToken,data:order});const get=store.get(key);get.onsuccess=()=>{if(get.result?.payload?.id===order.id)store.delete(key);done(order);};});return order;}
    const list=async()=>(await records.list(scope)).filter(r=>r.type==='order');
    const reject=payload=>records.transaction('readwrite',(store,done)=>{const get=store.get(key);get.onsuccess=()=>{if(get.result?.payload?.id===payload.id)store.delete(key);done(true);};});
    // A failed submission is not proof that an earlier retry never committed.
    async function reconcileFailure(payload,lookup){try{const order=await lookup(payload);await accept(payload,order);return {status:'accepted',order};}catch(error){if(String(error.code||'').endsWith('not-found')){await reject(payload);return {status:'absent'};}return {status:'unknown'};}}
    async function verify(payload,lookup,submit){try{return await lookup(payload);}catch(error){if(!String(error.code||'').endsWith('not-found'))throw error;return submit(payload);}}
    return Object.freeze({pending,prepare,accept,list,reject,reconcileFailure,verify});
  }
  return Object.freeze({create});
});
