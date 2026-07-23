import {auth,db,LEGACY_BUSINESS_ID} from './firebase-config.js?v=41';
import {createUserWithEmailAndPassword,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {doc,getDoc,serverTimestamp,setDoc,Timestamp,writeBatch} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {APP_NAME,BusinessContext,INTERNAL_BUSINESS_ID,PLANS,SubscriptionService} from './business-context.js?v=41';
import './sync.js?v=41';

const gate=document.querySelector('#auth-gate'),OWNER_EMAIL='murillo.charles97@gmail.com',PENDING_PREFIX='adiFesta:onboarding:';
const businessTypes=['Mercearia','Doceria','Conveniência','Papelaria','Loja de festas','Lanchonete','Loja de roupas','Comércio geral','Outro'];
const registerState={step:1,data:{name:'',phone:'',email:'',password:'',confirm:'',businessName:'',businessType:'Doceria',businessPhone:'',city:'',state:'SP',document:''}};
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const friendly=code=>({'auth/invalid-email':'Informe um e-mail válido.','auth/email-already-in-use':'Este e-mail já possui uma conta. Entre com sua senha.','auth/weak-password':'Use uma senha mais forte, com pelo menos 6 caracteres.','auth/user-not-found':'E-mail ou senha incorretos.','auth/wrong-password':'E-mail ou senha incorretos.','auth/invalid-credential':'E-mail ou senha incorretos.','auth/user-disabled':'Esta conta está desativada.','auth/too-many-requests':'Muitas tentativas. Aguarde e tente novamente.','auth/network-request-failed':'Não foi possível conectar. Verifique sua internet.','permission-denied':'A operação foi bloqueada pelas regras de segurança.','resource-exhausted':'O limite temporário do Firebase foi atingido. Tente novamente mais tarde.'}[String(code||'').replace('firestore/','')]||'Não foi possível concluir agora. Tente novamente.');
const slugify=value=>String(value||'negocio').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,42)||'negocio';
const businessIdFor=user=>`biz_${user.uid}`;
const pendingKey=uid=>`${PENDING_PREFIX}${uid}`;
function screen(html){gate.innerHTML=html;gate.hidden=false;document.documentElement.classList.add('auth-pending');window.lucide?.createIcons()}
function setButtonLoading(button,loading,text){if(!button)return;button.disabled=loading;if(text)button.textContent=text}

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

async function migrateLegacy(user,profile,business){
  if(profile.businessId!==LEGACY_BUSINESS_ID)return{profile,business};
  const profilePatch={},businessPatch={};
  if(!profile.uid)profilePatch.uid=user.uid;
  if(profile.role==='admin')profilePatch.role='owner';
  if(!Array.isArray(profile.permissions))profilePatch.permissions=[];
  if(!business.slug)businessPatch.slug='adi-festa';
  if(business.onboardingCompleted!==true)businessPatch.onboardingCompleted=true;
  if(!business.businessType)businessPatch.businessType='Doceria';
  if(!business.subscription)businessPatch.subscription={planId:'internal',status:'active',trialStartedAt:null,trialEndsAt:null,currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null};
  if(!business.limits)businessPatch.limits={maxUsers:999,maxProducts:999999,maxClients:999999,maxMonthlySales:999999,users:999,products:999999,clients:999999,monthlySales:999999,catalogEnabled:true,campaignsEnabled:true};
  if(Object.keys(profilePatch).length){profile={...profile,...profilePatch};await setDoc(doc(db,'users',user.uid),{...profilePatch,updatedAt:serverTimestamp()},{merge:true}).catch(error=>console.warn('[Legacy profile migration pending]',error.code))}
  if(Object.keys(businessPatch).length){business={...business,...businessPatch};await setDoc(doc(db,'businesses',LEGACY_BUSINESS_ID),{...businessPatch,updatedAt:serverTimestamp()},{merge:true}).catch(error=>console.warn('[Legacy business migration pending]',error.code))}
  return{profile,business};
}

function downloadBackup(){
  const backup=DB.criarBackup(),link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  link.href=url;link.download=`backup-${backup.businessId}-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function plansScreen(authenticated=true){
  const plans=SubscriptionService.plans();
  screen(`<section class="auth-card auth-plans-card"><div class="auth-logo">AF</div><h1>Escolha seu plano</h1><p>O pagamento será integrado em uma próxima etapa.</p><div class="auth-plan-list">${plans.filter(plan=>plan.id!=='trial').map(plan=>`<article class="${plan.recommended?'recommended':''}"><small>${plan.recommended?'RECOMENDADO':''}</small><h2>${plan.name}</h2><b>${plan.monthlyPrice.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}<em>/mês</em></b><ul><li>${plan.limits.clients} clientes</li><li>${plan.limits.products} produtos</li><li>${plan.features.onlineCatalog?'Catálogo online':'Controle de vendas'}</li></ul><button class="btn btn-primary" data-plan="${plan.id}">Selecionar</button></article>`).join('')}</div><button class="btn btn-light" data-plans-back>${authenticated?'Voltar':'Voltar para entrar'}</button></section>`);
  document.querySelectorAll('[data-plan]').forEach(button=>button.onclick=async()=>{const result=await SubscriptionService.createCheckoutSession(button.dataset.plan);Utils.toast(result.message)});
  document.querySelector('[data-plans-back]').onclick=()=>authenticated?resolveAuthenticatedUser(auth.currentUser):login();
}
function blockedScreen(user,context){
  const trial=context.access?.reason==='trial_expired';
  screen(`<section class="auth-card auth-blocked-card"><div class="auth-logo">AF</div><h1>${trial?'Seu período de teste terminou':'Acesso temporariamente indisponível'}</h1><p>${trial?'Seus dados continuam salvos. Escolha um plano para voltar a criar vendas e cadastros.':'Entre em contato com o responsável pela conta.'}</p><button class="btn btn-primary" data-blocked-plans>Ver planos</button><button class="btn btn-light" data-export-data>Exportar meus dados</button><button class="btn btn-light" data-blocked-logout>Sair da conta</button></section>`);
  document.querySelector('[data-blocked-plans]').onclick=()=>plansScreen(true);
  document.querySelector('[data-export-data]').onclick=downloadBackup;
  document.querySelector('[data-blocked-logout]').onclick=()=>logout(true);
}
function unauthorized(user,message,canResume=false){
  screen(`<section class="auth-card"><div class="auth-logo">AF</div><h1>Acesso não configurado</h1><p>${esc(message)}</p>${canResume?'<button class="btn btn-primary" id="resume-onboarding">Retomar criação da empresa</button>':''}<button class="btn btn-light" id="logout-unauthorized">Sair da conta</button></section>`);
  document.querySelector('#resume-onboarding')?.addEventListener('click',async()=>{const saved=JSON.parse(localStorage.getItem(pendingKey(user.uid))||'null');if(!saved)return login('Os dados do cadastro não estão mais neste aparelho.');try{await provisionBusinessAccount(user,saved);localStorage.removeItem(pendingKey(user.uid));location.reload()}catch(error){unauthorized(user,friendly(error.code),true)}});
  document.querySelector('#logout-unauthorized').onclick=()=>logout(true);
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
  window.FirebaseAuthActions={signOut:logout};
  if(!context.access.canAccessApp)return blockedScreen(user,context);
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
async function logout(force=false){
  let pending=window.SyncFirebase.getFirebaseDiagnostic().pendingOperations;
  if(!force&&!pending&&!confirm('Deseja realmente sair desta conta?'))return false;
  if(pending&&navigator.onLine){try{await window.SyncFirebase.synchronizeNow()}catch(error){console.error('[Sync before logout]',error)}}
  pending=window.SyncFirebase.getFirebaseDiagnostic().pendingOperations;
  if(!force&&pending&&!confirm(`Existem ${pending} alterações ainda não sincronizadas.\nElas permanecem isoladas nesta empresa.\n\nDeseja sair mesmo assim?`))return false;
  const session=window.FirebaseSession;
  if(session?.businessId&&session?.user?.uid){const id=`logout_${crypto.randomUUID()}`;await setDoc(doc(db,'businesses',session.businessId,'auditLogs',id),{id,businessId:session.businessId,type:'logout',actorId:session.user.uid,createdAt:serverTimestamp()}).catch(()=>{})}
  window.SyncFirebase.stop();badgeSubscription?.();badgeSubscription=null;BusinessContext.clear();DB.releaseBusiness();window.FirebaseSession=null;document.querySelector('#app').innerHTML='';location.hash='#/inicio';
  screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Saindo da conta…</p></section>');
  await signOut(auth);return true;
}

async function resolveAuthenticatedUser(user){
  if(!user)return login();
  screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Validando seu ambiente…</p></section>');
  try{
    const profileRef=doc(db,'users',user.uid),profileSnapshot=await getDoc(profileRef);
    if(!profileSnapshot.exists())return unauthorized(user,'Seu cadastro foi iniciado, mas a empresa ainda não foi configurada.',Boolean(localStorage.getItem(pendingKey(user.uid))));
    let profile=profileSnapshot.data();
    if(profile.uid!==user.uid)return unauthorized(user,'O perfil cadastrado não corresponde a esta conta.');
    if(profile.active!==true)return unauthorized(user,'Sua conta está desativada.');
    if(!profile.businessId)return unauthorized(user,'Esta conta não possui uma empresa vinculada.');
    const businessSnapshot=await getDoc(doc(db,'businesses',profile.businessId));
    if(!businessSnapshot.exists())return unauthorized(user,'A empresa vinculada ao seu perfil não existe.');
    let business={id:businessSnapshot.id,...businessSnapshot.data()};
    if(business.active===false)return unauthorized(user,'Esta empresa está suspensa.');
    ({profile,business}=await migrateLegacy(user,profile,business));
    await setDoc(profileRef,{lastLoginAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true}).catch(()=>{});
    allowed(user,profile,business);
  }catch(error){console.error('[Firebase auth context]',{code:error.code,message:error.message});BusinessContext.fail(error);unauthorized(user,friendly(error.code))}
}

screen('<section class="auth-card auth-loading"><div class="auth-logo">AF</div><p>Verificando acesso…</p></section>');
onAuthStateChanged(auth,user=>{window.SyncFirebase.setAuthReady(true);resolveAuthenticatedUser(user)});
