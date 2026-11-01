(function () {
  'use strict';
  const P=window.VeconiPermissionPolicy;
  let revision=0,pending=null,snapshot=null,failedAt=0,error='',timer=null,loadedAt=0;
  const context=()=>window.BusinessContext?.get?.()||{};
  const member=()=>{const c=context();return c.member||{role:c.role,permissionsVersion:c.userProfile?.permissionsVersion||1,permissions:Object.fromEntries((c.permissions||[]).map(k=>[k,true]))};};
  const zone=()=>{if(context().business?.timezone)return context().business.timezone;try{return window.DB?.carregar?.()?.config?.timezone||'America/Sao_Paulo';}catch{return 'America/Sao_Paulo';}};
  const history=()=>window.TeamAccess?.has?.('performance.history')===true;
  const daily=()=>window.TeamAccess?.has?.('performance.daily')===true;
  const restricted=()=>!history();
  const day=()=>P.dayKey(new Date(),zone());
  const scope=()=>{const c=context();return JSON.stringify([c.businessId,c.userProfile?.uid,window.FirebaseSession?.user?.uid,c.role,c.loading,c.error,c.member,c.permissions,c.spaceAccess,c.allowedSpaceIds,c.business?.workspaceGeneration??0,zone(),day(),window.SpaceContext?.homeId?.()||'all_spaces']);};
  const recordAllowed=(record,field='data')=>{
    const c=context(),sid=record?.spaceId||record?.financialSpaceId;
    if(c.loading||c.error||record?.businessId&&record.businessId!==c.businessId||c.spaceAccess!=='all'&&c.role!=='owner'&&!(c.allowedSpaceIds||[]).includes(sid))return false;
    return P.visiblePerformanceRecord(member(),record,new Date(),zone(),field);
  };
  const filter=(rows=[],field='data')=>rows.filter(row=>recordAllowed(row,field));
  const notify=()=>window.dispatchEvent(new CustomEvent('performance-access-updated'));
  const invalidate=()=>{revision++;pending=null;snapshot=null;error='';failedAt=0;loadedAt=0;clearTimeout(timer);timer=null;};
  function state(){
    if(snapshot?.key!==scope())return{ready:false,busy:!!pending,error};
    // An offline or stale value is never labelled as today's canonical total.
    return{ready:navigator.onLine!==false&&Date.now()-loadedAt<60000,busy:!!pending,error,value:snapshot.value};
  }
  async function refresh({force=false}={}){
    if(!daily()||!restricted())return state();
    const c=context(),uid=window.FirebaseSession?.user?.uid,key=scope();
    if(c.loading||c.error||!uid||uid!==c.userProfile?.uid||!c.businessId)return state();
    if(pending?.key===key)return pending.promise;
    if(!force&&snapshot?.key===key&&Date.now()-loadedAt<30000)return state();
    if(!force&&failedAt&&Date.now()-failedAt<15000)return state();
    if(navigator.onLine===false){error='Conecte-se para confirmar as vendas e a meta do dia.';return state();}
    const epoch=++revision;error='';
    const promise=(async()=>{
      try{
        const response=await Promise.resolve().then(()=>window.FirebaseCallable('getDailySalesPerformance',{businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0,spaceId:window.SpaceContext?.homeId?.()||'all_spaces'}));
        if(epoch!==revision||key!==scope()||!daily()||!restricted())return state();
        const data=response?.data;
        if(data?.businessId!==c.businessId||data.workspaceGeneration!==(c.business?.workspaceGeneration??0)||data.day!==day()||data.timezone!==zone()||data.scope!=='daily'||data.source!=='canonical'||!Number.isSafeInteger(data.revenueCents)||!Number.isSafeInteger(data.saleCount)||data.saleCount<0||!Number.isSafeInteger(data.goalCents)||data.goalCents<0||!Array.isArray(data.spaceIds)||c.role!=='owner'&&c.spaceAccess!=='all'&&data.spaceIds.some(id=>!c.allowedSpaceIds?.includes(id)))throw Error('A consulta não corresponde ao acesso e ao dia atuais.');
        snapshot={key,value:structuredClone(data)};loadedAt=Date.now();failedAt=0;
      }catch(e){if(epoch===revision&&key===scope()){snapshot=null;error=e.code==='functions/permission-denied'?'Seu acesso às vendas do dia mudou. Solicite ao gestor que confira suas permissões.':e.message||'Não foi possível confirmar o dia. Tente novamente.';failedAt=Date.now();}}
      finally{if(epoch===revision){pending=null;notify();}}
      return state();
    })();
    pending={key,promise};notify();return promise;
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function render(){
    const c=context(),s=state(),v=s.ready?s.value:null,contextBar=window.SpaceContext?.renderBar?.('home')||'';
    if(!daily())return `<section class="daily-performance" data-daily-performance>${contextBar}<header><span>SEU ESPAÇO DE TRABALHO</span><h1>Pronto para atender</h1><p>Seu acesso às operações continua conforme as permissões da empresa.</p></header>${window.TeamAccess?.has?.('sales.create')?'<button class="btn btn-primary" data-daily-sell>Registrar venda</button>':''}<p>Os indicadores de desempenho não estão disponíveis neste perfil.</p></section>`;
    const progress=v&&v.goalCents>0?Math.max(0,Math.min(100,v.progressPercent)):0;
    return `<section class="daily-performance" data-daily-performance>${contextBar}<header><span>HOJE · ${esc(day().split('-').reverse().join('/'))}</span><h1>Vamos alcançar a meta de hoje</h1><p>Vendas da loja nos espaços autorizados. Todos os operadores.</p></header><div class="daily-performance-grid"><article class="daily-performance-total"><span>Vendido hoje</span><strong>${v?money(v.revenueCents):'—'}</strong><small>${v?`${v.saleCount} venda${v.saleCount===1?'':'s'} no dia`:'Aguardando consulta do dia'}</small></article><article class="daily-performance-goal"><header><span>Meta diária</span><strong>${v&&v.goalCents?Math.round(v.progressPercent)+'%':'—'}</strong></header><b>${v&&v.goalCents?money(v.goalCents):v?'Meta ainda não definida':'—'}</b><div role="progressbar" aria-label="Progresso da meta do dia" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${progress}%"></i></div><p>${v&&v.goalCents?(v.remainingCents>0?'Faltam '+money(v.remainingCents)+' para atingir a meta.':'Meta atingida!'):'A meta é definida pelo gestor.'}</p></article></div><div class="daily-performance-status" role="status"><span>${esc(s.error||(v?'Valores confirmados às '+new Date(v.asOf).toLocaleTimeString('pt-BR',{timeZone:v.timezone,hour:'2-digit',minute:'2-digit'})+' · '+v.timezone:s.busy?'Consultando as vendas do dia…':'Conecte-se para consultar os valores atuais.'))}</span><button type="button" class="btn btn-light" data-daily-refresh ${s.busy?'disabled':''}>${s.busy?'Consultando…':'Atualizar'}</button></div>${window.TeamAccess?.has?.('sales.create')?'<button type="button" class="btn btn-primary daily-performance-sell" data-daily-sell>Registrar venda</button>':''}</section>`;
  }
  function repaint(){
    const page=document.querySelector('[data-daily-performance]');if(!page)return;
    page.outerHTML=render();bind(false);
  }
  function bind(auto=true){
    const page=document.querySelector('[data-daily-performance]');if(!page)return;
    page.querySelector('[data-daily-refresh]')?.addEventListener('click',()=>{void refresh({force:true});repaint();});
    page.querySelectorAll('[data-daily-sell]').forEach(b=>b.onclick=()=>window.Router?.ir?.('vender'));
    window.SpaceContext?.bind?.(page);
    if(auto&&!pending)void refresh();
    if(!timer)timer=setTimeout(()=>{timer=null;if(!document.querySelector('[data-daily-performance]'))return;if(snapshot?.key!==scope())invalidate();repaint();void refresh();},30000);
  }
  const resetView=()=>{invalidate();const page=document.querySelector('[data-daily-performance], [data-desktop-dashboard], .mobile-home-dashboard, .analytics-page');if(!page)return;if(restricted()){page.outerHTML=render();bind();}else if(page.matches('[data-daily-performance]')){const mobile=window.MobileHome?.isMobile?.();page.outerHTML=mobile?window.MobileHome.render():window.DesktopDashboard.render();(mobile?window.MobileHome:window.DesktopDashboard).bind();}};
  ['business-context-changed','firebase-session-cleared','firebase-auth-ready','veconi-space-context-changed','veconi-spaces-ready'].forEach(event=>addEventListener(event,resetView));
  addEventListener('performance-access-updated',repaint);
  ['cloud-data-updated','online','visibilitychange'].forEach(event=>addEventListener(event,()=>{if(document.querySelector('[data-daily-performance]')&&document.visibilityState!=='hidden'){void refresh({force:event==='online'});repaint();}}));
  addEventListener('offline',()=>{repaint();});
  window.PerformanceAccess=Object.freeze({daily,history,restricted,recordAllowed,filter,scope,day,zone,state,refresh,render,bind,invalidate});
})();
