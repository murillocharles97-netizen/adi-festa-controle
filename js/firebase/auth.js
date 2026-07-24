import {auth,db,LEGACY_BUSINESS_ID} from './firebase-config.js?v=42';
import {createUserWithEmailAndPassword,onAuthStateChanged,sendPasswordResetEmail,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {doc,getDoc,serverTimestamp,setDoc,Timestamp,writeBatch} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {APP_NAME,BusinessContext,INTERNAL_BUSINESS_ID,PLANS,SubscriptionService} from './business-context.js?v=42';
import {LEGACY_MIGRATION_VERSION,resetLegacyMigrationAttempt,runLegacyMigration} from './legacy-migration.js?v=42';
import {abbreviateTechnicalId,profileValidationInfo,validateAuthenticatedBusiness,validateAuthenticatedProfile} from './profile-validation.js?v=44';
import './sync.js?v=42';

const gate=document.querySelector('#auth-gate'),PENDING_PREFIX='adiFesta:onboarding:',BOOTSTRAP_TIMEOUT_MS=15000;
const BOOTSTRAP_STATES=new Set(['unauthenticated','migrating','ready','onboarding','subscription_blocked','temporary_unavailable','permission_error','fatal_error']);
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
function timeoutError(){return Object.assign(new Error('O bootstrap excedeu 15 segundos.'),{code:'bootstrap/timeout'})}
function withTimeout(promise,token){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{token.cancelled=true;reject(timeoutError())},BOOTSTRAP_TIMEOUT_MS)});
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
function assertCurrentRun(token){if(token.cancelled||token.sequence!==bootstrapSequence)throw Object.assign(new Error('Bootstrap substituído por uma nova tentativa.'),{code:'bootstrap/cancelled'})}

function login(message=''){
  screen(`<section class="auth-card auth-entry-card"><div class="auth-logo">AF</div><h1>${APP_NAME}</h1><p>Controle seu negócio com segurança, de qualquer aparelho.</p><form id="login-form"><label>E-mail<input name="email" type="email" autocomplete="email" required inputmode="email"></label><label>Senha<div class="password-field"><input name="password" type="password" autocomplete="current-password" required><button type="button" id="toggle-password" aria-label="Mostrar senha">👁</button></div></label><p class="auth-error" id="auth-error">${esc(message)}</p><button class="btn btn-primary" id="login-submit">Entrar</button><button class="btn btn-light" type="button" id="show-register">Criar minha conta</button><button class="auth-link" type="button" data-show-plans>Conhecer planos</button></form></section>`);
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
  const business={id:businessId,slug,name:String(data.businessName).trim(),legalName:'',document:String(data.document||''),phone:String(data.businessPhone||data.phone||''),email:user.email,ownerId:user.uid,active:true,onboardingCompleted:true,businessType:String(data.businessType||'Comércio geral'),city:String(data.city||''),state:String(data.state||'').toUpperCase(),createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now),subscription:{planId:'trial',status:'trial',trialStartedAt:Timestamp.fromDate(now),trialEndsAt:Timestamp.fromDate(trialEnd),currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null},limits:{maxUsers:1,maxProducts:plan.limits.products,maxClients:plan.limits.clients,maxMonthlySales:plan.limits.monthlySales,users:1,products:plan.limits.products,clients:plan.limits.clients,monthlySales:plan.limits.monthlySales,catalogEnabled:true,campaignsEnabled:true}};
  batch.set(doc(db,'businesses',businessId),business);
  batch.set(profileRef,profile);
  batch.set(doc(db,'businesses',businessId,'settings','default'),{id:'default',businessId,nome:business.name,businessName:business.name,receiptName:business.name,telefone:business.phone,currency:'BRL',timezone:'America/Sao_Paulo',onboardingStep:1,createdAt:Timestamp.fromDate(now),updatedAt:Timestamp.fromDate(now)});
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
  const plans=SubscriptionService.plans();
  screen(`<section class="auth-card auth-plans-card"><div class="auth-logo">AF</div><h1>Escolha seu plano</h1><p>O pagamento será integrado em uma próxima etapa.</p><div class="auth-plan-list">${plans.filter(plan=>plan.id!=='trial').map(plan=>`<article class="${plan.recommended?'recommended':''}"><small>${plan.recommended?'RECOMENDADO':''}</small><h2>${plan.name}</h2><b>${plan.monthlyPrice.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}<em>/mês</em></b><ul><li>${plan.limits.clients} clientes</li><li>${plan.limits.products} produtos</li><li>${plan.features.onlineCatalog?'Catálogo online':'Controle de vendas'}</li></ul><button class="btn btn-primary" data-plan="${plan.id}">Selecionar</button></article>`).join('')}</div><button class="btn btn-light" data-plans-back>${authenticated?'Voltar':'Voltar para entrar'}</button></section>`);
  document.querySelectorAll('[data-plan]').forEach(button=>button.onclick=async()=>{const result=await SubscriptionService.createCheckoutSession(button.dataset.plan);Utils.toast(result.message)});
  document.querySelector('[data-plans-back]').onclick=()=>authenticated?startBootstrap(auth.currentUser,{mode:'retry'}):login();
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
    ['UID autenticado',details.authUid],
    ['Documento do perfil',details.profileDocumentId],
    ['UID salvo no perfil',details.profileUid],
    ['Proprietário da empresa',details.ownerId]
  ].filter(([,value])=>value);
  if(!rows.length)return'';
  return `<div class="auth-review">${rows.map(([label,value])=>`<span><small>${esc(label)}</small><b>${esc(abbreviateTechnicalId(value))}</b></span>`).join('')}</div><p><small>Por segurança, um UID divergente nunca é corrigido automaticamente. Confirme no Firebase Authentication e em users/{UID} qual conta é a proprietária, ou encaminhe estes identificadores abreviados ao administrador.</small></p>`;
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
  try{window.SyncFirebase?.stop?.()}catch{}
  try{badgeSubscription?.()}catch{}badgeSubscription=null;
  BusinessContext.clear();DB.releaseBusiness();window.FirebaseSession=null;window.SyncFirebaseState=null;window.FirebaseAuthActions={signOut:bootstrapLogout};
  try{sessionStorage.removeItem('adiFestaMessagePendingReturn_v1')}catch{}
  delete window.CheckoutPaymentMethod;
  document.querySelector('#app').innerHTML='';
  document.querySelector('#modal').innerHTML='';
  location.hash='#/inicio';
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
function updateCloudBadge(syncState){const badge=document.querySelector('.local-badge');if(!badge)return;const count=Number(syncState.queueTotal||0),map=syncState.status==='error'?['cloud-off','Nuvem','error']:syncState.status==='offline'?['cloud-off','Nuvem','offline']:['testing','waiting','syncing'].includes(syncState.status)?['refresh-cw','Nuvem','syncing']:syncState.testPassed&&syncState.status==='success'?['cloud-check','Nuvem','success']:['cloud','Nuvem','idle'];const[icon,text,status]=map;badge.dataset.syncStatus=status;badge.setAttribute('role','button');badge.setAttribute('tabindex','0');badge.setAttribute('aria-label',`${text}. ${count} alterações pendentes`);badge.innerHTML=`<i data-lucide="${icon}"></i> ${text}${count?`<b class="cloud-count">${count}</b>`:''}`;window.lucide?.createIcons()}
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
function allowed(user,profile,business){
  const context=BusinessContext.set({business,userProfile:profile});
  DB.useBusiness(profile.businessId,{migrateLegacy:profile.businessId===INTERNAL_BUSINESS_ID});
  if(profile.businessId!==INTERNAL_BUSINESS_ID)DB.alterar(data=>{if(!data.config.nome||data.config.nome==='Adi Festa')data.config.nome=business.name;if(!data.config.telefone&&business.phone)data.config.telefone=business.phone});
  window.FirebaseSession={user,profile,businessId:profile.businessId,business:context.business,subscription:context.subscription,access:context.access};
  window.FirebaseAuthActions={signOut:logout,updateBusiness:updateBusinessDetails,updateProfile:updateProfileDetails,sendPasswordReset};
  if(!context.access.canAccessApp){setBootstrapState('subscription_blocked',{businessId:profile.businessId});return blockedScreen(user,context)}
  setBootstrapState('ready',{businessId:profile.businessId});
  window.SyncFirebase.setUser(user,profile);
  gate.hidden=true;document.documentElement.classList.remove('auth-pending');
  document.querySelector('.avatar').textContent=(profile.name||user.email||'A')[0].toUpperCase();
  document.querySelectorAll('[data-business-name]').forEach(node=>node.textContent=business.name);
  document.querySelector('.brand-sub')?.replaceChildren(document.createTextNode(business.name));
  const topbar=document.querySelector('.topbar'),oldPlan=topbar?.querySelector('.subscription-badge');oldPlan?.remove();
  if(topbar){const plan=PLANS[context.subscription?.planId]||PLANS.trial,badge=document.createElement('span');badge.className='subscription-badge';badge.textContent=context.subscription?.status==='trial'?`Teste · ${context.access.daysRemaining} dia(s)`:plan.name;topbar.insertBefore(badge,document.querySelector('.local-badge'))}
  badgeSubscription?.();badgeSubscription=window.SyncFirebase.subscribe(updateCloudBadge);
  window.lucide?.createIcons();
  dispatchEvent(new CustomEvent('firebase-auth-ready',{detail:{uid:user.uid,businessId:profile.businessId,business,access:context.access}}));
  setTimeout(()=>showFirstBusinessOnboarding(context),350);
  const loginAuditId=`login_${crypto.randomUUID()}`;setDoc(doc(db,'businesses',profile.businessId,'auditLogs',loginAuditId),{id:loginAuditId,businessId:profile.businessId,type:'login',actorId:user.uid,createdAt:serverTimestamp()}).catch(()=>{});
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
  setBootstrapState('migrating',{mode});
  screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Validando seu ambiente…</p><button class="btn btn-light" id="bootstrap-loading-logout" type="button">Sair da conta</button></section>');
  document.querySelector('#bootstrap-loading-logout').onclick=bootstrapLogout;
  const profileRef=doc(db,'users',user.uid),profileSnapshot=await getDoc(profileRef);
  assertCurrentRun(token);
  if(!profileSnapshot.exists()){
    setBootstrapState('onboarding');
    return unauthorized(user,'Não existe um perfil em users/{UID} para esta conta. Seu cadastro pode ter sido iniciado sem concluir a empresa.',Boolean(localStorage.getItem(pendingKey(user.uid))),'Perfil não encontrado');
  }
  let profile=profileSnapshot.data();
  const validation=profileValidationInfo({authUser:user,profileSnapshotId:profileSnapshot.id,profile});
  if(isDevelopment())console.info('[Profile Validation]',validation);
  const profileAccess=validateAuthenticatedProfile({authUser:user,profileSnapshotId:profileSnapshot.id,profile});
  const businessSnapshot=await getDoc(doc(db,'businesses',profile.businessId));
  assertCurrentRun(token);
  if(!businessSnapshot.exists())throw Object.assign(new Error('A empresa vinculada ao perfil não foi encontrada.'),{code:'business/not-found',details:{authUid:user.uid,profileDocumentId:profileSnapshot.id,businessId:profile.businessId}});
  let business={id:businessSnapshot.id,...businessSnapshot.data()};
  const businessAccess=validateAuthenticatedBusiness({authUser:user,profile,businessId:businessSnapshot.id,business});
  if(profile.businessId===LEGACY_BUSINESS_ID){
    if(!profileAccess.isLegacyAdiFestaOwnerCandidate||!businessAccess.isLegacyAdiFestaOwner){
      throw Object.assign(new Error('A conta não atende aos critérios seguros da migração legada.'),{code:'permission-denied'});
    }
    screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Concluindo a configuração segura da Adi Festa…</p><button class="btn btn-light" id="bootstrap-loading-logout" type="button">Sair da conta</button></section>');
    document.querySelector('#bootstrap-loading-logout').onclick=bootstrapLogout;
    ({profile,business}=await migrateLegacy(user,profile,business,mode));
    assertCurrentRun(token);
  }
  setDoc(profileRef,{lastLoginAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true}).catch(error=>console.warn('[Firebase Bootstrap] last login pending',{code:normalizedCode(error)}));
  allowed(user,profile,business);
  if(['ready','subscription_blocked'].includes(bootstrapState))readyUid=user.uid;
}
function handleBootstrapError(user,error){
  const code=normalizedCode(error);
  if(code==='bootstrap/cancelled')return;
  BusinessContext.fail(error);
  console.error('[Firebase Bootstrap]',{code:code||'unknown',state:bootstrapState});
  if(code==='resource-exhausted'){
    return bootstrapErrorScreen(user,'temporary_unavailable','Não foi possível concluir a configuração da sua empresa porque o Firebase atingiu temporariamente o limite de uso. Aguarde a renovação da cota e tente novamente. Nenhum dado foi perdido.',{manual:true});
  }
  if(['bootstrap/timeout','unavailable','deadline-exceeded','network-request-failed'].includes(code)){
    return bootstrapErrorScreen(user,'temporary_unavailable',code==='bootstrap/timeout'?'A validação ultrapassou o limite de 15 segundos. Verifique sua conexão e tente novamente. Nenhum dado foi perdido.':'Não foi possível conectar ao Firebase agora. Tente novamente em alguns instantes. Nenhum dado foi perdido.',{manual:user?.uid&&Boolean(localStorage.getItem(`adiFestaDB_v1:${LEGACY_BUSINESS_ID}`))});
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
  if(specific)return bootstrapErrorScreen(user,'permission_error',specific[1],{title:specific[0],manual:Boolean(error.allowManual),details:{...error.details,code}});
  return bootstrapErrorScreen(user,'fatal_error','Ocorreu um erro inesperado durante a configuração. Nenhum dado foi apagado.',{manual:Boolean(error.allowManual),details:{...error.details,code}});
}
function startBootstrap(user,{mode='automatic'}={}){
  if(!user){setBootstrapState('unauthenticated');login();return Promise.resolve()}
  if(readyUid===user.uid&&['ready','subscription_blocked'].includes(bootstrapState))return Promise.resolve(window.FirebaseSession);
  if(bootstrapRun?.uid===user.uid)return bootstrapRun.promise;
  if(mode==='automatic'&&automaticBootstrapAttempts.has(user.uid))return Promise.resolve();
  if(mode==='automatic')automaticBootstrapAttempts.add(user.uid);
  const token={sequence:++bootstrapSequence,cancelled:false},run={uid:user.uid,token,promise:null};
  run.promise=withTimeout(bootstrapCore(user,token,mode),token)
    .catch(error=>handleBootstrapError(user,error))
    .finally(()=>{
      if(bootstrapRun===run)bootstrapRun=null;
      if(token.sequence===bootstrapSequence&&bootstrapState==='migrating'){
        bootstrapErrorScreen(user,'fatal_error','A validação foi interrompida antes de ser concluída. Tente novamente. Nenhum dado foi perdido.',{manual:true});
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
onAuthStateChanged(auth,user=>{
  window.SyncFirebase.setAuthReady(true);
  if(!user){
    bootstrapSequence++;if(bootstrapRun?.token)bootstrapRun.token.cancelled=true;bootstrapRun=null;readyUid='';
    automaticBootstrapAttempts.clear();
    setBootstrapState('unauthenticated');return login();
  }
  startBootstrap(user,{mode:'automatic'});
});
