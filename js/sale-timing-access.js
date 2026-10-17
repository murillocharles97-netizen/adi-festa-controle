import {requestsSaleTiming, permitsSaleTiming} from './sale-timing-policy.js?v=178';

// The URL is only a request, never an authorization. No work for normal users.
if (requestsSaleTiming(location)) {
  let generation=0,lease=null,api=null,panel=null,timer=null;
  const revoke=()=>{
    generation++;lease=null;clearTimeout(timer);api?.clear();api=null;
    delete window.VeconiSaleTiming;panel?.remove();panel=null;
  };
  const valid=()=>Boolean(lease && Date.now()<lease.until && requestsSaleTiming(location) &&
    lease.auth.currentUser?.uid===lease.uid &&
    window.FirebaseSession?.user?.uid===lease.uid &&
    permitsSaleTiming(lease.uid,{...window.FirebaseSession?.business,id:window.FirebaseSession?.businessId},window.FirebaseSession?.member));
  function render() {
    if(!panel||!api)return;
    const report=api.report(),trace=report.traces[0],active=report.enabled;
    panel.querySelector('[data-timing-status]').textContent=trace
      ? trace.outcome==='running'?'Coletando esta venda. Não repita o envio.':`Coleta encerrada (${trace.outcome}). Exporte antes de sair ou recarregar.`
      : active?'Coleta ativa: aguardando uma única venda com Fiado.':'Desativado. Somente tempos por etapa, mantidos na memória.';
    panel.querySelector('[data-timing-enable]').disabled=active||Boolean(trace)||!valid();
    panel.querySelector('[data-timing-export]').disabled=!trace||!valid();
  }
  async function authorize() {
    revoke();
    const run=generation,session=window.FirebaseSession;
    if(session?.businessId!=='adi-festa'||!session.user?.uid)return;
    try {
      const {auth,db}=await import('./firebase/firebase-config.js');
      const {doc,getDocFromServer}=await import('./firebase/workspace-firestore.js');
      const uid=auth.currentUser?.uid;
      if(!uid||uid!==session.user.uid)return;
      // Server-only reads, only with the flag; no cached/local role grants access.
      const [business,member]=await Promise.all([
        getDocFromServer(doc(db,'businesses','adi-festa')),
        getDocFromServer(doc(db,'businesses','adi-festa','members',uid))
      ]);
      if(run!==generation||auth.currentUser?.uid!==uid||!business.exists()||!member.exists()||
        !permitsSaleTiming(uid,{...business.data(),id:business.id},member.data()))return;
      const {createSaleTiming}=await import('./sale-timing.js?v=178');
      if(run!==generation||auth.currentUser?.uid!==uid)return;
      lease={uid,auth,until:Date.now()+30*60*1000};
      api=createSaleTiming({isAuthorized:valid,onChange:()=>queueMicrotask(render)});
      window.VeconiSaleTiming=api;
      panel=document.createElement('section');panel.className='sale-timing-panel';
      panel.setAttribute('aria-label','Diagnóstico temporário de Fiado');
      panel.innerHTML='<strong>Diagnóstico temporário de Fiado</strong><p data-timing-status role="status"></p><div><button class="btn btn-light" type="button" data-timing-enable>Ativar uma coleta</button><button class="btn btn-light" type="button" data-timing-export disabled>Exportar tempos</button><button class="btn btn-light" type="button" data-timing-stop>Desativar e apagar coleta</button></div>';
      const style=document.createElement('link');style.rel='stylesheet';style.href='./css/sale-timing.css?v=178';panel.append(style);
      document.querySelector('#app')?.before(panel);
      panel.querySelector('[data-timing-enable]').onclick=()=>{if(valid())api.enable();render()};
      panel.querySelector('[data-timing-export]').onclick=()=>{if(valid()&&api.download())api.disable();render()};
      panel.querySelector('[data-timing-stop]').onclick=()=>{revoke();const url=new URL(location.href);url.searchParams.delete('fiado-timing');history.replaceState(null,'',url.pathname+url.search+url.hash)};
      timer=setTimeout(revoke,30*60*1000);
      render();
    } catch {
      // Fail closed; never log server errors/payloads or interfere with Auth/Sync.
      if(run===generation)revoke();
    }
  }
  addEventListener('firebase-auth-ready',()=>{void authorize()});
  addEventListener('firebase-session-cleared',revoke);
  addEventListener('business-context-changed',()=>{if(api&&!valid())revoke()});
  if(window.FirebaseSession?.user)void authorize();
}
