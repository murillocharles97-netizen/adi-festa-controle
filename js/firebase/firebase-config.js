import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { getFirestore, enableIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig={apiKey:'AIzaSyAVRQ472PoSZUE_AToig6cicUPxY_cbW4c',authDomain:'adi-festa-controle.firebaseapp.com',projectId:'adi-festa-controle',storageBucket:'adi-festa-controle.firebasestorage.app',messagingSenderId:'747098339926',appId:'1:747098339926:web:9cbfa8a27110e276b0d9f7'};
export const BUSINESS_ID='adi-festa';
export const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
export const db=getFirestore(app);
setPersistence(auth,browserLocalPersistence).catch(()=>{});
enableIndexedDbPersistence(db,{synchronizeTabs:true}).catch(error=>{if(!['failed-precondition','unimplemented'].includes(error.code))console.warn('Cache offline indisponível.',error);});
