(function(){
  'use strict';
  const M=window.PerformanceModel;
  const state={period:'30d',spaceId:'all',start:'',end:'',identity:'',key:'',rows:null,next:null,complete:false,busy:false,error:'',asOf:null,request:0,last:null};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const num=v=>Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const has=key=>window.TeamAccess?.has?.(key)===true;
  const context=()=>window.BusinessContext?.get?.()||{};
  function identity(){const c=context();return JSON.stringify([c.businessId,c.userProfile?.uid||window.FirebaseSession?.user?.uid,c.business?.workspaceGeneration??0,c.permissionSignature,c.permissions,c.allowedSpaceIds,c.spaceAccess]);}
  function reset(){state.request++;Object.assign(state,{key:'',rows:null,next:null,complete:false,busy:false,error:'',asOf:null});}
  function setup(){
    const id=identity();if(state.identity!==id){reset();Object.assign(state,{identity:id,period:'30d',spaceId:'all',start:'',end:''});}
    const c=context(),spaces=(window.SpaceContext?.list?.()||[]).filter(s=>(!s.businessId||s.businessId===c.businessId)&&(c.spaceAccess==='all'||(c.allowedSpaceIds||[]).includes(s.id)));
    if(state.spaceId!=='all'&&!spaces.some(s=>s.id===state.spaceId)){state.spaceId='all';reset();}
    const range=M.range(state.period,new Date(),{start:state.start,end:state.end},c.business?.timezone||'America/Sao_Paulo');
    const key=JSON.stringify([id,range.from,range.to,state.spaceId]);if(key!==state.key){reset();state.key=key;}
    return{c,spaces,range};
  }
  function model(){
    const {c,spaces,range}=setup(),data=window.DB?.carregar?.()||{};
    return{...M.build({sales:state.rows??data.vendas??[],range,spaceId:state.spaceId,allowedSpaceIds:c.spaceAccess==='all'?null:c.allowedSpaceIds||[],businessId:c.businessId,canCost:has('cost.view'),canProfit:has('profit.view'),spaces}),range,spacesAvailable:spaces,data};
  }
  function change(value){if(!state.complete||value===null||value===undefined)return'<span class="analytics-comparison neutral">Sem período anterior para comparação</span>';return`<span class="analytics-comparison ${value<0?'negative':value>0?'positive':'neutral'}">${icon(value<0?'trending-down':'trending-up')}${value>0?'+':''}${num(value)}% <span>vs período anterior</span></span>`;}
  function kpi(title,value,caption,comparison,name){return`<article class="analytics-kpi"><div><span>${title}</span>${icon(name)}</div><strong>${value}</strong><small>${caption}</small>${change(comparison)}</article>`;}
  function label(key,full=false){if(key.includes('T'))return key.slice(-2)+':00';if(key.length===7)return new Date(key+'-15T12:00:00Z').toLocaleDateString('pt-BR',{month:'short',year:full?'numeric':undefined,timeZone:'UTC'});return new Date(key+'T12:00:00Z').toLocaleDateString('pt-BR',{day:'2-digit',month:full?'long':'short',year:full?'numeric':undefined,timeZone:'UTC'});}
  function empty(){return`<div class="analytics-empty">${icon('chart-no-axes-combined')}<strong>Ainda não há dados suficientes</strong><p>Quando suas primeiras vendas forem registradas, o desempenho aparecerá aqui.</p></div>`;}
  function chart(view){
    if(!view.current.count)return empty();
    const points=view.points,width=window.innerWidth<768?Math.max(260,window.innerWidth-64):1000,height=260,left=58,right=16,top=18,bottom=32,plot=width-left-right;
    const profit=has('profit.view')&&!view.current.missingCost,values=points.flatMap(p=>profit?[p.revenue,p.profit]:[p.revenue]),max=Math.max(1,...values),min=Math.min(0,...values),span=max-min;
    const x=i=>left+(points.length===1?plot/2:i/(points.length-1)*plot),y=v=>top+(max-v)/span*(height-top-bottom),line=key=>points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' '),base=y(0);
    const ticks=Array.from({length:4},(_,i)=>{const value=min+span*i/3,pos=y(value);return`<line x1="${left}" x2="${width-right}" y1="${pos}" y2="${pos}" class="analytics-gridline"/><text x="${left-12}" y="${pos+4}" text-anchor="end">${esc(value>=1000?'R$ '+num(value/1000)+' mil':'R$ '+num(value))}</text>`;}).join('');
    const tickCount=width<500?2:5;
    const marks=[...new Set([0,...Array.from({length:tickCount},(_,i)=>Math.round((points.length-1)*(i+1)/tickCount))])].map(i=>`<text x="${x(i)}" y="${height-7}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(label(points[i].key))}</text>`).join('');
    return`<div class="analytics-chart-wrap"><svg class="analytics-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolução de faturamento${profit?' e lucro estimado':''}. Use o seletor abaixo para consultar cada ponto."><defs><linearGradient id="analytics-revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".18"/><stop offset="100%" stop-color="currentColor" stop-opacity=".01"/></linearGradient></defs>${ticks}<path d="${line('revenue')} L${x(points.length-1)},${base} L${x(0)},${base} Z" fill="url(#analytics-revenue-fill)"/><path class="analytics-revenue-line" d="${line('revenue')}"/>${profit?`<path class="analytics-profit-line" d="${line('profit')}"/>`:''}${marks}<line data-chart-cursor x1="0" x2="0" y1="${top}" y2="${height-bottom}" visibility="hidden" class="analytics-cursor"/></svg><div class="analytics-tooltip" role="status" hidden></div></div><div class="analytics-chart-access"><label for="analytics-point">Explorar datas</label><input id="analytics-point" type="range" min="0" max="${points.length-1}" value="${points.length-1}" aria-label="Data do gráfico"><output data-chart-detail>${esc(label(points.at(-1).key,true))}</output></div>`;
  }
  function ranking(rows,total,type){return rows.length?`<ol class="analytics-ranking">${rows.slice(0,5).map((row,i)=>`<li><div class="analytics-rank-label"><span>${type==='products'?`<em>${i+1}</em>`:''}<b>${esc(row.name)}</b></span><strong>${money(row.revenue)}</strong></div><div class="analytics-rank-meta"><small>${type==='products'?`${num(row.quantity)} un.`:type==='payments'&&row.form==='Cartão'?'Cartão • '+esc(row.origin||'manual'):'Participação no faturamento'}</small><span>${num(total?row.revenue/total*100:0)}%</span></div><div class="analytics-bar"><i style="width:${Math.max(0,Math.min(100,total?row.revenue/total*100:0))}%"></i></div></li>`).join('')}</ol>`:'<p class="analytics-muted">Nenhuma venda neste período.</p>';}
  function panel(title,subtitle,content,name){return`<section class="analytics-card"><header><div><h3>${title}</h3><p>${subtitle}</p></div>${icon(name)}</header>${content}</section>`;}
  function render(){
    if(!has('reports.view'))return window.TeamAccess?.deniedMarkup?.()||'';
    let v;try{v=model();}catch(e){return`<section class="analytics-page"><p role="alert">${esc(e.message)}</p><button class="btn btn-light" data-analytics-default>Voltar para 30 dias</button></section>`;}
    state.last=v;const c=v.current,profitAvailable=has('profit.view')&&!c.missingCost,periods=[['today','Hoje'],['7d','7 dias'],['30d','30 dias'],['90d','90 dias'],['month','Este mês'],['previous','Mês passado'],['year','Este ano'],['custom','Personalizado']];
    const debtAllowed=has('financial.view')&&has('customers.view')&&context().spaceAccess==='all',clients=(v.data.clientes||[]).filter(x=>x.active!==false&&x.ativo!==false&&!x.deleted&&!x.deletedAt&&(!x.businessId||x.businessId===context().businessId)&&Number(x.saldo)<0),debt=clients.reduce((s,x)=>s+Math.abs(Number(x.saldo)),0);
    const debtCard=debtAllowed?panel('Fiado em aberto','Saldo atual da empresa • todos os espaços',`<div class="analytics-debt"><strong>${money(debt)}</strong><span>${clients.length} clientes devendo</span></div><p class="analytics-muted">Não é receita adicional. Não muda com o período selecionado. Base local da última sincronização.</p><button type="button" class="btn btn-light" data-analytics-clients>Ver clientes ${icon('arrow-up-right')}</button>`,'hand-coins'):'';
    const spaceTable=v.spaces.length>1?panel('Desempenho por espaço','Participação no período selecionado',`<div class="analytics-table-wrap"><table><thead><tr><th>Espaço</th><th>Faturamento</th><th>Vendas</th>${profitAvailable?'<th>Lucro estimado</th>':''}<th>Participação</th></tr></thead><tbody>${v.spaces.map(s=>`<tr><th>${esc(s.name)}</th><td>${money(s.revenue)}</td><td>${s.count}</td>${profitAvailable?`<td>${money(s.profit)}</td>`:''}<td>${num(c.revenue?s.revenue/c.revenue*100:0)}%</td></tr>`).join('')}</tbody></table></div>`,'layers'):'';
    const insight=v.payments[0]&&c.revenue?`${v.payments[0].name} representa ${num(v.payments[0].revenue/c.revenue*100)}% do faturamento deste período.`:'Registre suas vendas para acompanhar a evolução do negócio.';
    return`<section class="analytics-page"><header class="analytics-heading"><div><span class="analytics-eyebrow">VISÃO DO NEGÓCIO</span><h2>Desempenho</h2><p>Seus números, com contexto para decidir.</p></div><button class="btn btn-light" type="button" data-analytics-refresh ${state.busy?'disabled':''}>${icon(state.busy?'loader-circle':'refresh-cw')} ${state.busy?'Consultando…':'Atualizar análise'}</button></header><section class="analytics-filters" aria-label="Filtros da análise"><label>Espaço<select id="analytics-space"><option value="all">Todos os espaços permitidos</option>${v.spacesAvailable.map(s=>`<option value="${esc(s.id)}" ${state.spaceId===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>Período<select id="analytics-period">${periods.map(([id,name])=>`<option value="${id}" ${state.period===id?'selected':''}>${name}</option>`).join('')}</select></label>${state.period==='custom'?`<label>De<input type="date" id="analytics-start" value="${esc(state.start)}"></label><label>Até<input type="date" id="analytics-end" value="${esc(state.end)}"></label><button type="button" class="btn btn-light" data-analytics-apply>Aplicar</button>`:''}<span class="analytics-range-label">${esc(label(v.range.start))} — ${esc(label(v.range.end))}<small>${esc(v.range.zone)}</small></span></section><div class="analytics-status ${state.complete?'is-complete':''}" role="status">${icon(state.complete?'circle-check':'info')}<span>${state.error?esc(state.error):state.busy?'Confirmando o período na nuvem…':state.complete?`Período consultado na nuvem às ${new Date(state.asOf).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`:'Prévia parcial — os totais ainda não representam todo o período.'}${state.next&&!state.busy?' Continue a consulta para completar os totais.':''}</span>${state.next&&!state.busy?'<button class="btn btn-light btn-sm" data-analytics-more>Carregar próximo lote</button>':''}</div><section class="analytics-kpis">${kpi('Faturamento',money(c.revenue),`${c.count} vendas no período`,v.comparison.revenue,'circle-dollar-sign')}${has('profit.view')?kpi('Lucro estimado',profitAvailable?money(c.profit):'Não disponível',profitAvailable?`${num(c.margin)}% de margem${has('cost.view')?' · Custo '+money(c.cost):''}`:'Há vendas sem snapshot de custo completo',profitAvailable?v.comparison.profit:null,'trending-up'):kpi('Itens vendidos',num(c.quantity),'quantidade no período',null,'package')}${kpi('Ticket médio',money(c.ticket),'por venda',v.comparison.ticket,'receipt')}${kpi('Vendas',num(c.count),`${num(c.quantity)} itens vendidos`,v.comparison.count,'shopping-bag')}</section>${has('cost.view')&&!has('profit.view')?`<p class="analytics-cost">Custo total: <strong>${c.missingCost?'Não disponível':money(c.cost)}</strong></p>`:''}<section class="analytics-card analytics-main"><header><div><h3>Faturamento${has('profit.view')?' e lucro':''}</h3><p>Evolução ${v.range.granularity==='hour'?'por hora':v.range.granularity==='month'?'mensal':'diária'} • no período selecionado</p></div><div class="analytics-legend"><span>Faturamento</span>${profitAvailable?'<span class="profit">Lucro estimado</span>':''}</div></header>${chart(v)}<footer><span>${esc(insight)}</span><small>Lucro estimado não é lucro líquido contábil.</small></footer></section><div class="analytics-three">${panel('Formas de pagamento','Distribuição por valor vendido',ranking(v.payments,c.revenue,'payments'),'wallet')}${panel('Faturamento por categoria','Top 5 • categoria registrada na venda',ranking(v.categories,c.revenue,'categories'),'tags')}${panel('Produtos mais vendidos','Top 5 • por quantidade',ranking(v.products,c.revenue,'products'),'package')}</div><div class="analytics-bottom">${debtCard}${spaceTable||panel('Leitura rápida','Informações do período',`<p class="analytics-insight">${esc(insight)}</p>${v.products[0]?`<p class="analytics-muted">${esc(v.products[0].name)} lidera em quantidade: ${num(v.products[0].quantity)} un.</p>`:''}<p class="analytics-muted">Vendas canceladas e excluídas não entram na análise. Categorias ausentes são identificadas, sem usar o cadastro atual para reescrever o passado.</p>`,'lightbulb')}</div></section>`;
  }
  function repaint(){if(!document.querySelector('.analytics-page'))return;document.querySelector('#app').innerHTML=render();bind(false);window.lucide?.createIcons();}
  async function load(restart=false){
    if(state.busy||!has('reports.view'))return;
    if(!navigator.onLine){state.error='Você está offline. Esta é uma prévia local, possivelmente incompleta.';repaint();return;}
    const {c,range}=setup();if(restart){reset();state.key=JSON.stringify([state.identity,range.from,range.to,state.spaceId]);}
    const request=++state.request,id=identity();state.busy=true;state.error='';repaint();
    try{
      for(let n=0;n<4;n++){
        const response=await window.FirebaseCallable('getPerformancePage',{businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0,spaceId:state.spaceId,from:range.from,to:range.to,cursor:state.next});
        if(request!==state.request||id!==identity())return;
        const data=response.data;if(data.businessId!==c.businessId||data.workspaceGeneration!==(c.business?.workspaceGeneration??0))throw Error('O ambiente mudou. Reabra a análise.');
        state.rows??=[];state.rows.push(...data.rows);state.next=data.next;state.complete=data.complete;state.asOf=data.asOf;
        if(!state.next)break;
      }
    }catch(error){if(request===state.request){state.complete=false;state.error=error.code==='functions/permission-denied'?'Seu perfil não tem acesso a esta análise.':`Não foi possível completar a consulta. ${error.message||'Tente novamente.'}`;console.warn('[ANALYTICS]',{stage:'period_query',code:error.code||'unknown'});}}
    finally{if(request===state.request&&id===identity()){state.busy=false;repaint();}}
  }
  function bind(auto=true){
    const root=document.querySelector('.analytics-page');if(!root)return;
    root.querySelector('[data-analytics-default]')?.addEventListener('click',()=>{state.period='30d';reset();repaint();void load();});
    root.querySelector('#analytics-period')?.addEventListener('change',e=>{const current=state.last.range;state.period=e.target.value;if(state.period==='custom'){state.start=current.start;state.end=current.end;}reset();repaint();if(state.period!=='custom')void load();});
    root.querySelector('#analytics-space')?.addEventListener('change',e=>{state.spaceId=e.target.value;reset();repaint();void load();});
    root.querySelector('[data-analytics-apply]')?.addEventListener('click',()=>{state.start=root.querySelector('#analytics-start').value;state.end=root.querySelector('#analytics-end').value;try{M.range('custom',new Date(),state.last?{start:state.start,end:state.end}:{},state.last.range.zone);reset();repaint();void load();}catch(e){window.alert(e.message);}});
    root.querySelector('[data-analytics-refresh]')?.addEventListener('click',()=>void load(true));
    root.querySelector('[data-analytics-more]')?.addEventListener('click',()=>void load());
    root.querySelector('[data-analytics-clients]')?.addEventListener('click',()=>window.Router?.ir?.('clientes'));
    const svg=root.querySelector('.analytics-chart'),tooltip=root.querySelector('.analytics-tooltip'),slider=root.querySelector('#analytics-point');
    function show(index,position){
      const p=state.last.points[index];if(!p||!tooltip)return;
      const content=`<b>${esc(label(p.key,true))}</b><span>Faturamento <strong>${money(p.revenue)}</strong></span>${has('profit.view')&&!state.last.current.missingCost?`<span>Lucro estimado <strong>${money(p.profit)}</strong></span>`:''}<span>Vendas <strong>${p.count}</strong></span>`;
      tooltip.innerHTML=content;tooltip.hidden=false;tooltip.style.left=`${Math.max(0,Math.min((position??.5)*svg.clientWidth,svg.clientWidth-220))}px`;slider.value=index;
      root.querySelector('[data-chart-detail]').textContent=`${label(p.key,true)} • ${money(p.revenue)} • ${p.count} vendas`;
      const width=svg.viewBox.baseVal.width,x=58+index/Math.max(1,state.last.points.length-1)*(width-74),cursor=svg.querySelector('[data-chart-cursor]');cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);cursor.setAttribute('visibility','visible');
    }
    svg?.addEventListener('pointermove',e=>{const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()),width=svg.viewBox.baseVal.width,ratio=Math.max(0,Math.min(1,(point.x-58)/(width-74)));show(Math.round(ratio*(state.last.points.length-1)),ratio);});
    svg?.addEventListener('pointerleave',()=>{tooltip.hidden=true;svg.querySelector('[data-chart-cursor]').setAttribute('visibility','hidden');});
    slider?.addEventListener('input',e=>show(Number(e.target.value)));
    if(auto&&!state.busy&&!state.error&&(state.rows===null||state.complete&&Date.now()-Date.parse(state.asOf)>300000))void load(true);
  }
  addEventListener('firebase-session-cleared',()=>{reset();state.identity='';state.last=null;});
  let resizeTimer;
  addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(document.querySelector('.analytics-page'))repaint();},180);});
  addEventListener('business-context-changed',()=>{if(state.identity&&identity()!==state.identity){reset();state.identity='';state.last=null;repaint();}});
  window.PerformanceDashboard={render,bind,state};
})();
