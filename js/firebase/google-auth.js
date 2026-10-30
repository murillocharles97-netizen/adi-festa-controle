import {auth} from './firebase-config.js';
import {signInWithCustomToken,getIdTokenResult} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import '../google-registration-client.js';
import {confirmGoogleRegistration} from '../google-registration-dialog.js';
import {mountGoogleIdentityPicker} from '../google-identity-picker.js';
import {googleEntryPolicy} from '../google-registration-release.js';
// No native Firebase Google sign-in or account linking. A test URL is only UI;
// every broker request remains subject to its authenticated identity policy.
const entry=googleEntryPolicy(location.href);
const GOOGLE_WEB_CLIENT_ID="747098339926-ivtar0e0o403i1qudecitl4j9d15s31p.apps.googleusercontent.com",GOOGLE_BROKER_BASE_URL="https://southamerica-east1-adi-festa-controle.cloudfunctions.net";
const scope=()=>{const c=window.BusinessContext?.get?.()||{};return JSON.stringify({businessId:c.businessId||'',generation:c.business?.workspaceGeneration??0,principal:window.DB?.getPrincipal?.()||'',spaceId:window.SpaceContext?.homeId?.()||'',permissions:c.permissionSignature||''});};
async function call(name,data){
 const response=await fetch(GOOGLE_BROKER_BASE_URL+'/'+name,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({data}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error('Google access not confirmed'),{code:result.error?.code});return result;
}
function picker({nonce}){return new Promise((resolve,reject)=>{
 const bg=document.createElement('div'),box=document.createElement('section'),host=document.createElement('div'),cancel=document.createElement('button');bg.className='modal-bg google-registration-overlay';box.className='modal-box google-identity-picker';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','Escolher conta Google');host.className='modal-body';cancel.type='button';cancel.className='btn btn-light';cancel.textContent='Cancelar';let dispose=()=>{},finished=false;
 const end=(value,failed=false)=>{if(finished)return;finished=true;dispose();document.removeEventListener('keydown',key);bg.remove();failed?reject(value):resolve(value);};
 const key=event=>{if(event.key==='Escape'){event.preventDefault();end(null);}};
 cancel.onclick=()=>end(null);box.append(host,cancel);bg.append(box);document.body.append(bg);document.addEventListener('keydown',key);cancel.focus();
 mountGoogleIdentityPicker(host,{nonce,clientId:GOOGLE_WEB_CLIENT_ID,onCredential:t=>end(t),onError:e=>end(e,true)}).then(fn=>{dispose=fn||(()=>{});if(finished)dispose();},e=>end(e,true));
});}
export const googleAuth=Object.assign(window.VeconiGoogleRegistration.create({auth,scope,allowSignup:entry.allowSignup,enabled:entry.enabled&&!!GOOGLE_WEB_CLIENT_ID&&!!GOOGLE_BROKER_BASE_URL,sdk:{signInWithCustomToken},call,picker,confirm:p=>confirmGoogleRegistration(document,p)}),{restrictedPilot:()=>entry.restrictedPilot});
export async function isGoogleRegistration(user){
 if(!user||auth.currentUser?.uid!==user.uid||user.providerData?.some(p=>p.providerId==='password'))return false;
 const token=await getIdTokenResult(user);
 return auth.currentUser?.uid===user.uid&&token.claims.firebase?.sign_in_provider==='custom'&&token.claims.veconi_google_v216===true&&/^vg216_[a-f0-9-]{36}$/.test(user.uid);
}
addEventListener('firebase-session-cleared',()=>googleAuth.reset());
let lastScope=scope();const invalidate=()=>{const next=scope();if(next!==lastScope){lastScope=next;googleAuth.reset();}};
addEventListener('business-context-changed',invalidate);
addEventListener('veconi-space-context-changed',invalidate);
