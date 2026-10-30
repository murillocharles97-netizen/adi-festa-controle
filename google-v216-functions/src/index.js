'use strict';
// Separate proposed codebase: no imports/initialization of commerce or Sync.
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {OAuth2Client,GoogleAuth}=require('google-auth-library');
const {onRequest}=require('firebase-functions/v2/https');
const {registrationBroker}=require('./broker');
const {registrationStore}=require('./store');
const {googleVerifier}=require('./google-verifier');
const {brokerHttp}=require('./http');
const {disabledNativeProbe}=require('./native-probe');
const PROJECT='adi-festa-controle',SA='veconi-google-broker@'+PROJECT+'.iam.gserviceaccount.com';
const clientId=process.env.V216_GOOGLE_CLIENT_ID||'';
const origins=(process.env.V216_GOOGLE_ORIGINS||'').split(',').filter(x=>/^https:\/\/[a-z0-9.-]+$/.test(x));
const app=initializeApp({projectId:PROJECT,serviceAccountId:SA,credential:applicationDefault()}),auth=getAuth(app),db=getFirestore(app);
const management=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
async function readNativeProvider(){
 const token=await management.getAccessToken();
 const headers={Authorization:'Bearer '+token};
 const r=await fetch('https://identitytoolkit.googleapis.com/admin/v2/projects/'+PROJECT+'/defaultSupportedIdpConfigs/google.com?fields=name,enabled',{headers,signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('Provider state unavailable');const d=await r.json();
 if(d.name!=='projects/747098339926/defaultSupportedIdpConfigs/google.com'||d.enabled!==undefined&&typeof d.enabled!=='boolean')throw Error('Provider state invalid');
 const c=await fetch('https://identitytoolkit.googleapis.com/admin/v2/projects/'+PROJECT+'/config?fields=name,signIn(allowDuplicateEmails)',{headers,signal:AbortSignal.timeout(5000)});
 if(!c.ok)throw Error('Email uniqueness unavailable');const settings=await c.json();
 if(!['projects/747098339926/config','projects/'+PROJECT+'/config'].includes(settings.name)||settings.signIn?.allowDuplicateEmails!==undefined&&typeof settings.signIn.allowDuplicateEmails!=='boolean')throw Error('Email uniqueness invalid');
 return{authoritative:true,enabled:d.enabled===true,emailUniquenessEnforced:settings.signIn?.allowDuplicateEmails!==true};
}
const unavailable=async()=>{throw Error('Google OAuth not configured');};
const oauth=clientId?new OAuth2Client(clientId):null;
const verifyGoogle=oauth?googleVerifier({clientId,verifyIdToken:p=>oauth.verifyIdToken(p)}):unavailable;
const nativeProbe=process.env.V216_GOOGLE_WEB_API_KEY?disabledNativeProbe({apiKey:process.env.V216_GOOGLE_WEB_API_KEY}):unavailable;
const service=registrationBroker({auth,store:registrationStore(db),verifyGoogle,readNativeProvider,probeNative:nativeProbe,projectId:PROJECT,
 enabled:process.env.V216_GOOGLE_ENABLED==='true'&&process.env.GCLOUD_PROJECT===PROJECT&&!!oauth&&origins.length>0,
 allowCommercial:process.env.V216_GOOGLE_COMMERCIAL==='true',
 assertNoBusiness:async uid=>{const [profile,business]=await Promise.all([db.doc('users/'+uid).get(),db.doc('businesses/biz_'+uid).get()]);if(profile.exists||business.exists)throw Error('Pilot identity no longer Auth-only');},
});
const options={region:'southamerica-east1',serviceAccount:SA,memory:'256MiB',minInstances:0,maxInstances:1,concurrency:8,timeoutSeconds:30,cors:false};
exports.prepareGoogleAccountAccess=onRequest(options,brokerHttp(service,{endpoint:'prepare',origins}));
exports.completeGoogleAccountAccess=onRequest(options,brokerHttp(service,{endpoint:'complete',origins}));
