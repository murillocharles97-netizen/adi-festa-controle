import {auth,db,LEGACY_BUSINESS_ID} from './firebase-config.js';
import {createUserWithEmailAndPassword,onAuthStateChanged,sendPasswordResetEmail,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {doc,getDoc,serverTimestamp,setDoc,Timestamp,writeBatch} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {APP_NAME,BusinessContext,INTERNAL_BUSINESS_ID,PLANS,SubscriptionService} from './business-context.js';
import {LEGACY_MIGRATION_VERSION,resetLegacyMigrationAttempt,runLegacyMigration} from './legacy-migration.js';
import {abbreviateTechnicalId,profileValidationInfo,validateAuthenticatedBusiness,validateAuthenticatedProfile} from './profile-validation.js';
import {cleanupCurrentSession,registerCleanup} from './session-lifecycle.js';
import './sync.js';

const gate=document.querySelector('#auth-gate'),PENDING_PREFIX='adiFesta:onboarding:',BOOTSTRAP_TIMEOUT_MS=15000;
const BOOTSTRAP_STATES=new Set(['initializing','unauthenticated','loading_profile','loading_business','migration_required','loading_access','ready','onboarding_required','subscription_warning','subscription_blocked','temporary_unavailable','permission_error','profile_error','business_error','fatal_error']);
const NON_TERMINAL_STATES=new Set(['initializing','loading_profile','loading_business','migration_required','loading_access']);
let bootstrapState='unauthenticated',bootstrapRun=null,readyUid='',bootstrapSequence=0;
const automaticBootstrapAttempts=new Set();
const businessTypes=['Mercearia','Doceria','Conveniência','Papelaria','Loja de festas','Lanchonete','Loja de roupas','Comércio geral','Outro'];
const registerState={step:1,data:{name:'',phone:'',email:'',password:'',confirm:'',businessName:'',businessType:'Doceria',businessPhone:'',city:'',state:'SP',document:''}};
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const friendly=code=>({'auth/invalid-email':'Informe um e-mail válido.','auth/email-already-in-use':'Este e-mail já possui uma conta. Entre com sua senha.','auth/weak-password':'Use uma senha mais forte, com pelo menos 6 caracteres.','auth/user-not-found':'E-mail ou senha incorretos.','auth/wrong-password':'E-mail ou senha incorretos.','auth/invalid-credential':'E-mail ou senha incorretos.','auth/user-disabled':'Esta conta está desativada.','auth/too-many-requests':'Muitas tentativas. Aguarde e tente novamente.','auth/network-request-failed':'Não foi possível conectar. Verifique sua internet.','permission-denied':'A operação foi bloqueada pelas regras de segurança.','resource-exhausted':'O limite temporário do Firebase foi atingido. Tente novamente mais tarde.'}[String(code||'').replace('firestore/','')]||'Não foi possível concluir agora. Tente novamente.');
const slugify=value=>String(value||'negocio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'negocio';
const businessIdFor=user=>`biz_${user.uid}`;
const pendingKey=uid=>`${PENDING_PREFIX}${uid}`;
function screen(html){gate.innerHTML=html;gate.hidden=false;document.documentElement.classList.add('auth-pending');window.lucide?.createIcons()}
function setButtonLoading(button,loading,text){if(!button)return;button.disabled=loading;if(text)button.textContent=text}
function setBootstrapState(state,details={}){
  if(!BOOTSTRAP_STATES.has(state))throw Error(`Estado de bootstrap inválido: ${state}`);
  bootstrapState=state;
  window.FirebaseBootstrap={state,details:{...details,migrationVersion:LEGACY_MIGRATION_VERSION},retry:()=>retryBootstrap(),logout:()=>bootstrapLogout(),completeLegacyMigration:()=>completeLegacyMigrationManually()};
  dispatchEvent(new CustomEvent('firebase-bootstrap-state',{detail:{state,...details}}));
}
function normalizedCode(error){return String(error?.code||'').replace('firestore/','')}
function isDevelopment(){
  return ['localhost','127.0.0.1'].includes(location.hostname)||localStorage.getItem('adiFestaDevMetrics')==='1';
}
function bootstrapLog(message,details){
  if(isDevelopment())console.info(`[Bootstrap] ${message}`,details||'');
}
function timeoutError(){return Object.assign(new Error('O bootstrap excedeu 15 segundos.'),{code:'bootstrap/timeout'})}
function withTimeout(promise,token){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{token.cancelled=true;reject(timeoutError())},BOOTSTRAP_TIMEOUT_MS)});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
function assertCurrentRun(token){if(token.cancelled||token.sequence!==bootstrapSequence)throw Object.assign(new Error('Bootstrap substituído por uma nova tentativa.'),{code:'bootstrap/cancelled'})}

function login(message=''){
  screen(`<section class="auth-card auth-entry-card"><div class="auth-logo">AF</div><h1>${APP_NAME}</h1><p>Controle seu negócio com segurança, de qualquer aparelho.</p><form id="login-form"><label>E-mail<input name="email" type="email" autocomplete="email" required inputmode="email"></label><label>Senha<div class="password-field"><input name="password" type="password" autocomplete="current-password" required><button type="button" id="toggle-password" aria-label="Mostrar senha">👁</button></div></label><p class="auth-error" id="auth-error">${esc(message)}</p><button class="btn btn-primary" id="login-submit">Entrar</button><button class="btn btn-light" type="button" id="show-register">Criar minha conta</button><button class="auth-link" type="button" data-show-plans>Ver planos</button></form></section>`);
  document.querySelector('#toggle-password').onclick=()=>{const input=document.querySelector('[name=password]');input.type=input.type==='password'?'text':'password'};
  document.querySelector('#show-register').onclick=()=>{registerState.step=1;register()};
  document.querySelector('[data-show-plans]').onclick=()=>plansScreen(false);
  document.querySelector('#login-form').onsubmit=async event=>{event.preventDefault();const button=document.querySelector('#login-submit'),form=new FormData(event.currentTarget);setButtonLoading(button,true,'Entrando…');try{await signInWithEmailAndPassword(auth,String(form.get('email')).trim(),form.get('password'))}catch(error){login(friendly(error.code))}};
}

function collectRegister(form){
  const values=Object.fromEntries(new FormData(form));
  Object.assign(registerState.data,values);
}
function register(message=''){
  const {step,data}=registerState,progress=`<div class="auth-steps">${[1,2,3].map(value=>`<span class="${step>=value?'active':''}">${value}</span>`).join('')}</div>`;
  let content='';
  if(step===1)content=`<h1>Crie sua conta</h1><p>Primeiro, conte um pouco sobre você.</p><label>Nome completo<input name="name" required autocomplete="name" value="${esc(data.name)}"></label><label>WhatsApp<input name="phone" required inputmode="tel" autocomplete="tel" value="${esc(data.phone)}"></label><label>E-mail<input name="email" type="email" required autocomplete="email" value="${esc(data.email)}"></label><label>Senha<input name="password" type="password" minlength="6" required autocomplete="new-password" value="${esc(data.password)}"></label><label>Confirmar senha<input name="confirm" type="password" minlength="6" required autocomplete="new-password" value="${esc(data.confirm)}"></label>`;
  if(step===2)content=`<h1>Seu negócio</h1><p>Esses dados identificam o ambiente da sua empresa.</p><label>Nome do comércio<input name="businessName" required value="${esc(data.businessName)}"></label><label>Tipo de comércio<select name="businessType">${businessTypes.map(type=>`<option ${data.businessType===type?'selected':''}>${type}</option>`).join('')}</select></label><label>WhatsApp comercial<input name="businessPhone" required inputmode="tel" value="${esc(data.businessPhone||data.phone)}"></label><div class="auth-form-grid"><label>Cidade<input name="city" required value="${esc(data.city)}"></label><label>Estado<input name="state" maxlength="2" required value="${esc(data.state)}"></label></div><label>CPF/CNPJ <small>(opcional)</small><input name="document" value="${esc(data.document)}"></label>`;
  if(step===3)content=`<h1>Revise sua conta</h1><p>Você começará com 7 dias grátis e poderá escolher um plano depois.</p><div class="auth-review"><span><small>Administrador</small><b>${esc(data.name)}</b><em>${esc(data.email)}</em></span><span><small>Empresa</small><b>${esc(data.businessName)}</b><em>${esc(data.businessType)} · ${esc(data.city)}/${esc(data.state)}</em></span><span><small>Plano inicial</small><b>Teste grátis</b><em>7 dias · sem cobrança automática</em></span></div>`;
  screen(`<section class="auth-card auth-register-card"><div class="auth-logo">AF</div>${progress}<form id="register-form">${content}<p class="auth-error">${esc(message)}</p><div class="auth-form-actions">${step>1?'<button class="btn btn-light" type="button" id="register-back">Voltar</button>':'<button class="btn btn-light" type="button" id="back-login">Já tenho conta</button>'}<button class="btn btn-primary" id="register-next">${step===3?'Criar conta':'Continuar'}</button></div></form></section>`);
  document.querySelector('#back-login')?.addEventListener('click',()=>login());
  document.querySelector('#register-back')?.addEventListener('click',()=>{registerState.step--;register()});
  document.querySelector('#register-form').onsubmit=async event=>{
    event.preventDefault();collectRegister(event.currentTarget);
    const d=registerState.data;
    if(step===1&&d.password!==d.confirm)return register('As senhas não são iguais.');
    if(step<3){registerState.step++;return register()}
    const button=document.querySelector('#register-next');setButtonLoading(button,true,'Criando ambiente…');
    try{
      const result=await createUserWithEmailAndPassword(auth,d.email.trim(),d.password);
      localStorage.setItem(pendingKey(result.user.uid),JSON.stringify({...d,password:undefined,confirm:undefined}));
      await provisionBusinessAccount(result.user,d);
      localStorage.removeItem(pendingKey(result.user.uid));
      location.reload();
    }catch(error){console.error('[SaaS onboarding]',{code:error.code,message:error.message});register(friendly(error.code))}
  };
}

async function provisionBusinessAccount(user,data){
  const profileRef=doc(db,'users',user.uid),existing=await getDoc(profileRef);
  if(existing.exists())return existing.data();
  const businessId=businessIdFor(user),now=new Date(),trialEnd=new Date(now.getTime()+7*86400000),slug=`${slugify(data.businessName)}-${user.uid.slice(0,6).toLowerCase()}`,plan=PLANS.trial,batch=writeBatch(db);
  const profile={uid:user.uid,email:user.email,name:String(data.name||'Administrador').trim(),phone:String(data.phone||''),active:true,businessId,role:'owner',permissions:[],onboardingCompleted:true,createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now),lastLoginAt:Timestamp.fromDate(now)};
  const business={id:businessId,slug,name:String(data.businessName).trim(),legalName:'',document:String(data.document||''),phone:String(data.businessPhone||data.phone||''),email:user.email,ownerId:user.uid,active:true,onboardingCompleted:true,businessType:String(data.businessType||'Comércio geral'),city:String(data.city||''),state:String(data.state||'').toUpperCase(),createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now),subscription:{planId:'trial',status:'trial',trialStartedAt:Timestamp.fromDate(now),trialEndsAt:Timestamp.fromDate(trialEnd),currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null},limits:{maxUsers:plan.limits.users,maxProducts:plan.limits.products,maxClients:plan.limits.clients,maxMonthlySales:plan.limits.monthlySales,users:plan.limits.users,products:plan.limits.products,clients:plan.limits.clients,monthlySales:plan.limits.monthlySales,catalogEnabled:true,campaignsEnabled:true}};
  batch.set(doc(db,'businesses',businessId),business);
  batch.set(profileRef,profile);
  batch.set(doc(db,'businesses',businessId,'settings','default'),{id:'default',businessId,nome:business.name,businessName:business.name,receiptName:business.name,telefone:business.phone,currency:'BRL',timezone:'America/Sao_Paulo',onboardingStep:1,createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now)});
  batch.set(doc(db,'businesses',businessId,'settings','operation'),{id:'operation',businessId,ownerId:user.uid,operationMode:'physical_store',creditMode:'disabled',operationOnboardingCompleted:false,modules:{creditSales:false,inventory:true,onlineCatalog:false,onlineOrders:false,delivery:false,pickup:false,physicalStore:true,scheduledVisits:false,campaigns:false,loyalty:false,crm:true,inPersonSales:true},smartCardMode:'automatic',cardMetrics:[],migrationVersion:2,schemaVersion:2,createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now)});
  batch.set(doc(db,'businesses',businessId,'auditLogs',`account_created_${user.uid}`),{id:`account_created_${user.uid}`,businessId,type:'account_created',actorId:user.uid,createdAt:Timestamp.fromDate(now)});
  await batch.commit();
  return profile;
}

async function migrateLegacy(user,profile,business,mode='automatic'){
  if(profile.businessId!==LEGACY_BUSINESS_ID)return{profile,business};
  const result=await runLegacyMigration({
    user,profile,business,mode,timestamp:new Date().toISOString(),
    writeProfile:patch=>setDoc(doc(db,'users',user.uid),{...patch,migratedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true}),
    writeBusiness:patch=>setDoc(doc(db,'businesses',LEGACY_BUSINESS_ID),{...patch,migratedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true})
  });
  return{profile:result.profile,business:result.business};
}

function downloadBackup(){
  const backup=DB.criarBackup(),link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  link.href=url;link.download=`backup-${backup.businessId}-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function plansScreen(authenticated=true){
  screen(window.PlansUI.render({publicMode:!authenticated,authMode:authenticated}));
  window.PlansUI.bind(gate,{publicMode:!authenticated,onBack:()=>authenticated?startBootstrap(auth.currentUser,{mode:'retry'}):login(),onRegister:()=>{registerState.step=1;register()},onLogin:()=>login()});
}
function blockedScreen(user,context){
  const trial=context.access?.reason==='trial_expired';
  screen(`<section class="auth-card auth-blocked-card"><div class="auth-logo">AF</div><h1>${trial?'Seu período de teste terminou':'Acesso temporariamente indisponível'}</h1><p>${trial?'Seus dados continuam salvos. Escolha um plano para voltar a criar vendas e cadastros.':'Entre em contato com o responsável pela conta.'}</p><button class="btn btn-primary" data-blocked-plans>Ver planos</button><button class="btn btn-light" data-export-data>Exportar meus dados</button><button class="btn btn-light" data-blocked-logout>Sair da conta</button></section>`);
  document.querySelector('[data-blocked-plans]').onclick=()=>plansScreen(true);
  document.querySelector('[data-export-data]').onclick=downloadBackup;
  document.querySelector('[data-blocked-logout]').onclick=()=>logout(true);
}
function unauthorized(user,message,canResume=false,title='Acesso não configurado'){
  screen(`<section class="auth-card"><div class="auth-logo">AF</div><h1>${esc(title)}</h1><p>${esc(message)}</p>${canResume?'<button class="btn btn-primary" id="resume-onboarding">Retomar criação da empresa</button>':''}<button class="btn btn-light" id="logout-unauthorized">Sair da conta</button></section>`);
  document.querySelector('#resume-onboarding')?.addEventListener('click',async()=>{const saved=JSON.parse(localStorage.getItem(pendingKey(user.uid))||'null');if(!saved)return login('Os dados do cadastro não estão mais neste aparelho.');try{await provisionBusinessAccount(user,saved);localStorage.removeItem(pendingKey(user.uid));location.reload()}catch(error){unauthorized(user,friendly(error.code),true)}});
  document.querySelector('#logout-unauthorized').onclick=bootstrapLogout;
}
function bootstrapTechnicalDetails(details={}){
  const rows=[
    ['Código',details.code],
    ['UID autenticado',details.authUid],
    ['Documento do perfil',details.profileDocumentId],
    ['UID salvo no perfil',details.profileUid],
    ['Proprietário da empresa',details.ownerId]
  ].filter(([,value])=>value);
  if(!rows.length)return'';
  return `<details class="auth-technical-details"><summary>Detalhes técnicos</summary><div class="auth-review">${rows.map(([label,value])=>`<span><small>${esc(label)}</small><b>${esc(label==='Código'?value:abbreviateTechnicalId(value))}</b></span>`).join('')}</div><p><small>Por segurança, um UID divergente nunca é corrigido automaticamente. Confirme no Firebase Authentication e em users/{UID} qual conta é a proprietária, ou encaminhe estes identificadores abreviados ao administrador.</small></p></details>`;
}
function bootstrapErrorScreen(user,state,message,{manual=false,title='',details={}}={}){
  setBootstrapState(state,{code:details.code||state});
  const heading=title||(state==='temporary_unavailable'?'Configuração temporariamente indisponível':state==='permission_error'?'Permissão necessária':'Não foi possível abrir o aplicativo');
  screen(`<section class="auth-card auth-blocked-card"><div class="auth-logo">AF</div><h1>${esc(heading)}</h1><p>${esc(message)}</p>${bootstrapTechnicalDetails(details)}<button class="btn btn-primary" id="bootstrap-retry" type="button">Tentar novamente</button>${manual?'<button class="btn btn-light" id="bootstrap-manual-migration" type="button">Completar migração manualmente</button>':''}<button class="btn btn-light" id="bootstrap-logout" type="button">Sair da conta</button></section>`);
  document.querySelector('#bootstrap-retry').onclick=async event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='Tentando…';await retryBootstrap(user)};
  document.querySelector('#bootstrap-manual-migration')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='Executando…';await completeLegacyMigrationManually()});
  document.querySelector('#bootstrap-logout').onclick=bootstrapLogout;
}
async function bootstrapLogout(){
  const signingOutUid=auth.currentUser?.uid;
  bootstrapSequence++;
  if(bootstrapRun?.token)bootstrapRun.token.cancelled=true;
  bootstrapRun=null;readyUid='';
  cleanupCurrentSession();
  try{window.SyncFirebase?.stop?.()}catch{}
  try{window.BarcodeScanner?.stop?.();window.BarcodeScanner?.close?.()}catch{}
  try{window.CheckoutMobile?.reset?.()}catch{}
  try{badgeSubscription?.()}catch{}badgeSubscription=null;
  BusinessContext.clear();DB.releaseBusiness();window.FirebaseSession=null;window.SyncFirebaseState=null;window.FirebaseAuthActions={signOut:bootstrapLogout};
  try{sessionStorage.removeItem('adiFestaMessagePendingReturn_v1')}catch{}
  delete window.CheckoutPaymentMethod;
  document.querySelector('#app').innerHTML='';
  document.querySelector('#modal').innerHTML='';
  history.replaceState(null,'',`${location.pathname}${location.search}#/inicio`);
  dispatchEvent(new CustomEvent('firebase-session-cleared',{detail:{uid:signingOutUid||''}}));
  if(signingOutUid)automaticBootstrapAttempts.delete(signingOutUid);
  setBootstrapState('unauthenticated');
  screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Saindo da conta…</p></section>');
  try{await Promise.race([signOut(auth),new Promise((_,reject)=>setTimeout(()=>reject(Error('logout-timeout')),5000))])}catch(error){console.warn('[Firebase Bootstrap] logout',{code:normalizedCode(error)||'timeout'})}finally{login()}
}
async function retryBootstrap(user=auth.currentUser){
  if(!user)return login();
  return startBootstrap(user,{mode:'retry'});
}
async function completeLegacyMigrationManually(){
  const user=auth.currentUser;
  if(!user)return login('Entre na conta do proprietário para executar a migração.');
  resetLegacyMigrationAttempt(user.uid);
  return startBootstrap(user,{mode:'manual'});
}

let badgeSubscription=null;
function updateCloudBadge(syncState){const badge=document.querySelector('.local-badge');if(!badge)return;const count=Number(syncState.queueTotal||0),map=syncState.status==='error'?['cloud-off','Nuvem','error']:syncState.status==='offline'?['cloud-off','Nuvem','offline']:['testing','waiting','syncing'].includes(syncState.status)?['refresh-cw','Nuvem','syncing']:syncState.testPassed&&syncState.status==='success'?['cloud','Nuvem','success']:['cloud','Nuvem','idle'];const[icon,text,status]=map;badge.dataset.syncStatus=status;badge.setAttribute('role','button');badge.setAttribute('tabindex','0');badge.setAttribute('aria-label',`${text}. ${count} alterações pendentes`);badge.innerHTML=`<i data-lucide="${icon}"></i> ${text}${count?`<b class="cloud-count">${count}</b>`:''}`;window.lucide?.createIcons()}
function showFirstBusinessOnboarding(context){
  if(context.businessId===INTERNAL_BUSINESS_ID)return;
  const key=`adiFesta:${context.businessId}:onboardingSeen`,data=DB.carregar();
  if(localStorage.getItem(key)==='1'||data.produtos.length||data.clientes.length||data.vendas.length)return;
  const modal=document.querySelector('#modal');if(!modal)return;
  modal.innerHTML=`<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Bem-vindo à ${esc(context.business.name)}</h3></header><div class="modal-body"><p>Seu ambiente está pronto e começa vazio, sem dados de demonstração.</p><div class="auth-review"><span><small>Passo 1</small><b>Cadastre seu primeiro produto</b></span><span><small>Passo 2</small><b>Cadastre ou importe clientes</b></span><span><small>Passo 3</small><b>Registre sua primeira venda</b></span></div></div><footer class="modal-foot"><button class="btn btn-light" data-skip-onboarding>Pular por enquanto</button><button class="btn btn-primary" data-start-onboarding>Cadastrar produto</button></footer></section></div>`;
  const finish=route=>{localStorage.setItem(key,'1');DB.alterar(current=>current.config.onboardingStep=route?2:1);modal.innerHTML='';if(route)location.hash=`#/${route}`};
  modal.querySelector('[data-skip-onboarding]').onclick=()=>finish('');
  modal.querySelector('[data-start-onboarding]').onclick=()=>finish('produtos');
}
function showSubscriptionBanner(access){
  document.querySelector('#subscription-access-banner')?.remove();
  if(access.internal||(!access.readOnly&&!access.showBillingWarning))return;
  const messages={trialing:access.readOnly?'Seu período de teste terminou. Você ainda pode visualizar todos os seus dados.':`Teste grátis — ${access.daysRemaining??0} dia(s) restante(s).`,expired:'Teste encerrado — visualização disponível.',past_due:'Pagamento pendente — revise sua assinatura.',pending:'Pagamento em processamento — seus dados seguem disponíveis.',canceled:'Plano cancelado — acesso de visualização mantido.',inactive:'Você está no modo de visualização. Escolha um plano para criar novos registros.'};
  const banner=document.createElement('aside');banner.id='subscription-access-banner';banner.className=`subscription-access-banner ${access.readOnly?'read-only':'warning'}`;banner.innerHTML=`<i data-lucide="${access.readOnly?'eye':'clock-3'}"></i><span><b>${esc(messages[access.status]||'Assinatura requer atenção.')}</b>${access.readOnly?'<small>Clientes, estoque, histórico e CRM continuam acessíveis.</small>':''}</span><button type="button">Ver planos</button>`;banner.querySelector('button').onclick=()=>Router.ir('planos');document.querySelector('.shell')?.prepend(banner);window.lucide?.createIcons();
}
function allowed(user,profile,business){
  const context=BusinessContext.set({business,userProfile:profile});
  DB.useBusiness(profile.businessId,{migrateLegacy:profile.businessId===INTERNAL_BUSINESS_ID});
  if(profile.businessId!==INTERNAL_BUSINESS_ID)DB.alterar(data=>{if(!data.config.nome||data.config.nome==='Adi Festa')data.config.nome=business.name;if(!data.config.telefone&&business.phone)data.config.telefone=business.phone});
  window.FirebaseSession={user,profile,businessId:profile.businessId,business:context.business,subscription:context.subscription,access:context.access};
  window.FirebaseAuthActions={signOut:logout,updateBusiness:updateBusinessDetails,updateProfile:updateProfileDetails,sendPasswordReset};
  setBootstrapState('ready',{businessId:profile.businessId});
  gate.hidden=true;document.documentElement.classList.remove('auth-pending');
  document.querySelector('.avatar').textContent=(profile.name||user.email||'A')[0].toUpperCase();
  document.querySelectorAll('[data-business-name]').forEach(node=>node.textContent=business.name);
  document.querySelector('.brand-sub')?.replaceChildren(document.createTextNode(business.name));
  const topbar=document.querySelector('.topbar'),oldPlan=topbar?.querySelector('.subscription-badge');oldPlan?.remove();
  if(topbar){const plan=PLANS[context.subscription?.planId]||PLANS.trial,badge=document.createElement('span');badge.className='subscription-badge';badge.textContent=context.subscription?.status==='trial'?`Teste · ${context.access.daysRemaining} dia(s)`:plan.name;topbar.insertBefore(badge,document.querySelector('.local-badge'))}
  showSubscriptionBanner(context.access);
  try{
    window.SyncFirebase.setUser(user,profile,business);
    badgeSubscription?.();badgeSubscription=window.SyncFirebase.subscribe(updateCloudBadge);
    registerCleanup('firebase-sync',()=>window.SyncFirebase?.stop?.());
    registerCleanup('cloud-badge',()=>{try{badgeSubscription?.()}finally{badgeSubscription=null}});
    bootstrapLog('sync prepared',{degraded:false});
  }catch(error){
    console.warn('[Bootstrap optional module]',{module:'sync',code:normalizedCode(error)||'SYNC_UNAVAILABLE',message:error?.message});
    window.FirebaseBootstrap.details={...(window.FirebaseBootstrap.details||{}),warning:'SYNC_UNAVAILABLE'};
    bootstrapLog('sync prepared',{degraded:true});
  }
  window.lucide?.createIcons();
  dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{uid:user.uid,businessId:profile.businessId,business,access:context.access}}));
  bootstrapLog('completed',{businessId:profile.businessId});
}
async function updateBusinessDetails(values={}){
  const session=window.FirebaseSession;
  if(!session?.user?.uid||!session.businessId)throw Error('A sessão da empresa não está disponível.');
  if(session.profile?.role!=='owner')throw Error('Somente o proprietário pode editar os dados da empresa.');
  const patch={name:String(values.name||'').trim(),phone:String(values.phone||'').trim(),businessType:String(values.businessType||'').trim(),updatedAt:serverTimestamp()};
  if(!patch.name)throw Error('Informe o nome do negócio.');
  await setDoc(doc(db,'businesses',session.businessId),patch,{merge:true});
  const business={...session.business,...patch,updatedAt:new Date().toISOString()};
  BusinessContext.set({business,userProfile:session.profile});
  DB.alterar(data=>{data.config.nome=patch.name;data.config.telefone=patch.phone});
  return business;
}
async function updateProfileDetails(values={}){
  const session=window.FirebaseSession;
  if(!session?.user?.uid||!session.profile)throw Error('A sessão do usuário não está disponível.');
  const patch={name:String(values.name||'').trim(),phone:String(values.phone||'').trim(),updatedAt:serverTimestamp()};
  if(!patch.name)throw Error('Informe seu nome.');
  await setDoc(doc(db,'users',session.user.uid),patch,{merge:true});
  const profile={...session.profile,...patch,updatedAt:new Date().toISOString()};
  BusinessContext.set({business:session.business,userProfile:profile});
  document.querySelector('.avatar').textContent=(profile.name||session.user.email||'A')[0].toUpperCase();
  return profile;
}
async function sendPasswordReset(){
  const email=auth.currentUser?.email;
  if(!email)throw Error('Não foi possível identificar o e-mail desta conta.');
  await sendPasswordResetEmail(auth,email);
  return true;
}
function logoutConfirmation(){
  const root=document.querySelector('#modal'),pending=Number(window.SyncFirebase?.getFirebaseDiagnostic?.().pendingOperations||0);
  if(!root){
    if(confirm('Sair da conta? Você poderá entrar novamente quando desejar.'))return bootstrapLogout();
    return Promise.resolve(false);
  }
  root.innerHTML=`<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Sair da conta?</h3><button class="icon-btn" type="button" data-logout-cancel aria-label="Cancelar"><i data-lucide="x"></i></button></header><div class="modal-body confirm-copy"><div class="confirm-icon" style="background:#e8faf6;color:#078d73"><i data-lucide="log-out"></i></div><p>Você poderá entrar novamente quando desejar.</p>${pending?`<div class="backup-warning"><b>${pending} alteração(ões) continuarão salvas na fila desta empresa.</b><br>Nenhuma informação será descartada.</div>`:''}</div><footer class="modal-foot"><button class="btn btn-light" type="button" data-logout-cancel>Cancelar</button><button class="btn btn-primary" type="button" id="confirm-account-logout">Sair</button></footer></section></div>`;
  root.querySelectorAll('[data-logout-cancel]').forEach(button=>button.onclick=()=>root.innerHTML='');
  root.querySelector('#confirm-account-logout').onclick=async event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='Saindo…';await bootstrapLogout()};
  window.lucide?.createIcons();
  return Promise.resolve(false);
}
async function logout(force=false){
  if(!force)return logoutConfirmation();
  return bootstrapLogout();
}

async function bootstrapCore(user,token,mode){
  setBootstrapState('loading_profile',{mode});
  bootstrapLog('profile loading');
  screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Validando seu ambiente…</p><button class="btn btn-light" id="bootstrap-loading-logout" type="button">Sair da conta</button></section>');
  document.querySelector('#bootstrap-loading-logout').onclick=bootstrapLogout;
  const profileRef=doc(db,'users',user.uid),profileSnapshot=await getDoc(profileRef);
  assertCurrentRun(token);
  if(!profileSnapshot.exists()){
    setBootstrapState('onboarding_required');
    bootstrapLog('profile loaded',{profileFound:false});
    return unauthorized(user,'Não existe um perfil em users/{UID} para esta conta. Seu cadastro pode ter sido iniciado sem concluir a empresa.',Boolean(localStorage.getItem(pendingKey(user.uid))),'Perfil não encontrado');
  }
  let profile=profileSnapshot.data();
  bootstrapLog('profile loaded',{profileFound:true,businessId:profile.businessId||'',role:profile.role||'',active:profile.active===true});
  const validation=profileValidationInfo({authUser:user,profileSnapshotId:profileSnapshot.id,profile});
  if(isDevelopment())console.info('[Profile Validation]',validation);
  const profileAccess=validateAuthenticatedProfile({authUser:user,profileSnapshotId:profileSnapshot.id,profile});
  if(!profile.uid&&profile.businessId!==LEGACY_BUSINESS_ID)profile={...profile,uid:user.uid};
  setBootstrapState('loading_business',{businessId:profile.businessId});
  bootstrapLog('business loading',{businessId:profile.businessId});
  const businessSnapshot=await getDoc(doc(db,'businesses',profile.businessId));
  assertCurrentRun(token);
  if(!businessSnapshot.exists())throw Object.assign(new Error('A empresa vinculada ao perfil não foi encontrada.'),{code:'business/not-found',details:{authUid:user.uid,profileDocumentId:profileSnapshot.id,businessId:profile.businessId}});
  let business={id:businessSnapshot.id,...businessSnapshot.data()};
  bootstrapLog('business loaded',{businessId:business.id});
  const businessAccess=validateAuthenticatedBusiness({authUser:user,profile,businessId:businessSnapshot.id,business});
  if(profile.businessId===LEGACY_BUSINESS_ID){
    if(!profileAccess.isLegacyAdiFestaOwnerCandidate||!businessAccess.isLegacyAdiFestaOwner){
      throw Object.assign(new Error('A conta não atende aos critérios seguros da migração legada.'),{code:'permission-denied'});
    }
    setBootstrapState('migration_required',{mode,businessId:profile.businessId});
    screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Concluindo a configuração segura da Adi Festa…</p><button class="btn btn-light" id="bootstrap-loading-logout" type="button">Sair da conta</button></section>');
    document.querySelector('#bootstrap-loading-logout').onclick=bootstrapLogout;
    ({profile,business}=await migrateLegacy(user,profile,business,mode));
    assertCurrentRun(token);
  }
  bootstrapLog('migration checked',{businessId:profile.businessId});
  setBootstrapState('loading_access',{businessId:profile.businessId});
  allowed(user,profile,business);
  bootstrapLog('subscription resolved',{planId:window.FirebaseSession?.subscription?.planId||'fallback',status:window.FirebaseSession?.subscription?.status||'fallback'});
  bootstrapLog('permissions resolved',{role:profile.role});
  if(bootstrapState==='ready')readyUid=user.uid;
}
function handleBootstrapError(user,error){
  const code=normalizedCode(error);
  if(code==='bootstrap/cancelled')return;
  try{BusinessContext.fail(error)}catch(contextError){console.warn('[Bootstrap optional module]',{module:'business-context-error-state',code:normalizedCode(contextError)||'STATE_ERROR'})}
  console.error('[Bootstrap] failed',{step:bootstrapState,code:code||'unknown',message:error?.message,stack:isDevelopment()?error?.stack:undefined});
  if(code==='resource-exhausted'){
    return bootstrapErrorScreen(user,'temporary_unavailable','O serviço de nuvem atingiu temporariamente o limite de uso. Seus dados locais continuam preservados.',{details:{code:'QUOTA_EXCEEDED'}});
  }
  if(['bootstrap/timeout','unavailable','deadline-exceeded','network-request-failed'].includes(code)){
    return bootstrapErrorScreen(user,'temporary_unavailable',code==='bootstrap/timeout'?'A validação ultrapassou o limite de 15 segundos. Verifique sua conexão e tente novamente. Nenhum dado foi perdido.':'Não foi possível conectar ao Firebase agora. Tente novamente em alguns instantes. Nenhum dado foi perdido.',{details:{code:code==='bootstrap/timeout'?'BOOTSTRAP_TIMEOUT':'SYNC_UNAVAILABLE'}});
  }
  if(['permission-denied','unauthenticated'].includes(code)){
    return bootstrapErrorScreen(user,'permission_error',error.message||'Sua conta não possui permissão para concluir esta configuração.',{title:'Permissão negada',manual:Boolean(error.allowManual),details:{...error.details,code}});
  }
  const specific={
    'profile/document-mismatch':['UID divergente','O documento do perfil não corresponde à conta autenticada.'],
    'profile/uid-mismatch':['UID divergente','O campo UID salvo no perfil pertence a outra conta. A correção automática foi bloqueada.'],
    'profile/uid-missing':['UID ausente','Este perfil não é elegível para a compatibilidade legada.'],
    'profile/email-mismatch':['E-mail divergente','O e-mail do perfil não corresponde ao e-mail autenticado.'],
    'profile/business-mismatch':['Empresa divergente','O perfil não possui a empresa esperada.'],
    'profile/role-mismatch':['Permissão divergente','A função cadastrada não permite administrar a empresa legada.'],
    'profile/inactive':['Usuário inativo','Este usuário está inativo e não pode acessar a empresa.'],
    'business/id-mismatch':['Empresa divergente','A empresa carregada não corresponde à empresa do perfil.'],
    'business/not-found':['Empresa divergente','A empresa vinculada ao perfil não foi encontrada.'],
    'business/inactive':['Empresa inativa','A empresa vinculada está inativa.'],
    'business/owner-mismatch':['Proprietário divergente','O proprietário registrado na empresa não corresponde à conta autenticada.'],
    'business/subscription-mismatch':['Configuração divergente','A assinatura interna existente possui dados incompatíveis e não será substituída automaticamente.']
  }[code];
  if(specific){
    const state=code.startsWith('profile/')?'profile_error':code.startsWith('business/')?'business_error':'permission_error';
    return bootstrapErrorScreen(user,state,specific[1],{title:specific[0],manual:Boolean(error.allowManual)&&['migration/required','migration/failed'].includes(code),details:{...error.details,code}});
  }
  if(code==='migration/already-attempted'||code==='migration/failed')return bootstrapErrorScreen(user,'migration_required','A migração não foi concluída nesta sessão. Seus dados permanecem preservados.',{manual:true,title:'Migração pendente',details:{...error.details,code:'MIGRATION_FAILED'}});
  return bootstrapErrorScreen(user,'fatal_error','Ocorreu um erro inesperado durante a configuração. Nenhum dado foi apagado.',{details:{...error.details,code:code||'FATAL_ERROR'}});
}
function startBootstrap(user,{mode='automatic'}={}){
  if(!user){setBootstrapState('unauthenticated');login();return Promise.resolve()}
  if(readyUid===user.uid&&bootstrapState==='ready')return Promise.resolve(window.FirebaseSession);
  if(bootstrapRun?.uid===user.uid)return bootstrapRun.promise;
  if(mode==='automatic'&&automaticBootstrapAttempts.has(user.uid))return Promise.resolve();
  if(mode==='automatic')automaticBootstrapAttempts.add(user.uid);
  const token={sequence:++bootstrapSequence,cancelled:false},run={uid:user.uid,token,promise:null};
  setBootstrapState('initializing',{mode});
  bootstrapLog('started',{mode});
  bootstrapLog('auth resolved',{authenticated:Boolean(user)});
  run.promise=withTimeout(bootstrapCore(user,token,mode),token)
    .catch(error=>{
      try{return handleBootstrapError(user,error)}
      catch(handlerError){
        console.error('[Bootstrap] failed',{step:'error_handler',code:normalizedCode(handlerError)||'HANDLER_ERROR',message:handlerError?.message,stack:isDevelopment()?handlerError?.stack:undefined});
        return bootstrapErrorScreen(user,'fatal_error','Não foi possível apresentar o erro original com segurança. Nenhum dado foi apagado.',{details:{code:'ERROR_HANDLER_FAILED'}});
      }
    })
    .finally(()=>{
      if(bootstrapRun===run)bootstrapRun=null;
      if(token.sequence===bootstrapSequence&&NON_TERMINAL_STATES.has(bootstrapState)){
        bootstrapErrorScreen(user,'fatal_error','A validação foi interrompida antes de ser concluída. Tente novamente. Nenhum dado foi perdido.',{details:{code:'BOOTSTRAP_INCOMPLETE'}});
      }
      document.querySelector('.auth-loading')?.classList.remove('auth-loading');
    });
  bootstrapRun=run;
  return run.promise;
}

window.LegacyMigrationAdmin={
  migrationVersion:LEGACY_MIGRATION_VERSION,
  complete:completeLegacyMigrationManually,
  state:()=>({bootstrapState,inProgress:Boolean(bootstrapRun),readyUid:readyUid?`${readyUid.slice(0,6)}…`:''})
};
screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Verificando acesso…</p></section>');
window.FirebaseRuntimeMetrics={...(window.FirebaseRuntimeMetrics||{}),activeAuthObservers:1};
onAuthStateChanged(auth,user=>{
  try{window.SyncFirebase.setAuthReady(true)}catch(error){console.warn('[Bootstrap optional module]',{module:'sync-auth-ready',code:normalizedCode(error)||'SYNC_UNAVAILABLE'})}
  if(!user){
    bootstrapSequence++;if(bootstrapRun?.token)bootstrapRun.token.cancelled=true;bootstrapRun=null;readyUid='';
    automaticBootstrapAttempts.clear();
    setBootstrapState('unauthenticated');return login();
  }
  startBootstrap(user,{mode:'automatic'});
});
