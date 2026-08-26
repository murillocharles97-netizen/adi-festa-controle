import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js';

const firebaseConfig={apiKey:'AIzaSyAVRQ472PoSZUE_AToig6cicUPxY_cbW4c',authDomain:'adi-festa-controle.firebaseapp.com',projectId:'adi-festa-controle',storageBucket:'adi-festa-controle.firebasestorage.app',messagingSenderId:'747098339926',appId:'1:747098339926:web:9cbfa8a27110e276b0d9f7'};
export const LEGACY_BUSINESS_ID='adi-festa';
export const PROJECT_ID='adi-festa-controle';
if(firebaseConfig.projectId!==PROJECT_ID)throw new Error(`Projeto Firebase incorreto: ${firebaseConfig.projectId||'não informado'}.`);
export const app=getApps().length?getApp():initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
export const functions=getFunctions(app,'southamerica-east1');
window.FirebaseCallable=(name,data)=>httpsCallable(functions,name)(data);
window.FirebaseBusinessReader=async businessId=>{const snapshot=await getDoc(doc(db,'businesses',businessId));return snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null};
window.FirebaseDocumentListener=(segments,onValue,onError)=>onSnapshot(doc(db,...segments),snapshot=>onValue(snapshot.exists()?{id:snapshot.id,...snapshot.data()}:null),onError);
setPersistence(auth,browserLocalPersistence).catch(error=>console.error('[Firebase Auth persistence]',{code:error.code,message:error.message}));
