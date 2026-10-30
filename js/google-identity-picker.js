// Google selection only: this module never creates a Firebase user/session.
let loading=null,active=0;
async function load(){
 if(window.google?.accounts?.id)return window.google.accounts.id;
 if(!loading)loading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=()=>window.google?.accounts?.id?resolve(window.google.accounts.id):reject({code:'link/google-unavailable'});script.onerror=()=>{loading=null;reject({code:'link/google-unavailable'});};document.head.append(script);});
 return loading;
}
export async function mountGoogleIdentityPicker(target,{clientId,nonce,onCredential,onError}){
 if(!clientId||!nonce)throw{code:'link/not-enabled'};const turn=++active,id=await load();
 if(turn!==active||!target.isConnected)return()=>{};
 id.initialize({client_id:clientId,nonce,ux_mode:'popup',auto_select:false,button_auto_select:false,callback:response=>{if(turn!==active||!target.isConnected)return;if(!response?.credential)return onError({code:'link/google-unavailable'});onCredential(response.credential);}});
 id.renderButton(target,{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:Math.max(200,Math.min(340,target.clientWidth||280))});
 // No One Tap prompt, automatic selection, revoke or persisted credential.
 return()=>{if(turn===active)active++;target.replaceChildren();};
}
