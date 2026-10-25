/* QA only: real Firebase Auth SDK against local Emulator; all business services mocked. */
import {initializeApp} from '/qa/sdk/app.js';
import {getAuth,connectAuthEmulator,setPersistence,browserLocalPersistence,onAuthStateChanged as observe,createUserWithEmailAndPassword,sendPasswordResetEmail,signInWithEmailAndPassword,signOut,EmailAuthProvider,reauthenticateWithCredential} from '/qa/sdk/auth.js';
export {createUserWithEmailAndPassword,sendPasswordResetEmail,signInWithEmailAndPassword,signOut,EmailAuthProvider,reauthenticateWithCredential};
export const auth=getAuth(initializeApp({apiKey:'emulator-key',projectId:'demo-veconi-login-v203',authDomain:'localhost'}));
connectAuthEmulator(auth,'http://127.0.0.1:9198',{disableWarnings:true});
window.FirebaseAuthPersistenceReady=setPersistence(auth,browserLocalPersistence);
window.qaAuthCalls=[];window.qaBusinessCalls=[];window.qaObserved=[];
// Only the observer's business-bootstrap continuation is held in this visual/Auth harness.
// The real SDK, login/create/reset handlers and persistence all execute unmodified.
export const onAuthStateChanged=(a,callback)=>observe(a,user=>{window.qaObserved.push(user?.uid||null);if(!user)callback(null);});
window.qaSDK={auth,signOut};
export const db={},LEGACY_BUSINESS_ID='never-legacy-qa',INTERNAL_BUSINESS_ID='qa-internal',APP_NAME='VECONI',PLANS={trial:{name:'Teste'}};
let context={};
export const BusinessContext={get:()=>context,clear:()=>{context={};},fail:()=>{},getCurrentBusinessId:()=> 'qa-only'};
export const LEGACY_MIGRATION_VERSION=0,resetLegacyMigrationAttempt=()=>{},runLegacyMigration=()=>{throw Error('Migration is not part of login QA');};
export const abbreviateTechnicalId=v=>String(v||'').slice(0,6),profileValidationInfo=()=>({}),validateAuthenticatedBusiness=()=>({}),validateAuthenticatedProfile=()=>({});
export const cleanupCurrentSession=()=>{},registerCleanup=()=>{},runCleanup=()=>{};
export const doc=(_db,...parts)=>parts.join('/'),getDoc=async ref=>({exists:()=>true,data:()=>({uid:auth.currentUser?.uid,businessId:'qa-only',active:true}),id:String(ref).split('/').at(-1)}),getDocFromServer=getDoc,serverTimestamp=()=>0;
export const setDoc=()=>{throw Error('Direct Firestore write prohibited in login QA');};
window.DB={releaseBusiness:async()=>{},carregar:()=>({config:{},produtos:[],clientes:[],vendas:[]})};
window.SyncFirebase={setAuthReady:()=>{},stop:()=>{}};
window.TeamAccess={ROLE_LABELS:{seller:'Vendedor / Caixa'}};
window.PlansUI={render:()=>'<section class="auth-card"><h1>Planos VECONI</h1><p>QA: tabela fictícia, sem cobrança.</p><button class="btn btn-light" data-qa-plan-back>Voltar</button></section>',bind:(_root,options)=>{document.querySelector('[data-qa-plan-back]').onclick=options.onBack;}};
window.FirebaseCallable=async(name,input)=>{window.qaBusinessCalls.push({name,input});await window.qaRecordBusinessCall?.({name});if(name==='getTeamInvitePreview')return {data:{email:'invite@veconi.example.test',businessName:'Empresa fictícia QA',name:'Pessoa QA',role:'seller'}};if(name==='completeBusinessOnboarding')return {data:{businessId:'qa-only',trial:{preserved:true}}};throw Error('Business writes are not enabled in login QA');};
