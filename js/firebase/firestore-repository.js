import { auth, db, BUSINESS_ID } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { normalizeFirestoreData, sanitizeForFirestore } from './firestore-utils.js';

function requireUser(){
  const user=auth.currentUser;
  if(!user)throw Object.assign(new Error('Usuário não autenticado.'),{code:'unauthenticated'});
  return user;
}

export function createFirestoreRepository(collectionName){
  const collectionRef=()=>collection(db,'businesses',BUSINESS_ID,collectionName);
  const documentRef=id=>doc(db,'businesses',BUSINESS_ID,collectionName,String(id));
  const convert=snapshot=>snapshot.exists()?normalizeFirestoreData({id:snapshot.id,...snapshot.data()}):null;
  const payload=(id,data,creating=false)=>{
    const user=requireUser(),clean=sanitizeForFirestore(data)||{};
    return {...clean,id:String(id),businessId:BUSINESS_ID,ownerId:user.uid,schemaVersion:2,...(creating?{createdAt:serverTimestamp()}:{}),updatedAt:serverTimestamp()};
  };
  return {
    path:`businesses/${BUSINESS_ID}/${collectionName}`,
    async list(){return (await getDocs(collectionRef())).docs.map(snapshot=>convert(snapshot)).filter(item=>!item.deletedAt)},
    async getById(id){return convert(await getDoc(documentRef(id)))},
    async create(data){const id=String(data.id||crypto.randomUUID());await setDoc(documentRef(id),payload(id,data,true),{merge:true});return id},
    async update(id,patch){await setDoc(documentRef(id),payload(id,patch),{merge:true});return id},
    async set(id,data){const exists=(await getDoc(documentRef(id))).exists();await setDoc(documentRef(id),payload(id,data,!exists),{merge:true});return id},
    async remove(id){await setDoc(documentRef(id),payload(id,{active:false,deletedAt:new Date().toISOString()}),{merge:true});return id},
    subscribe(callback,onError){return onSnapshot(collectionRef(),snapshot=>callback(snapshot.docs.map(item=>convert(item))),error=>{console.error('[Firestore listener failed]',{collection:collectionName,code:error.code,message:error.message});onError?.(error)})}
  };
}
