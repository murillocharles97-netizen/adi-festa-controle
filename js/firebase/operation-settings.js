import { db } from './firebase-config.js';
import { doc,getDoc,setDoc,serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let loadedFor='',saving=false,pending=null;
const CACHE_VERSION=2,CACHE_TTL=6*60*60*1000,cacheKey=businessId=>`adiFesta:operation:${businessId}:v${CACHE_VERSION}`;
function readCache(businessId){try{const cached=JSON.parse(localStorage.getItem(cacheKey(businessId))||'null');return cached&&Date.now()-Number(cached.cachedAt||0)<CACHE_TTL?cached.operation:null}catch{return null}}
function writeCache(businessId,operation){try{localStorage.setItem(cacheKey(businessId),JSON.stringify({cachedAt:Date.now(),operation}))}catch{}}
const context=()=>({businessId:String(window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.profile?.businessId||''),uid:window.FirebaseSession?.user?.uid||''});
async function load(){
  const {businessId}=context();
  if(!businessId||loadedFor===businessId||!window.OperationMode)return;
  loadedFor=businessId;
  const cached=readCache(businessId);if(cached){window.OperationMode.applyRemote(cached);dispatchEvent(new CustomEvent('operation-settings-loaded',{detail:{businessId,operation:window.OperationMode.get(),source:'cache'}}));return}
  try{
    const snap=await getDoc(doc(db,'businesses',businessId,'settings','operation'));
    if(snap.exists()){
      const remote=snap.data(),local=window.OperationMode.get(),remoteTime=remote.updatedAt?.toDate?.()?.toISOString?.()||String(remote.updatedAt||'');
      if(local.updatedAt&&remoteTime&&local.updatedAt>remoteTime)await persist({detail:{operation:local,reason:'retry'}});
      else window.OperationMode.applyRemote(remote);
      writeCache(businessId,window.OperationMode.get());
    }else await persist({detail:{operation:window.OperationMode.ensure(),reason:'migration'}});
  }catch(error){console.warn('[Operation Settings] cache local mantido',error?.code||error?.message)}
  finally{dispatchEvent(new CustomEvent('operation-settings-loaded',{detail:{businessId,operation:window.OperationMode.get()}}))}
}
async function persist(event){
  if(saving||event.detail?.reason==='cloud')return;
  const {businessId,uid}=context();if(!businessId||!uid)return;saving=true;
  try{await setDoc(doc(db,'businesses',businessId,'settings','operation'),{...event.detail.operation,id:'operation',businessId,ownerId:uid,updatedAt:serverTimestamp()},{merge:true});writeCache(businessId,event.detail.operation)}
  catch(error){pending=event;console.warn('[Operation Settings] pendente de sincronização',error?.code||error?.message)}
  finally{saving=false}
}
addEventListener('firebase-auth-ready',load);
addEventListener('operation-settings-changed',persist);
addEventListener('online',()=>{if(pending){const event=pending;pending=null;persist(event)}});
addEventListener('firebase-session-cleared',()=>{loadedFor='';pending=null});
if(window.FirebaseSession?.user)load();
