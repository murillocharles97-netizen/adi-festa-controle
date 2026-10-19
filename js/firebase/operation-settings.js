import { db } from './firebase-config.js';
import { doc,getDoc,setDoc,serverTimestamp } from './workspace-firestore.js';

let loadedFor='',saving=null,pending=null,epoch=0;
const CACHE_VERSION=3,CACHE_TTL=6*60*60*1000,cacheKey=scope=>`adiFesta:operation:${scope.key}:v${CACHE_VERSION}`;
function readCache(scope){try{const cached=JSON.parse(localStorage.getItem(cacheKey(scope))||'null');return cached&&Date.now()-Number(cached.cachedAt||0)<CACHE_TTL?cached.operation:null}catch{return null}}
function writeCache(scope,operation){try{localStorage.setItem(cacheKey(scope),JSON.stringify({cachedAt:Date.now(),operation}))}catch{}}
const context=()=>{const businessId=String(window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.profile?.businessId||''),uid=window.FirebaseSession?.user?.uid||'',principal=window.DB?.getPrincipal?.()||uid,generation=window.DB?.getWorkspaceGeneration?.()||0;return{businessId,uid,key:JSON.stringify([businessId,uid,principal,generation])}};
const current=scope=>scope.epoch===epoch&&scope.key===context().key;
const canConfigure=()=>window.BusinessContext?.hasPermission?.('settings.manage')===true;
async function load(){
  const scope={...context(),epoch}, {businessId,uid}=scope;
  if(!businessId||!uid||loadedFor===scope.key||!window.OperationMode)return;
  loadedFor=scope.key;
  const cached=readCache(scope);if(cached&&current(scope)){window.OperationMode.applyRemote(cached);dispatchEvent(new CustomEvent('operation-settings-loaded',{detail:{businessId,operation:window.OperationMode.get(),source:'cache'}}));return}
  try{
    const snap=await getDoc(doc(db,'businesses',businessId,'settings','operation'));
    if(!current(scope))return;
    if(snap.exists()){
      window.OperationMode.applyRemote(snap.data());
      writeCache(scope,window.OperationMode.get());
    }else window.OperationMode.applyRemote(window.OperationMode.get());
  }catch(error){console.warn('[Operation Settings] cache local mantido',error?.code||error?.message)}
  finally{if(current(scope))dispatchEvent(new CustomEvent('operation-settings-loaded',{detail:{businessId,operation:window.OperationMode.get()}}))}
}
async function persist(event,scope={...context(),epoch}){
  if(saving||event.detail?.reason!=='user'||!current(scope)||!canConfigure())return;
  const {businessId,uid}=scope;if(!businessId||!uid)return;saving=scope;
  try{await setDoc(doc(db,'businesses',businessId,'settings','operation'),{...event.detail.operation,id:'operation',businessId,ownerId:uid,updatedAt:serverTimestamp()},{merge:true});if(current(scope))writeCache(scope,event.detail.operation)}
  catch(error){if(current(scope))pending={event,scope};console.warn('[Operation Settings] pendente de sincronização',error?.code||error?.message)}
  finally{if(saving===scope)saving=null}
}
addEventListener('firebase-auth-ready',load);
addEventListener('operation-settings-changed',persist);
addEventListener('online',()=>{if(pending){const {event,scope}=pending;pending=null;persist(event,scope)}});
addEventListener('firebase-session-cleared',()=>{epoch++;loadedFor='';pending=null;saving=null});
if(window.FirebaseSession?.user)load();
