(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.FinancialInstitutionCard=api.card;root.FinancialAccountsCarousel=api.carousel;}
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number((v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const icon=n=>`<i data-lucide="${n}" aria-hidden="true"></i>`;
  function present(group,engine){
    const accounts=group.accounts||[],cards=group.cards||[];
    const onlyInvestment=accounts.length>0&&accounts.every(a=>engine.normalizeFinancialAccountType(a.type)==='investment_account');
    const cash=accounts.length>0&&accounts.every(a=>engine.normalizeFinancialAccountType(a.type)==='cash_wallet');
    const invoices=cards.map(c=>c.currentInvoice).filter(i=>i&&i.status!=='cancelled');
    const paid=invoices.length>0&&invoices.every(i=>i.status==='paid');
    const open=invoices.filter(i=>i.status!=='paid'&&Number(i.remainingCents??i.amountDueCents)>0);
    const due=open.map(i=>engine.localDate(i.dueDate)).filter(Boolean).sort((a,b)=>a-b)[0]||null;
    const today=engine.localDay(new Date()),days=due&&today?Math.round((engine.localDay(due)-today)/86400000):null;
    const limitsKnown=cards.length>0&&cards.every(c=>known(c.limitCents)&&Number(c.limitCents)>0&&known(c.committedCents)&&Number(c.committedCents)>=0);
    const limit=limitsKnown?cards.reduce((n,c)=>n+Number(c.limitCents),0):null;
    const used=limitsKnown?cards.reduce((n,c)=>n+Number(c.committedCents),0):null;
    const available=cards.length>0&&cards.every(c=>known(c.availableCents))?cards.reduce((n,c)=>n+Number(c.availableCents),0):null;
    const name=String(group.name||'Instituição'),initials=name.replace(/\b(banco|bank)\b/ig,'').trim().slice(0,2).toUpperCase()||'FI';
    const tone=/inter/i.test(name)?'amber':/c6/i.test(name)?'slate':/nubank/i.test(name)?'violet':'teal';
    return{key:group.key,name,initials,tone,hasAccount:accounts.length>0,hasCard:cards.length>0,
      kind:accounts.length&&cards.length?'Conta + Cartão':cards.length?(cards.length===1?'Cartão':`${cards.length} cartões`):onlyInvestment?'Investimento':cash?'Carteira / dinheiro':accounts.length===1?'Conta bancária':`${accounts.length} contas`,
      primaryLabel:onlyInvestment?'Patrimônio registrado':accounts.length?'Saldo disponível':paid?'Fatura paga':'Fatura atual',
      primaryCents:onlyInvestment?accounts.reduce((n,a)=>n+engine.financialAccountBalance(a),0):accounts.length?group.availableBalanceCents:group.invoiceTotalCents,
      investmentNote:onlyInvestment?'Disponibilidade conforme configuração da conta.':null,
      invoiceCents:group.invoiceTotalCents,invoiceLabel:paid?'Fatura paga':'Fatura atual',hasInvoice:invoices.length>0,due,days,limit,used,available,
      percentage:limitsKnown?Math.round(used/limit*100):null,
      identification:cards.map(c=>`${c.name||'Cartão'}${c.last4?` •••• ${String(c.last4).slice(-4)}`:''}`).join(' · ')};
  }
  function cardMarkup(group,engine,index,total){
    const p=present(group,engine),date=p.due?p.due.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.',''):'—';
    return `<div class="vac-slide" data-carousel-key="${esc(p.key)}" role="group" aria-roledescription="slide" aria-label="${index+1} de ${total}: ${esc(p.name)}" tabindex="-1"><article class="financial-institution-card vac-card">
      <header><span class="vac-bank vac-${p.tone}">${esc(p.initials)}</span><div><h3>${esc(p.name)}</h3><small>${esc(p.kind)}</small></div><button type="button" data-vac-action="menu" aria-label="Ações de ${esc(p.name)}">${icon('ellipsis-vertical')}</button></header>
      <div class="vac-primary"><small>${p.primaryLabel}</small><strong>${money(p.primaryCents)}</strong>${p.investmentNote?`<span>${p.investmentNote}</span>`:''}</div>
      ${p.hasCard?`<div class="vac-invoice">${p.hasAccount?`<div><small>${p.invoiceLabel}</small><b>${money(p.invoiceCents)}</b></div>`:`<div><small>Situação</small><b>${!p.hasInvoice?'Sem fatura':p.invoiceLabel==='Fatura paga'?'Paga':p.days!==null&&p.days<0?'Vencida':'Em aberto'}</b></div>`}<div><small>${p.due?'Vencimento':'Neste ciclo'}</small><b>${p.due?esc(date):p.hasInvoice?p.invoiceLabel==='Fatura paga'?'Paga':'—':'Sem fatura'}</b></div></div>`:''}
      ${p.limit!==null?`<div class="vac-limit"><div><span>${p.hasCard&&group.cards.length>1?'Limites somados':'Limite utilizado'}</span><b>${p.percentage}%</b></div><div class="vac-limit-track" role="meter" aria-label="Limite utilizado" aria-valuenow="${Math.min(100,p.percentage)}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${esc(money(p.used)+' de '+money(p.limit))}"><i style="width:${Math.min(100,p.percentage)}%"></i></div><small>${money(p.used)} de ${money(p.limit)}</small></div>`:p.available!==null?`<p class="vac-available">Limite disponível <b>${money(p.available)}</b></p>`:''}
      ${p.days!==null&&p.days<=7?`<small class="vac-due ${p.days<0?'is-overdue':''}">${p.days<0?'Fatura vencida':p.days===0?'Vence hoje':`Vence em ${p.days} dia${p.days===1?'':'s'}`}</small>`:''}
      <footer><span title="${esc(p.identification)}">${esc(p.identification||p.kind)}</span><button type="button" data-vac-action="details">Ver detalhes ${icon('arrow-right')}</button></footer>
    </article></div>`;
  }
  const memory={scope:'',key:''};let dispose=()=>{};
  const nearest=(centers,position)=>centers.reduce((best,c,i)=>Math.abs(c-position)<Math.abs(centers[best]-position)?i:best,0);
  function easing(t){
    let low=0,high=1,u=t;
    for(let n=0;n<14;n++){u=(low+high)/2;const x=3*(1-u)*(1-u)*u*.2+3*(1-u)*u*u*.2+u*u*u;if(x<t)low=u;else high=u;}
    return t===0?0:t===1?1:3*(1-u)*(1-u)*u*.8+3*(1-u)*u*u+u*u*u;
  }
  function render(groups,engine){
    if(!groups.length)return `<div class="vac-empty">${icon('landmark')}<b>Adicione sua primeira conta ou cartão</b><button type="button" class="btn btn-light" data-financial-add-product>Adicionar conta ou cartão</button></div>`;
    return `<div class="veconi-accounts-carousel ${groups.length===1?'is-single':''}" role="region" aria-roledescription="carrossel" aria-label="Contas e cartões"><div class="financial-institution-carousel vac-track">${groups.map((g,i)=>cardMarkup(g,engine,i,groups.length)).join('')}</div>${groups.length>1?`<nav class="vac-navigation" aria-label="Navegação de instituições"><button type="button" data-vac-prev aria-label="Instituição anterior">${icon('chevron-left')}</button><div class="vac-pagination">${groups.length<=5?groups.map((g,i)=>`<button type="button" data-vac-page="${i}" aria-label="Centralizar ${esc(g.name)}"></button>`).join(''):''}<span data-vac-status aria-live="polite" aria-atomic="true"></span></div><button type="button" data-vac-next aria-label="Próxima instituição">${icon('chevron-right')}</button></nav>`:''}</div>`;
  }
  function mount(root,{scope='',onDetails=()=>{},onMenu=()=>{}}={}){
    dispose();if(!root)return;
    const track=root.querySelector('.vac-track'),slides=[...root.querySelectorAll('.vac-slide')],abort=new AbortController(),signal=abort.signal;
    if(memory.scope!==scope){memory.scope=scope;memory.key='';}
    let active=Math.max(0,slides.findIndex(s=>s.dataset.carouselKey===memory.key)),timer,frame,animation,drag=null,suppressUntil=0;
    const centers=()=>slides.map(s=>s.offsetLeft+s.offsetWidth/2-track.clientWidth/2);
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    function update(index){
      active=index;memory.key=slides[index].dataset.carouselKey;
      slides.forEach((s,i)=>{s.classList.toggle('is-active',i===index);s.classList.toggle('is-neighbor',Math.abs(i-index)===1);s.setAttribute('aria-current',i===index?'true':'false');s.tabIndex=i===index?0:-1;s.querySelectorAll('button').forEach(b=>b.tabIndex=i===index?0:-1);});
      root.querySelectorAll('[data-vac-page]').forEach((b,i)=>b.setAttribute('aria-current',i===index?'true':'false'));
      const status=root.querySelector('[data-vac-status]');if(status)status.textContent=`${index+1} de ${slides.length}`;
      const prev=root.querySelector('[data-vac-prev]'),next=root.querySelector('[data-vac-next]');if(prev)prev.disabled=index===0;if(next)next.disabled=index===slides.length-1;
    }
    function go(index,animate=true){
      cancelAnimationFrame(animation);clearTimeout(timer);index=Math.max(0,Math.min(slides.length-1,index));
      const from=track.scrollLeft,to=centers()[index];update(index);
      if(!animate||reduced()||Math.abs(from-to)<1){track.classList.remove('is-moving');track.scrollLeft=to;return;}
      track.classList.add('is-moving');const start=performance.now();
      const tick=now=>{const t=Math.min(1,(now-start)/300);track.scrollLeft=from+(to-from)*easing(t);if(t<1)animation=requestAnimationFrame(tick);else{track.classList.remove('is-moving');track.scrollLeft=to;update(index);}};
      animation=requestAnimationFrame(tick);
    }
    track.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!track.classList.contains('is-moving'))update(nearest(centers(),track.scrollLeft));});clearTimeout(timer);timer=setTimeout(()=>{if(!drag&&!track.classList.contains('is-moving'))go(nearest(centers(),track.scrollLeft));},140);},{passive:true,signal});
    root.addEventListener('click',e=>{const slide=e.target.closest('.vac-slide');if(performance.now()<suppressUntil){e.preventDefault();return;}if(slide){const i=slides.indexOf(slide);if(i!==active){e.preventDefault();go(i);return;}const action=e.target.closest('[data-vac-action]')?.dataset.vacAction;if(action==='details')onDetails(slide.dataset.carouselKey);if(action==='menu')onMenu(slide.dataset.carouselKey);return;}if(e.target.closest('[data-vac-prev]'))go(active-1);if(e.target.closest('[data-vac-next]'))go(active+1);const dot=e.target.closest('[data-vac-page]');if(dot)go(Number(dot.dataset.vacPage));},{signal});
    root.addEventListener('keydown',e=>{const index=({ArrowLeft:active-1,ArrowRight:active+1,Home:0,End:slides.length-1})[e.key];if(index!==undefined){e.preventDefault();go(index);slides[active].focus({preventScroll:true});}},{signal});
    track.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;cancelAnimationFrame(animation);track.classList.remove('is-moving');drag={id:e.pointerId,x:e.clientX,left:track.scrollLeft,moved:false};},{signal});
    track.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const delta=e.clientX-drag.x;if(Math.abs(delta)>6&&!drag.moved){drag.moved=true;track.setPointerCapture(e.pointerId);track.classList.add('is-dragging');}if(drag.moved){e.preventDefault();track.scrollLeft=drag.left-delta;}},{signal});
    const finish=()=>{if(!drag)return;const moved=drag.moved;drag=null;track.classList.remove('is-dragging');if(moved){suppressUntil=performance.now()+350;go(nearest(centers(),track.scrollLeft));}};
    track.addEventListener('pointerup',finish,{signal});track.addEventListener('pointercancel',finish,{signal});track.addEventListener('lostpointercapture',finish,{signal});
    track.ownerDocument.addEventListener('pointerup',finish,{signal});
    const observer=new ResizeObserver(()=>go(active,false));observer.observe(track);go(active,false);
    dispose=()=>{abort.abort();observer.disconnect();clearTimeout(timer);cancelAnimationFrame(frame);cancelAnimationFrame(animation);};
  }
  return{card:{present,render:cardMarkup},carousel:{render,mount,destroy:()=>{dispose();dispose=()=>{};}},nearest,easing};
});
