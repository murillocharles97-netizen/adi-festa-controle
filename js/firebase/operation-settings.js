import { db } from './firebase-config.js';
import { doc,getDoc,setDoc,serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let loadedFor='',saving=false,pending=null;
const context=()=>({businessId:String(window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.profile?.businessId||''),uid:window.FirebaseSession?.user?.uid||''});
async function load(){
  const {businessId}=context();
  if(!businessId||loadedFor===businessId||!window.OperationMode)return;
  loadedFor=businessId;
  try{
    const snap=await getDoc(doc(db,'businesses',businessId,'settings','operation'));
    if(snap.exists()){
      const remote=snap.data(),local=window.OperationMode.get(),remoteTime=remote.updatedAt?.toDate?.()?.toISOString?.()||String(remote.updatedAt||'');
      if(local.updatedAt&&remoteTime&&local.updatedAt>remoteTime)await persist({detail:{operation:local,reason:'retry'}});
      else window.OperationMode.applyRemote(remote);
    }else await persist({detail:{operation:window.OperationMode.ensure(),reason:'migration'}});
  }catch(error){console.warn('[Operation Settings] cache local mantido',error?.code||error?.message)}
}
async function persist(event){
  if(saving||event.detail?.reason==='cloud')return;
  const {businessId,uid}=context();if(!businessId||!uid)return;saving=true;
  try{await setDoc(doc(db,'businesses',businessId,'settings','operation'),{...event.detail.operation,id:'operation',businessId,ownerId:uid,updatedAt:serverTimestamp()},{merge:true})}
  catch(error){pending=event;console.warn('[Operation Settings] pendente de sincronização',error?.code||error?.message)}
  finally{saving=false}
}
addEventListener('firebase-auth-ready',load);
addEventListener('operation-settings-changed',persist);
addEventListener('online',()=>{if(pending){const event=pending;pending=null;persist(event)}});
if(window.FirebaseSession?.user)load();
