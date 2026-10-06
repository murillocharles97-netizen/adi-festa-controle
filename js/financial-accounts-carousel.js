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
  const presets=Object.freeze({Laranja:'#c64e00',Preto:'#242424',Roxo:'#7522b5',Azul:'#125bbb',Verde:'#087a60',Vermelho:'#b3233d',Grafite:'#465361',Claro:'#edf3ff'});
  const colorValue=v=>/^#[0-9a-f]{6}$/i.test(String(v))?String(v).toLowerCase():null;
  const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
  const luminance=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const shade=(c,f)=>'#'+rgb(c).map(v=>Math.round(v*f).toString(16).padStart(2,'0')).join('');
  function appearance(group){
    const resources=[...(group.accounts||[]),...(group.cards||[])];
    const stored=group.presentation || resources.find(r=>r.presentation)?.presentation || {};
    // Exact normalized keys only: "interior" must never be mistaken for Inter.
    const keys=[...new Set(resources.map(r=>r.institutionKey).filter(Boolean))];
    const key=keys.length===1?keys[0]:group.key;
    const defaults={inter:presets.Laranja,banco_inter:presets.Laranja,c6:presets.Preto,c6_bank:presets.Preto,nubank:presets.Roxo,nu_pagamentos:presets.Roxo,carrefour:presets.Claro,banco_carrefour:presets.Claro};
    const color=colorValue(stored.color)||defaults[key]||presets.Verde;
    let end=stored.gradientVariant==='solid'?color:shade(color,luminance(color)>.5?.96:.86);
    let text=contrast(color,'#ffffff')>=contrast(color,'#10243d')?'#ffffff':'#10243d';
    // Guarantee AA contrast across BOTH gradient endpoints; prefer a solid
    // background over an unreadable user-selected combination.
    if(Math.min(contrast(color,text),contrast(end,text))<4.5){end=color;text=contrast(color,'#ffffff')>=contrast(color,'#000000')?'#ffffff':'#000000';}
    return {displayName:String(stored.displayName||'').slice(0,80),color,end,text,gradientVariant:stored.gradientVariant==='solid'?'solid':'gradient'};
  }
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
    const style=appearance(group),name=style.displayName||String(group.name||'Instituição'),initials=String(group.name||name).replace(/\b(banco|bank)\b/ig,'').trim().slice(0,2).toUpperCase()||'FI';
    return{key:group.key,name,initials,style,hasAccount:accounts.length>0,hasCard:cards.length>0,
      kind:accounts.length&&cards.length?'Conta + Cartão':cards.length?(cards.length===1?'Cartão':`${cards.length} cartões`):onlyInvestment?'Investimento':cash?'Carteira / dinheiro':accounts.length===1?'Conta bancária':`${accounts.length} contas`,
      primaryLabel:onlyInvestment?'Patrimônio registrado':accounts.length?'Saldo disponível':paid?'Fatura paga':'Fatura atual',
      primaryCents:onlyInvestment?accounts.reduce((n,a)=>n+engine.financialAccountBalance(a),0):accounts.length?group.availableBalanceCents:group.invoiceTotalCents,
      investmentNote:onlyInvestment?'Disponibilidade conforme configuração da conta.':null,
      invoiceCents:group.invoiceTotalCents,invoiceLabel:paid?'Fatura paga':'Fatura atual',hasInvoice:invoices.length>0,due,days,limit,used,available,
      percentage:limitsKnown?Math.round(used/limit*100):null,
      nickname:cards.map(c=>c.presentation?.cardNickname).filter(Boolean).join(' · '),
      identification:cards.map(c=>`${c.name||'Cartão'}${c.last4?` •••• ${String(c.last4).slice(-4)}`:''}`).join(' · '),
      footer:cards.map(c=>`${c.brand?String(c.brand)+' ':''}${c.last4?'•••• '+String(c.last4).slice(-4):c.presentation?.cardNickname||c.name||'Cartão'}`).join(' · ')};
  }
  function cardMarkup(group,engine,index,total){
    const p=present(group,engine),date=p.due?p.due.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.',''):'—';
    return `<div class="vac-slide" data-carousel-key="${esc(p.key)}" data-logical-index="${index}" role="group" aria-roledescription="slide" aria-label="${index+1} de ${total}: ${esc(p.name)}" tabindex="-1"><article class="financial-institution-card vac-card" style="--vac-bg:${p.style.color};--vac-end:${p.style.end};--vac-ink:${p.style.text}">
      <span class="vac-watermark" aria-hidden="true">${esc(p.initials)}</span>
      <header><span class="vac-bank">${esc(p.initials)}</span><div><h3 title="${esc(p.name)}">${esc(p.name)}</h3><small>${esc(p.kind)}</small></div>${group.canCustomize?`<button type="button" class="vac-pencil" data-vac-action="appearance" aria-label="Personalizar ${esc(p.name)}">${icon('pencil')}</button>`:''}<button type="button" data-vac-action="menu" aria-label="Ações de ${esc(p.name)}">${icon('ellipsis-vertical')}</button></header>
      ${p.nickname?`<span class="vac-nickname" title="${esc(p.nickname)}">${esc(p.nickname)}</span>`:''}
      <div class="vac-primary"><small>${p.primaryLabel}</small><strong>${!p.hasAccount&&!p.hasInvoice?'Sem fatura':money(p.primaryCents)}</strong>${p.investmentNote?`<span>${p.investmentNote}</span>`:''}</div>
      ${p.hasCard&&(p.hasInvoice||p.hasAccount)?`<div class="vac-invoice">${p.hasAccount?`<div><small>${p.hasInvoice?p.invoiceLabel:'Cartão'}</small><b>${p.hasInvoice?money(p.invoiceCents):'Sem fatura'}</b></div>`:''}${p.hasInvoice?`<div><small>${p.due?'Vence em':'Situação'}</small><b>${p.due?esc(date):p.invoiceLabel==='Fatura paga'?'Paga':'Em aberto'}</b></div>`:''}</div>`:''}
      ${p.limit!==null?`<div class="vac-limit"><div><span>${p.hasCard&&group.cards.length>1?'Limites somados':'Limite utilizado'}</span><b>${p.percentage}%</b></div><div class="vac-limit-track" role="meter" aria-label="Limite utilizado" aria-valuenow="${Math.min(100,p.percentage)}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${esc(money(p.used)+' de '+money(p.limit))}"><i style="width:${Math.min(100,p.percentage)}%"></i></div><small>${money(p.used)} de ${money(p.limit)}</small></div>`:p.available!==null?`<p class="vac-available">Limite disponível <b>${money(p.available)}</b></p>`:''}
      ${p.days!==null&&p.days<=7?`<small class="vac-due ${p.days<0?'is-overdue':''}">${p.days<0?'Fatura vencida':p.days===0?'Vence hoje':`Vence em ${p.days} dia${p.days===1?'':'s'}`}</small>`:''}
      <footer><span title="${esc(p.identification)}">${esc(p.footer||p.kind)}</span><button type="button" data-vac-action="details">Ver detalhes ${icon('arrow-right')}</button></footer>
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
    const count=groups.length,pad=count===1?0:Math.ceil(6/count)*count;
    const content=Array.from({length:count+pad*2},(_,i)=>{const logical=mod(i-pad,count);return cardMarkup(groups[logical],engine,logical,count);}).join('');
    return `<div class="veconi-accounts-carousel ${count===1?'is-single':''}" data-count="${count}" data-pad="${pad}" role="region" aria-roledescription="carrossel" aria-label="Contas e cartões"><div class="financial-institution-carousel vac-track">${content}</div>${count>1?`<nav class="vac-navigation" aria-label="Navegação de instituições"><button type="button" data-vac-prev aria-label="Instituição anterior">${icon('chevron-left')}</button><div class="vac-pagination">${count<=5?groups.map((g,i)=>`<button type="button" data-vac-page="${i}" aria-label="Centralizar ${esc(g.name)}"></button>`).join(''):''}<span data-vac-status aria-live="polite" aria-atomic="true"></span></div><button type="button" data-vac-next aria-label="Próxima instituição">${icon('chevron-right')}</button></nav>`:''}</div>`;
  }
  const mod=(value,count)=>((value%count)+count)%count;
  function mount(root,{scope='',onDetails=()=>{},onMenu=()=>{},onAppearance=()=>{}}={}){
    dispose();if(!root)return;
    const track=root.querySelector('.vac-track'),slides=[...root.querySelectorAll('.vac-slide')],abort=new AbortController(),signal=abort.signal;
    if(memory.scope!==scope){memory.scope=scope;memory.key='';}
    const count=Number(root.dataset.count),pad=Number(root.dataset.pad),logical=i=>mod(i-pad,count);
    let active=pad+Math.max(0,slides.slice(pad,pad+count).findIndex(s=>s.dataset.carouselKey===memory.key)),timer,frame,animation,rebaseFrame,drag=null,suppressUntil=0;
    const centers=()=>slides.map(s=>s.offsetLeft+s.offsetWidth/2-track.clientWidth/2);
    const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    function update(index){
      active=index;memory.key=slides[index].dataset.carouselKey;
      slides.forEach((s,i)=>{s.classList.toggle('is-active',i===index);s.classList.toggle('is-neighbor',Math.abs(i-index)===1);s.setAttribute('aria-current',i===index?'true':'false');s.setAttribute('aria-hidden',i===index?'false':'true');s.tabIndex=i===index?0:-1;s.querySelectorAll('button').forEach(b=>b.tabIndex=i===index?0:-1);});
      root.querySelectorAll('[data-vac-page]').forEach((b,i)=>b.setAttribute('aria-current',i===logical(index)?'true':'false'));
      const status=root.querySelector('[data-vac-status]');if(status)status.textContent=`${logical(index)+1} de ${count}`;
    }
    function rebase(){
      if(!pad||active>=pad&&active<pad+count)return;
      const target=pad+logical(active),delta=centers()[target]-centers()[active];
      const focused=slides[active].contains(track.ownerDocument.activeElement);
      track.classList.add('is-rebasing');update(target);track.scrollLeft+=delta;
      if(drag)drag.left+=delta;
      if(focused)slides[active].focus({preventScroll:true});
      // Equivalent visual copies exchange places in the SAME paint. Disabling
      // transitions here prevents the newly active copy growing from side scale.
      void track.offsetWidth;cancelAnimationFrame(rebaseFrame);
      rebaseFrame=requestAnimationFrame(()=>track.classList.remove('is-rebasing'));
    }
    const nearestLogical=index=>slides.reduce((best,s,i)=>logical(i)===index&&Math.abs(i-active)<Math.abs(best-active)?i:best,pad+index);
    function go(index,animate=true){
      cancelAnimationFrame(animation);clearTimeout(timer);
      if(pad&&(index<3||index>slides.length-4)){const previous=active;rebase();index+=active-previous;}
      index=Math.max(0,Math.min(slides.length-1,index));
      const from=track.scrollLeft,to=centers()[index];update(index);
      if(!animate||reduced()||Math.abs(from-to)<1){track.classList.remove('is-moving');track.scrollLeft=to;rebase();return;}
      track.classList.add('is-moving');const start=performance.now();
      const tick=now=>{const t=Math.min(1,(now-start)/300);track.scrollLeft=from+(to-from)*easing(t);if(t<1)animation=requestAnimationFrame(tick);else{track.classList.remove('is-moving');track.scrollLeft=to;update(index);rebase();}};
      animation=requestAnimationFrame(tick);
    }
    track.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!track.classList.contains('is-moving')){update(nearest(centers(),track.scrollLeft));if(pad&&(active<3||active>slides.length-4))rebase();}});clearTimeout(timer);timer=setTimeout(()=>{if(!drag&&!track.classList.contains('is-moving'))go(nearest(centers(),track.scrollLeft));},140);},{passive:true,signal});
    root.addEventListener('click',e=>{const slide=e.target.closest('.vac-slide');if(performance.now()<suppressUntil){e.preventDefault();return;}if(slide){const i=slides.indexOf(slide);if(i!==active){e.preventDefault();go(i);return;}const action=e.target.closest('[data-vac-action]')?.dataset.vacAction;if(action==='details')onDetails(slide.dataset.carouselKey);if(action==='menu')onMenu(slide.dataset.carouselKey);if(action==='appearance')onAppearance(slide.dataset.carouselKey);return;}if(e.target.closest('[data-vac-prev]'))go(active-1);if(e.target.closest('[data-vac-next]'))go(active+1);const dot=e.target.closest('[data-vac-page]');if(dot)go(nearestLogical(Number(dot.dataset.vacPage)));},{signal});
    root.addEventListener('keydown',e=>{const index=({ArrowLeft:active-1,ArrowRight:active+1,Home:nearestLogical(0),End:nearestLogical(count-1)})[e.key];if(index!==undefined){e.preventDefault();go(index);slides[active].focus({preventScroll:true});}},{signal});
    track.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'||e.button!==0)return;cancelAnimationFrame(animation);track.classList.remove('is-moving');drag={id:e.pointerId,x:e.clientX,left:track.scrollLeft,moved:false};},{signal});
    track.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const delta=e.clientX-drag.x;if(Math.abs(delta)>6&&!drag.moved){drag.moved=true;track.setPointerCapture(e.pointerId);track.classList.add('is-dragging');}if(drag.moved){e.preventDefault();track.scrollLeft=drag.left-delta;}},{signal});
    const finish=()=>{if(!drag)return;const moved=drag.moved;drag=null;track.classList.remove('is-dragging');if(moved){suppressUntil=performance.now()+350;go(nearest(centers(),track.scrollLeft));}};
    track.addEventListener('pointerup',finish,{signal});track.addEventListener('pointercancel',finish,{signal});track.addEventListener('lostpointercapture',finish,{signal});
    track.ownerDocument.addEventListener('pointerup',finish,{signal});
    const observer=new ResizeObserver(()=>go(active,false));observer.observe(track);go(active,false);
    dispose=()=>{abort.abort();observer.disconnect();clearTimeout(timer);cancelAnimationFrame(frame);cancelAnimationFrame(animation);cancelAnimationFrame(rebaseFrame);};
  }
  return{card:{present,render:cardMarkup,appearance,presets,contrast},carousel:{render,mount,destroy:()=>{dispose();dispose=()=>{};}},nearest,easing,mod};
});
