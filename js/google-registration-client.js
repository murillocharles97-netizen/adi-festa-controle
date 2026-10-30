(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VeconiGoogleRegistration=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const error=code=>Object.assign(new Error('Google registration not confirmed'),{code});
 const message=e=>({
  'google/not-enabled':'O acesso Google ainda está em homologação. Continue usando seu e-mail e senha.',
  'google/cancelled':'Seleção cancelada. Nenhuma conta foi criada.',
  'google/session-changed':'A sessão mudou. O resultado anterior não será aplicado nesta tela.',
  'google/confirmation-pending':'A resposta não foi confirmada. Consulte o resultado; não repita o envio original.',
  'google/consent-required':'Confirme a criação de uma conta Google nova antes de continuar.',
  'google/signup-paused':'Novos cadastros com Google estão temporariamente pausados. Quem já possui conta Google pode continuar entrando.',
  'original-method-required':'Não foi possível criar uma nova conta Google. Se já possui conta, entre pelo método usado no cadastro.',
 }[e?.code]||'Não foi possível concluir com Google. Se já possui conta, entre pelo método usado no cadastro.');
 function create({auth,sdk,call,picker,confirm,scope=()=>'',enabled=false,allowSignup=true,randomKey=()=>{const bytes=new Uint8Array(32);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');}}){
  let epoch=0,flight=null,pending=null;
  const context=()=>JSON.stringify([auth.currentUser?.uid||'',scope(),epoch]);
  const check=key=>{if(context()!==key)throw error('google/session-changed');};
  const run=fn=>{if(flight)return flight;flight=Promise.resolve().then(fn).finally(()=>flight=null);return flight;};
  async function go(intent,{confirmed=false}={}){return run(async()=>{
   if(!enabled)throw error('google/not-enabled');
   if(intent==='signup'&&!allowSignup)throw error('google/signup-paused');
   if(auth.currentUser)throw error('google/session-changed');
   if(intent==='signup'&&!confirmed)throw error('google/consent-required');
   const key=context(),clientKey=randomKey();let credential=null;
   const begin=(await call('prepareGoogleAccountAccess',{step:'begin',intent,clientKey})).data;check(key);
   credential=await picker({nonce:begin.nonce});check(key);if(!credential)throw error('google/cancelled');
   const proof={intentId:begin.intentId,clientKey,csrf:begin.csrf};
   try{
    const preview=(await call('prepareGoogleAccountAccess',{step:'preview',...proof,googleIdToken:credential})).data;check(key);
    if(!await confirm(preview))throw error('google/cancelled');check(key);
    pending={...proof,intent};let result;
    try{result=(await call('completeGoogleAccountAccess',{...proof,googleIdToken:credential,confirmation:intent==='signup'?'CREATE_NEW_GOOGLE_ACCOUNT':'SIGN_IN_REGISTERED_GOOGLE'})).data;}
    catch(failure){
     if(['original-method-required','access-unavailable','identity-changed','not-enabled','native-provider-open-or-email-uniqueness-unconfirmed','policy-incomplete'].includes(failure?.code)){pending=null;throw failure;}
     throw error('google/confirmation-pending');
    }
    check(key);credential=null;
    if(typeof result.customToken!=='string'||!/^vg216_[a-f0-9-]{36}$/.test(result.uid||'')||result.accountLinking!==false||result.companyCreated!==false)throw error('google/confirmation-pending');
    const login=await sdk.signInWithCustomToken(auth,result.customToken);
    if(login.user.uid!==result.uid||auth.currentUser?.uid!==result.uid)throw error('google/session-changed');
    pending=null;return{uid:result.uid,companyCreated:false,accountLinking:false};
   }finally{credential=null;}
  });}
  async function verifyPending(){return run(async()=>{
   if(!enabled||!pending||auth.currentUser)throw error('google/session-changed');
   const key=context(),result=(await call('prepareGoogleAccountAccess',{step:'status',intentId:pending.intentId,clientKey:pending.clientKey,csrf:pending.csrf})).data;check(key);
   if(result.confirmed){pending=null;return{confirmed:true,authenticated:false,message:'O cadastro/acesso foi registrado. Entre novamente com Google para iniciar uma nova sessão.'};}
   return{confirmed:false,authenticated:false,message:'Ainda não foi possível confirmar. Nenhum reenvio automático foi realizado.'};
  });}
  return{available:intent=>enabled&&(intent!=='signup'||allowSignup),busy:()=>!!flight,message,signIn:()=>go('signin'),signUp:o=>go('signup',o),verifyPending,isPending:()=>!!pending,reset:()=>{epoch++;pending=null;}};
 }
 return{create,message};
});
