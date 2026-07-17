import { auth, db, BUSINESS_ID } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { normalizeFirestoreData, sanitizeForFirestore } from './firestore-utils.js';

function requireUser(){
  const user=auth.currentUser;
  if(!user)throw Object.assign(new Error('Usuário não autenticado.'),{code:'unauthenticated'});
  return user;
}
function requireBusinessId(){const businessId=String(window.FirebaseSession?.profile?.businessId||BUSINESS_ID||'').trim();if(!businessId)throw new Error('BusinessId não definido para a conta atual.');return businessId}
export function getBusinessCollectionRef(collectionName){return collection(db,'businesses',requireBusinessId(),String(collectionName))}
export function getBusinessDocumentRef(collectionName,id){return doc(db,'businesses',requireBusinessId(),String(collectionName),String(id))}

export function createFirestoreRepository(collectionName){
  const collectionRef=()=>getBusinessCollectionRef(collectionName);
  const documentRef=id=>getBusinessDocumentRef(collectionName,id);
  const convert=snapshot=>snapshot.exists()?normalizeFirestoreData({id:snapshot.id,...snapshot.data()}):null;
  const payload=(id,data,creating=false)=>{
    const user=requireUser(),clean=sanitizeForFirestore(data)||{};
    return {...clean,id:String(id),businessId:requireBusinessId(),ownerId:user.uid,schemaVersion:3,...(creating?{createdAt:serverTimestamp()}:{}),updatedAt:serverTimestamp(),version:Number(clean.version||0)+1};
  };
  return {
    get path(){return `businesses/${requireBusinessId()}/${collectionName}`},
    async list(){return (await getDocs(collectionRef())).docs.map(snapshot=>convert(snapshot)).filter(item=>!item.deletedAt)},
    async getById(id){return convert(await getDoc(documentRef(id)))},
    async create(data){const id=String(data.id||crypto.randomUUID());await setDoc(documentRef(id),payload(id,data,true),{merge:true});return id},
    async update(id,patch){await setDoc(documentRef(id),payload(id,patch),{merge:true});return id},
    async set(id,data){const exists=(await getDoc(documentRef(id))).exists();await setDoc(documentRef(id),payload(id,data,!exists),{merge:true});return id},
    async remove(id){await setDoc(documentRef(id),payload(id,{active:false,deletedAt:new Date().toISOString()}),{merge:true});return id},
    async listRecent(max=100){return (await getDocs(query(collectionRef(),orderBy('createdAt','desc'),limit(max)))).docs.map(snapshot=>convert(snapshot)).filter(item=>!item.deletedAt)},
    subscribe(callback,onError){return onSnapshot(collectionRef(),snapshot=>callback(snapshot.docs.map(item=>convert(item))),error=>{console.error('[Firestore listener failed]',{collection:collectionName,code:error.code,message:error.message});onError?.(error)})},
    subscribeRecent(callback,onError,max=100){return onSnapshot(query(collectionRef(),orderBy('createdAt','desc'),limit(max)),snapshot=>callback(snapshot.docs.map(item=>convert(item))),error=>{console.error('[Firestore recent listener failed]',{collection:collectionName,code:error.code,message:error.message});onError?.(error)})}
  };
}
