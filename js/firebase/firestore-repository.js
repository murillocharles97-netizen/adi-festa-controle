import { auth, db } from './firebase-config.js?v=42';
import { collection, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, where } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { normalizeFirestoreData, sanitizeForFirestore } from './firestore-utils.js';
import {listenerClosed,listenerOpened,recordFirestoreOperation} from './usage-monitor.js?v=42';

const queryCache=new Map(),CACHE_TTL_MS=60000;
const cacheKey=(businessId,collectionName,variant)=>`${businessId}:${collectionName}:${variant}`;
const cached=key=>{const item=queryCache.get(key);return item&&Date.now()-item.at<CACHE_TTL_MS?structuredClone(item.value):null};
const cachePut=(key,value)=>{queryCache.set(key,{at:Date.now(),value:structuredClone(value)});return value};
const timed=async(type,collectionName,operation)=>{const started=performance.now();try{const result=await operation();recordFirestoreOperation(type,{collection:collectionName,documents:result?.size??(result?.exists?.()?1:0),durationMs:performance.now()-started});return result}catch(error){recordFirestoreOperation(type,{collection:collectionName,durationMs:performance.now()-started,error});throw error}};

function requireUser(){
  const user=auth.currentUser;
  if(!user)throw Object.assign(new Error('Usuário não autenticado.'),{code:'unauthenticated'});
  return user;
}
function requireBusinessId(){const businessId=String(window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.profile?.businessId||'').trim();if(!businessId)throw new Error('BusinessId não definido para a conta atual.');return businessId}
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
    async list(options={}){const key=cacheKey(requireBusinessId(),collectionName,'all'),hit=!options.force&&cached(key);if(hit)return hit;const snapshot=await timed('read',collectionName,()=>getDocs(collectionRef()));return cachePut(key,snapshot.docs.map(item=>convert(item)).filter(item=>!item.deletedAt))},
    async getById(id){return convert(await timed('read',collectionName,()=>getDoc(documentRef(id))))},
    async create(data){const id=String(data.id||crypto.randomUUID());await timed('write',collectionName,()=>setDoc(documentRef(id),payload(id,data,true),{merge:true}));queryCache.clear();return id},
    async update(id,patch){await timed('write',collectionName,()=>setDoc(documentRef(id),payload(id,patch),{merge:true}));queryCache.clear();return id},
    async set(id,data){const exists=(await timed('read',collectionName,()=>getDoc(documentRef(id)))).exists();await timed('write',collectionName,()=>setDoc(documentRef(id),payload(id,data,!exists),{merge:true}));queryCache.clear();return id},
    async remove(id){await timed('write',collectionName,()=>setDoc(documentRef(id),payload(id,{active:false,deletedAt:new Date().toISOString()}),{merge:true}));queryCache.clear();return id},
    async listRecent(max=100,options={}){const key=cacheKey(requireBusinessId(),collectionName,`recent:${max}`),hit=!options.force&&cached(key);if(hit)return hit;const snapshot=await timed('read',collectionName,()=>getDocs(query(collectionRef(),orderBy('createdAt','desc'),limit(max))));return cachePut(key,snapshot.docs.map(item=>convert(item)).filter(item=>!item.deletedAt))},
    async listChangedSince(since,max=200){if(!since)return this.list({force:true});const snapshot=await timed('read',collectionName,()=>getDocs(query(collectionRef(),where('updatedAt','>',Timestamp.fromDate(new Date(since))),orderBy('updatedAt','asc'),limit(max))));return snapshot.docs.map(item=>convert(item))},
    async listPage(cursor=null,max=50){const constraints=[orderBy('createdAt','desc')];if(cursor)constraints.push(startAfter(cursor));constraints.push(limit(max));const snapshot=await timed('read',collectionName,()=>getDocs(query(collectionRef(),...constraints)));return{items:snapshot.docs.map(item=>convert(item)).filter(item=>!item.deletedAt),cursor:snapshot.docs.at(-1)||null,hasMore:snapshot.docs.length===max}},
    async listAllPaged(max=200){const items=[];let cursor=null,hasMore=true;while(hasMore){const constraints=[orderBy(documentId())];if(cursor)constraints.push(startAfter(cursor));constraints.push(limit(max));const snapshot=await timed('read',collectionName,()=>getDocs(query(collectionRef(),...constraints)));items.push(...snapshot.docs.map(item=>convert(item)));cursor=snapshot.docs.at(-1)||null;hasMore=snapshot.docs.length===max}return items},
    subscribe(callback,onError){let first=true,opened=true;listenerOpened(collectionName);const stop=onSnapshot(collectionRef(),snapshot=>{recordFirestoreOperation('listen',{collection:collectionName,documents:first?snapshot.size:snapshot.docChanges().length,source:first?'initial':'realtime'});first=false;callback(snapshot.docs.map(item=>convert(item)))},error=>{recordFirestoreOperation('listen',{collection:collectionName,error});console.error('[Firestore listener failed]',{collection:collectionName,code:error.code,message:error.message});onError?.(error)});return()=>{if(opened){opened=false;listenerClosed(collectionName)}stop()}},
    subscribeRecent(callback,onError,max=100){let first=true,opened=true;listenerOpened(collectionName);const stop=onSnapshot(query(collectionRef(),orderBy('createdAt','desc'),limit(max)),snapshot=>{recordFirestoreOperation('listen',{collection:collectionName,documents:first?snapshot.size:snapshot.docChanges().length,source:first?'initial':'realtime'});first=false;callback(snapshot.docs.map(item=>convert(item)))},error=>{recordFirestoreOperation('listen',{collection:collectionName,error});console.error('[Firestore recent listener failed]',{collection:collectionName,code:error.code,message:error.message});onError?.(error)});return()=>{if(opened){opened=false;listenerClosed(collectionName)}stop()}},
    invalidate(){for(const key of [...queryCache.keys()])if(key.includes(`:${collectionName}:`))queryCache.delete(key)}
  };
}
