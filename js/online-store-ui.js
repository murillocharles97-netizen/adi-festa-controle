(function(){
  'use strict';
  // VECONI Loja Online V3 — painel do lojista (um espaço por vez).
  // Contrato do servidor inalterado: getOnlineStore / saveOnlineStore (save, publish, set_order_reception).
  // Toda alteração vira rascunho salvo na nuvem; o cliente só vê depois de "Publicar".
  const M=window.OnlineStoreModel,K=window.StoreKit;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
  const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const LIMIT=400,BATCH=36,SAVE_DELAY=900;
  const STATUS={new:'Nova',draft:'Rascunho',published:'Publicada',paused:'Pausada'};
  // Ícones pequenos inline nos cartões: milhares de cartões sem varrer o documento com o Lucide.
  const SVG={star:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8Z"/></svg>',check:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',grip:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>'};
  const state={key:'',spaceId:'',view:'home',data:null,base:null,draft:null,sel:new Set(),ops:[],inflight:null,flushing:null,saveTimer:0,saveState:'idle',saveError:'',savedAt:0,conflicts:0,
    live:null,liveMissing:false,unpublished:null,busy:false,sequence:0,receptionConfirm:null,receptionMessage:'',filter:{q:'',scope:'all',category:''},selecting:false,picked:new Set(),results:[],shown:0,sheet:null,device:'phone',errors:{},sortCategory:''};
  let index=null,observer=null,previewTimer=0,searchTimer=0,toastTimer=0,liveRead=0;
  const business=()=>window.BusinessContext?.getCurrentBusinessId?.()||window.FirebaseSession?.businessId||window.FirebaseSession?.profile?.businessId||'';
  const spaces=()=>window.SpaceContext?.salesSpaces?.()||[];
  const scope=()=>({businessId:business(),spaceId:state.spaceId,workspaceGeneration:window.WorkspaceRuntime?.capture?.().workspaceGeneration??window.DB?.getWorkspaceGeneration?.()??0});
  async function call(name,data){if(navigator.onLine===false)throw Error('Conecte-se à internet para configurar a loja.');if(!window.FirebaseCallable)throw Error('A conexão ainda não está pronta. Tente novamente.');const r=await window.FirebaseCallable(name,data);return r.data;}
  const spaceName=()=>spaces().find(s=>s.id===state.spaceId)?.name||'este espaço';
  const owner=()=>state.data?.owner===true;
  const store=()=>state.data?.store||null;
  function status(){
    const s=store(),value=K.status(s);
    return value==='paused'&&state.liveMissing&&!Array.isArray(s.publishedProductIds)?'draft':value;
  }
  const codeOf=e=>String(e?.code||'').replace(/^functions\//,'');
  const friendly=e=>{
    const code=codeOf(e),message=e?.message||'';
    if(code==='unavailable'||code==='deadline-exceeded'||/network|internet/i.test(message))
      return 'Sem conexão com o servidor. Suas alterações continuam aqui; tente de novo.';
    if(code==='resource-exhausted'&&/variações exigem paginação/i.test(message))
      return 'A empresa tem mais de 1.000 variações. O limite conta todos os espaços e impede salvar ou publicar este rascunho.';
    return window.Utils?.friendlyError?.(e,message||'Tente novamente.')??(message||'Tente novamente.');
  };
  const publicUrl=()=>store()?.slug?M.url(store().slug):'';
  const previewSrc=()=>window.OnlineStorePreviewUrl||'catalogo.html?preview=1';
  const shortUrl=u=>String(u||'').replace(/^https?:\/\//,'');

  /* ---------- Carregamento ---------- */
  function render(){
    const key=`${business()}:${window.FirebaseSession?.user?.uid||''}`;
    if(state.key!==key){Object.assign(state,{key,spaceId:'',view:'home',data:null,base:null,draft:null,ops:[],inflight:null,saveState:'idle',saveError:'',live:null,busy:false,receptionConfirm:null,receptionMessage:'',selecting:false,sheet:null});state.picked=new Set();state.sequence++;}
    if(!spaces().some(s=>s.id===state.spaceId))state.spaceId=spaces().find(s=>s.id===window.SpaceContext?.salesId?.())?.id||spaces()[0]?.id||'';
    return '<section class="lo" id="store-v2" aria-label="Loja online"><div class="lo-loading" role="status"><span class="lo-spinner" aria-hidden="true"></span>Carregando a loja deste espaço…</div></section>';
  }
  async function load(){
    const root=document.querySelector('#store-v2');
    if(!state.spaceId){if(root)root.innerHTML=emptySpaces();return;}
    if(state.flushing)await state.flushing.catch(()=>{});
    const ticket=++state.sequence,c=scope();
    try{
      const data=await call('getOnlineStore',c);
      if(ticket!==state.sequence||c.businessId!==business()||c.spaceId!==state.spaceId)return;
      state.data=data;state.base=K.draftFromStore(data.store,spaceName());state.live=null;state.liveMissing=false;state.unpublished=null;
      if(!state.base.settings.publicName)state.base.settings.publicName=spaceName();
      buildIndex();refreshDraft();draw();readLive();
    }catch(e){
      if(ticket!==state.sequence)return;
      const el=document.querySelector('#store-v2');
      let detail=friendly(e);
      if(codeOf(e)==='resource-exhausted'){
        if(/paginação de pedidos/i.test(e.message||''))detail='Há mais de 100 pedidos neste espaço. A edição da loja depende de uma atualização do servidor.';
        else if(/este catálogo exige paginação/i.test(e.message||''))detail='A empresa tem mais de 1.000 produtos. O limite conta todos os espaços. Nenhum produto foi alterado.';
      }
      if(el)el.innerHTML=`<div class="lo-panel lo-fatal"><h2>Não foi possível abrir a loja deste espaço</h2><p role="alert">${esc(detail)}</p><button type="button" class="lo-btn lo-btn-primary" data-store-retry>Tentar novamente</button></div>`;
      el?.querySelector('[data-store-retry]')?.addEventListener('click',()=>{el.innerHTML='<div class="lo-loading" role="status"><span class="lo-spinner" aria-hidden="true"></span>Carregando…</div>';load();});
    }
  }
  async function readLive(){
    const s=store(),ticket=state.sequence,request=++liveRead;
    if(!s?.publicToken||!(s.published||s.activation)||typeof window.FirebasePublicCatalogReader!=='function')return;
    try{
      const live=await window.FirebasePublicCatalogReader(s.publicToken);
      if(ticket!==state.sequence||request!==liveRead||s!==store())return;
      state.liveMissing=live===null;
      state.live=live&&live.businessId===s.businessId&&live.spaceId===s.spaceId&&live.workspaceGeneration===s.workspaceGeneration&&live.active===s.published?live:null;
      if(state.live&&state.unpublished!==true)state.unpublished=compareLive(state.base).length>0||Number(state.live.revision)!==Number(s.revision);
      paint('head');paint('save');if(state.view==='home')paint('main');
    }catch{/* Continua mostrando a última situação confirmada. */}
  }
  function local(){try{const d=window.DB?.carregar?.()||{};return {products:new Map((d.produtos||[]).map(p=>[p.id,p])),variants:(d.variacoesProdutos||[]).filter(v=>!v.deleted&&!v.deletedAt&&v.active!==false)};}catch{return {products:new Map(),variants:[]};}}
  function buildIndex(){
    const loc=local(),byParent=new Map();
    for(const v of loc.variants){const list=byParent.get(v.parentProductId)||[];list.push(v);byParent.set(v.parentProductId,list);}
    const list=(state.data?.products||[]).map(p=>{
      const raw=loc.products.get(p.productId)||{},vs=byParent.get(p.productId)||[],variable=p.productType==='variable';
      let avail=null;
      if(p.itemKind==='product'&&p.controlaEstoque!==false){if(variable){if(vs.length)avail=vs.reduce((s,v)=>s+Math.max(0,Number(v.stock||0)-Number(v.onlineReservedStock||0)),0);}else avail=Math.max(0,Number(p.availableQuantity||0));}
      const prices=vs.map(v=>Number(v.price||0)).filter(n=>n>0);
      return {id:p.productId,name:p.productName||'Produto',price:Number(p.salePrice||0),minPrice:prices.length?Math.min(...prices):null,baseCategory:p.category||'Outros',image:p.productImage||'',kind:p.itemKind||'product',variable,variants:vs.length,avail,allowNegative:!!p.allowNegativeStock,
        search:norm([p.productName,p.category,raw.codigo,raw.sku,raw.barcode].filter(Boolean).join(' ')),src:p};
    }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    index={list,byId:new Map(list.map(p=>[p.id,p])),local:loc};
  }
  function refreshDraft(){state.draft=K.applyOps(state.base,[...(state.inflight||[]),...state.ops]);state.sel=new Set(state.draft.productIds);}
  const pres=id=>state.draft.presentation.products[id]||{};
  const featured=id=>state.sel.has(id)&&pres(id).featured===true;
  const categoryOf=p=>pres(p.id).category||p.baseCategory;
  const soldOut=p=>p.avail===0&&!p.allowNegative;

  /* ---------- Fila de salvamento: nada aparece como salvo sem a confirmação do servidor ---------- */
  function queue(...ops){
    for(const op of ops){if(op.t==='setting'){const i=state.ops.findIndex(o=>o.t==='setting'&&o.key===op.key);if(i>=0)state.ops.splice(i,1);}state.ops.push(op);}
    refreshDraft();state.saveState=state.inflight?'saving':'pending';state.saveError='';
    clearTimeout(state.saveTimer);state.saveTimer=setTimeout(flush,SAVE_DELAY);
    paint('save');schedulePreview();
  }
  function flush(){if(state.flushing)return state.flushing;state.flushing=doFlush().finally(()=>{state.flushing=null;if(state.ops.length&&state.saveState!=='error'){clearTimeout(state.saveTimer);state.saveTimer=setTimeout(flush,250);}});return state.flushing;}
  function sameSet(a,b){if(a.length!==b.length)return false;const s=new Set(a);return b.every(x=>s.has(x));}
  function confirmsDraft(saved,payload,revision){
    if(!saved||saved.revision!==revision+1||saved.slug!==payload.slug||
      !sameSet(saved.selectedProductIds||[],payload.productIds)||
      Object.keys(payload.settings).some(k=>JSON.stringify(saved.catalogSettings?.[k])!==JSON.stringify(payload.settings[k])))return false;
    const presentation=K.savePayload(K.draftFromStore(saved)).presentation;
    const categories=new Map(presentation.categories.map(c=>[c.internalName,c]));
    return Object.keys(payload.presentation.products).every(id=>
      JSON.stringify(presentation.products[id])===JSON.stringify(payload.presentation.products[id]))&&
      payload.presentation.categories.every(c=>JSON.stringify(categories.get(c.internalName))===JSON.stringify(c));
  }
  async function doFlush(){
    clearTimeout(state.saveTimer);
    if(state.inflight||!state.ops.length||!state.data)return;
    if(!owner()){state.ops=[];refreshDraft();fail('Somente o proprietário pode alterar a loja.');return;}
    const ops=state.ops.splice(0),ticket=state.sequence,c=scope();
    state.inflight=ops;state.saveState='saving';paint('save');
    try{
      const d=K.applyOps(state.base,ops),payload=K.savePayload(d);
      payload.settings=M.settings({...d.settings,checkoutEnabled:store()?.checkoutEnabled===true});
      const revision=store()?.revision||0;
      const result=await call('saveOnlineStore',{...c,action:'save',revision,...payload});
      if(ticket!==state.sequence)return;
      const saved=result?.store;
      // Confirma que o servidor gravou exatamente o que foi enviado (inclusive campos que um servidor antigo descartaria).
      if(!confirmsDraft(saved,payload,revision))
        throw Object.assign(Error('O servidor não confirmou todas as alterações. Recarregue a loja para conferir.'),{code:'unconfirmed'});
      state.data.store=saved;state.base=K.draftFromStore(saved,spaceName());state.inflight=null;state.conflicts=0;if(saved.published)state.unpublished=true;
      refreshDraft();state.saveState=state.ops.length?'pending':'saved';state.savedAt=Date.now();state.saveError='';
      paint('save');paint('head');if(state.view==='home')paint('main');if(state.view==='products')paintCounts();
    }catch(e){
      if(ticket!==state.sequence)return;
      state.ops=[...ops,...state.ops];state.inflight=null;
      if(codeOf(e)==='aborted'&&state.conflicts<1){state.conflicts++;await rebase();return;}
      fail(friendly(e));
    }
  }
  async function rebase(){
    const ticket=state.sequence,c=scope();
    try{const data=await call('getOnlineStore',c);if(ticket!==state.sequence)return;state.data=data;state.base=K.draftFromStore(data.store,spaceName());buildIndex();refreshDraft();
      toast('A loja foi alterada em outro aparelho. Suas alterações foram reaplicadas sobre a versão mais recente.');draw();await doFlush();}
    catch(e){if(ticket===state.sequence)fail(friendly(e));}
  }
  function fail(message){state.saveState='error';state.saveError=message;paint('save');}
  async function settle(){for(let i=0;i<6&&(state.ops.length||state.inflight||state.flushing);i++){if(state.saveState==='error')break;await flush();}return !state.ops.length&&!state.inflight&&state.saveState!=='error';}
  function discard(){state.ops=[];state.saveState=state.inflight?'saving':'idle';state.saveError='';refreshDraft();draw();toast('Alterações não salvas foram descartadas.');}
  function guard(){if(!owner()){toast('Somente o proprietário pode alterar a loja.',true);return false;}if(state.busy)return false;return true;}

  /* ---------- Situação ---------- */
  // Nunca presume que algo está publicado: só uma publicação confirmada (ou a leitura da versão pública) zera a pendência.
  function pendingPublish(){const s=store();if(!s||!s.published)return false;return !!(state.ops.length||state.inflight||state.unpublished===true);}
  const publicationUnknown=()=>status()==='published'&&state.unpublished===null;
  const compareLive=draft=>K.publishedDiff(draft,state.live,id=>index.byId.get(id)?.baseCategory)||[];
  function diffList(){return compareLive(state.draft);}
  function readiness(){return K.readiness({settings:state.draft.settings,selectedCount:state.sel.size,state:status(),pending:pendingPublish()||publicationUnknown()});}

  /* ---------- Desenho ---------- */
  function draw(){
    const root=document.querySelector('#store-v2');if(!root||!state.data||!state.draft)return;
    root.dataset.view=state.view;root.classList.toggle('lo-readonly',!owner());
    // O aviso em exibição sobrevive ao redesenho (ex.: "Loja publicada" logo após publicar).
    const prev=root.querySelector('.lo-toast'),keep=prev?.classList.contains('is-on')?{text:prev.textContent,error:prev.classList.contains('is-error')}:null;
    root.innerHTML=`<div data-region="head">${head()}</div>${status()==='new'?'':tabs()}<div class="lo-view" data-region="view">${view()}</div><div data-region="save">${saveBar()}</div><div class="lo-toast" role="status" aria-live="polite"></div><div data-region="sheet">${sheet()}</div>`;
    bind(root);window.lucide?.createIcons?.();afterPaint('all');
    if(keep){const t=root.querySelector('.lo-toast');t.textContent=keep.text;t.classList.toggle('is-error',keep.error);t.classList.add('is-on');}
  }
  // "main" redesenha o conteúdo sem tocar na prévia (um iframe recarrega se for recriado).
  function paint(name){
    const root=document.querySelector('#store-v2'),el=root?.querySelector(`[data-region="${name}"]`);if(!el||!state.data||!state.draft)return;
    el.innerHTML=name==='head'?head():name==='view'?view():name==='main'?mainContent():name==='save'?saveBar():name==='sheet'?sheet():'';
    if(el.querySelector('[data-lucide]'))window.lucide?.createIcons?.();
    afterPaint(name);
  }
  function afterPaint(region){
    if((region==='all'||region==='view')&&state.view==='products'&&status()!=='new')mountGrid();
    if(region!=='head'&&region!=='save')mountPreviews();
    if(state.sheet?.type==='organize'&&(region==='sheet'||region==='all'))bindSortables();
  }

  function head(){
    const st=status(),d=state.draft.settings,t=K.theme(d),name=d.publicName||spaceName(),url=publicUrl(),pending=pendingPublish(),many=spaces().length>1;
    const mark=d.logoUrl?`<img src="${esc(d.logoUrl)}" alt="">`:`<span>${esc(initials(name))}</span>`;
    return `<header class="lo-head"><div class="lo-head-top"><div class="lo-head-title"><h1>Loja online</h1><p>Sua vitrine com pedidos pelo WhatsApp.</p></div>${many?`<label class="lo-space"><span>Espaço</span><select data-space aria-label="Espaço da loja" ${state.busy||state.inflight?'disabled':''}>${spaces().map(s=>`<option value="${esc(s.id)}" ${s.id===state.spaceId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`:''}</div>
      ${st==='new'?'':`<div class="lo-identity"><span class="lo-mark" style="--mark-bg:${t.band};--mark-fg:${t.onBand}">${mark}</span><div class="lo-identity-copy"><div class="lo-identity-name"><strong>${esc(name)}</strong><span class="lo-status lo-status-${st}">${STATUS[st]}</span>${pending?'<span class="lo-status lo-status-pending">Alterações não publicadas</span>':''}</div>${url?`<span class="lo-link">${icon('link')}<span>${esc(shortUrl(url))}</span></span>`:''}</div>
      <div class="lo-head-actions">${primaryAction()}${st==='published'||st==='paused'?`<a class="lo-btn lo-btn-quiet" href="${esc(url)}" target="_blank" rel="noopener">${icon('external-link')}<span>Ver loja</span></a>`:`<button type="button" class="lo-btn lo-btn-quiet" data-act="fullpreview">${icon('smartphone')}<span>Ver como cliente</span></button>`}${st==='new'||/data-act="share"/.test(primaryAction())?'':`<button type="button" class="lo-btn lo-btn-quiet" data-act="share">${icon('share-2')}<span>Compartilhar</span></button>`}</div></div>`}</header>`;
  }
  function primaryAction(){
    const st=status(),r=readiness(),dis=state.busy||!owner()?'disabled':'';
    if(state.busy)return `<button type="button" class="lo-btn lo-btn-primary" disabled><span class="lo-spinner" aria-hidden="true"></span>Publicando…</button>`;
    if(st==='draft')return `<button type="button" class="lo-btn lo-btn-primary" data-act="ask-publish" ${dis}>${icon('globe')}<span>Publicar loja</span></button>`;
    if(st==='paused')return `<button type="button" class="lo-btn lo-btn-primary" data-act="ask-publish" ${dis}>${icon('play')}<span>Retomar loja</span></button>`;
    if(pendingPublish()||publicationUnknown())return `<button type="button" class="lo-btn lo-btn-primary" data-act="ask-publish" ${dis}>${icon('upload-cloud')}<span>Publicar alterações</span></button>`;
    return r.done?`<button type="button" class="lo-btn lo-btn-primary" data-act="share">${icon('send')}<span>Divulgar loja</span></button>`:'';
  }
  function tabs(){
    const items=[['home','Painel','layout-dashboard'],['products','Produtos','package'],['design','Aparência','palette']];
    return `<nav class="lo-tabs" aria-label="Seções da loja">${items.map(([id,label,ic])=>`<button type="button" data-act="view" data-v="${id}" aria-current="${state.view===id?'page':'false'}">${icon(ic)}<span>${label}</span>${id==='products'?`<b data-count="tab">${state.sel.size}</b>`:''}</button>`).join('')}</nav>`;
  }
  function view(){
    if(status()==='new')return `<div data-region="main">${createView()}</div>`;
    const side=state.view==='home'||state.view==='design';
    return `${state.view==='design'?`<button type="button" class="lo-btn lo-btn-quiet lo-fab" data-act="fullpreview">${icon('smartphone')}<span>Ver prévia</span></button>`:''}<div class="lo-layout lo-layout-${state.view}"><div class="lo-main" data-region="main">${mainContent()}</div>${side?`<aside class="lo-side">${previewPanel()}</aside>`:''}</div>`;
  }
  function mainContent(){if(status()==='new')return createView();return state.view==='products'?productsView():state.view==='design'?designView():homeView();}
  const initials=name=>String(name||'Loja').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'L';
  function emptySpaces(){return '<div class="lo-panel lo-fatal"><h2>Nenhum espaço disponível para a loja</h2><p>A loja online é criada por espaço. Peça ao proprietário acesso a um espaço com produtos e vendas.</p></div>';}

  /* ---------- Criação ---------- */
  function createView(){
    const brand=window.SpaceBranding?.resolve?.({spaceId:state.spaceId})||{},name=state.errors.createName??(brand.name&&brand.name!=='VECONI'?brand.name:spaceName()),count=index.list.length;
    const slug=state.errors.createSlugValue??K.slugify(name),phone=state.errors.createPhone??(brand.phone||'');
    if(!owner())return `<section class="lo-panel lo-create"><h2>A loja deste espaço ainda não foi criada</h2><p>Somente o proprietário pode criar e publicar a loja.</p></section>`;
    return `<section class="lo-panel lo-create" aria-labelledby="lo-create-title"><div class="lo-create-copy"><h2 id="lo-create-title">Crie a loja de ${esc(spaceName())}</h2><p>Seus clientes escolhem os produtos pelo link e enviam o pedido direto para o seu WhatsApp. Nada fica visível até você publicar.</p></div>
      <form class="lo-form" data-create novalidate>
        ${fieldHtml({key:'createName',label:'Nome da loja',value:name,max:100,required:true,autocomplete:'organization'})}
        <div class="lo-field"><label for="lo-createSlug">Endereço da loja</label><div class="lo-affix"><span>…/catalogo.html?loja=</span><input id="lo-createSlug" name="createSlug" value="${esc(slug)}" maxlength="48" autocapitalize="off" spellcheck="false" aria-describedby="lo-createSlug-hint lo-createSlug-error"></div><small id="lo-createSlug-hint">Letras minúsculas, números e hífens. Dá para trocar depois.</small><small class="lo-error" id="lo-createSlug-error" role="alert">${esc(state.errors.createSlug||'')}</small></div>
        ${fieldHtml({key:'createPhone',label:'WhatsApp que recebe os pedidos',value:phone,type:'tel',inputmode:'tel',autocomplete:'tel',placeholder:'(11) 91234-5678',hint:'Opcional agora. Sem ele, o cliente vê a loja mas não consegue enviar o pedido.'})}
        ${count?`<label class="lo-check"><input type="checkbox" name="createAll" ${count<=60?'checked':''} ${count>LIMIT?'disabled':''}><span><b>Começar com ${count>LIMIT?'':'todos os '}${count} produtos deste espaço</b><small>${count>LIMIT?`A loja aceita até ${LIMIT}. Você escolhe no próximo passo.`:'Você pode tirar qualquer um depois. O cadastro dos produtos não muda.'}</small></span></label>`:'<p class="lo-note">Este espaço ainda não tem produtos. Você pode criar a loja agora e cadastrar produtos em Produtos.</p>'}
        <button class="lo-btn lo-btn-primary lo-btn-wide" ${state.busy?'disabled':''}>${state.busy?'<span class="lo-spinner" aria-hidden="true"></span>Criando…':`${icon('store')}<span>Criar minha loja</span>`}</button>
      </form></section>`;
  }
  async function createStore(form){
    if(!guard())return;
    const fd=new FormData(form),name=String(fd.get('createName')||'').trim(),slug=String(fd.get('createSlug')||'').trim().toLowerCase(),phone=String(fd.get('createPhone')||'').trim(),all=fd.get('createAll')==='on';
    state.errors={createName:name,createSlugValue:slug,createPhone:phone};
    const errs={};if(!name)errs.createNameError='Informe o nome da loja.';const sp=K.slugProblem(slug);if(sp)errs.createSlug=sp;if(phone&&K.phoneProblem(phone))errs.createPhoneError=K.phoneProblem(phone);
    if(Object.keys(errs).length){Object.assign(state.errors,errs);paint('view');document.querySelector('#store-v2 [aria-invalid="true"],#store-v2 .lo-error:not(:empty)')?.closest('.lo-field')?.querySelector('input')?.focus();return;}
    const brand=window.SpaceBranding?.resolve?.({spaceId:state.spaceId})||{},ids=all?index.list.slice(0,LIMIT).map(p=>p.id):[],c=scope(),ticket=state.sequence;
    state.busy=true;paint('view');
    try{
      const settings=M.settings({publicName:name,contactPhone:phone?K.formatPhone(phone):'',instagram:brand.instagram||'',address:brand.address||'',primaryColor:K.PALETTES[0].primary,secondaryColor:K.PALETTES[0].secondary,pickupEnabled:true,deliveryEnabled:false});
      const payload=K.savePayload({slug,settings,productIds:ids,presentation:{products:{},categories:[]}});
      const r=await call('saveOnlineStore',{...c,action:'save',revision:0,...payload});
      if(ticket!==state.sequence)return;
      if(!confirmsDraft(r?.store,payload,0))throw Error('O servidor não confirmou a criação. Recarregue para conferir.');
      state.data.store=r.store;state.base=K.draftFromStore(r.store,spaceName());state.errors={};refreshDraft();state.view=ids.length?'design':'products';
      toast(ids.length?'Loja criada. Agora deixe a cara da sua marca.':'Loja criada. Escolha os produtos que vão aparecer.');
    }catch(e){if(ticket!==state.sequence)return;if(codeOf(e)==='already-exists')state.errors.createSlug='Esse endereço já pertence a outra loja. Escolha outro.';else toast(friendly(e),true);}
    finally{if(ticket===state.sequence){state.busy=false;draw();}}
  }

  /* ---------- Painel ---------- */
  function homeView(){
    const r=readiness(),diff=pendingPublish()?diffList():[];
    return `<div class="lo-home">${stepsCard(r)}${pendingPublish()&&status()==='published'?`<section class="lo-panel lo-pending" aria-labelledby="lo-pending-title"><div><h2 id="lo-pending-title">Alterações ainda não publicadas</h2><p>${diff.length?`O cliente ainda vê a versão anterior de: ${esc(diff.join(', '))}.`:'O cliente ainda vê a versão anterior da loja.'}</p></div><button type="button" class="lo-btn lo-btn-primary" data-act="ask-publish" ${state.busy||!owner()?'disabled':''}>${icon('upload-cloud')}<span>Publicar alterações</span></button></section>`:''}${factsCard()}${moreCard()}</div>`;
  }
  function stepsCard(r){
    const d=state.draft.settings,st=status(),n=state.sel.size;
    const info={identity:d.publicName?esc(d.publicName):'Dê um nome para a loja.',products:n?`${n} ${n===1?'produto':'produtos'} na loja`:'Nenhum produto escolhido ainda.',whatsapp:K.validPhone(d.contactPhone)?esc(K.formatPhone(d.contactPhone)):'Informe o número que recebe os pedidos.',
      publish:st==='published'?(pendingPublish()?'Há alterações esperando publicação.':publicationUnknown()?'Abra a loja para conferir a versão que seus clientes veem.':'Publicada. Envie o link aos clientes.'):st==='paused'?'Loja pausada: o link mostra que ela está indisponível.':'Quando estiver pronta, publique e compartilhe o link.'};
    const action={identity:['design','Personalizar'],products:['products','Escolher produtos'],whatsapp:['design','Configurar']};
    return `<section class="lo-panel lo-steps" aria-labelledby="lo-steps-title"><header class="lo-panel-head"><div><h2 id="lo-steps-title">Prepare sua loja</h2><p>${r.done} de 4 etapas concluídas</p></div><span class="lo-meter" aria-hidden="true"><i style="width:${r.done*25}%"></i></span></header><ol>${r.steps.map((s,i)=>{
      const next=r.next===s.id,btn=s.id==='publish'?(st==='published'&&!pendingPublish()&&!publicationUnknown()?`<button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="share">Compartilhar</button>`:`<button type="button" class="lo-btn ${next?'lo-btn-primary':'lo-btn-quiet'} lo-btn-sm" data-act="ask-publish" ${!owner()||state.busy?'disabled':''}>${st==='paused'?'Retomar':st==='published'?'Publicar alterações':'Publicar'}</button>`):`<button type="button" class="lo-btn ${next?'lo-btn-primary':'lo-btn-quiet'} lo-btn-sm" data-act="view" data-v="${action[s.id][0]}" data-focus="${s.id}">${action[s.id][1]}</button>`;
      return `<li class="lo-step ${s.done?'is-done':''} ${next?'is-next':''}"><span class="lo-step-n" aria-hidden="true">${s.done?SVG.check:i+1}</span><div class="lo-step-copy"><b>${s.title}<span class="lo-sr">${s.done?' — concluída':' — pendente'}</span></b><small>${info[s.id]}</small></div>${btn}</li>`;}).join('')}</ol></section>`;
  }
  function factsCard(){
    const sel=[...state.sel].map(id=>index.byId.get(id)).filter(Boolean),feat=sel.filter(p=>featured(p.id)).length,noPhoto=sel.filter(p=>!p.image).length,out=sel.filter(soldOut).length,available=index.list.length,phone=state.draft.settings.contactPhone,reg=state.data.orderReception?.enabled===true;
    const row=(label,value,act,scope)=>`<li><span>${label}</span><b>${value}</b>${act?`<button type="button" class="lo-link-btn" data-act="filter-go" data-scope="${scope}">${act}</button>`:''}</li>`;
    return `<section class="lo-panel lo-facts" aria-labelledby="lo-facts-title"><header class="lo-panel-head"><h2 id="lo-facts-title">Resumo da vitrine</h2><button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="view" data-v="products">Gerenciar produtos</button></header><ul>
      ${row('Produtos na loja',`${sel.length} de ${available}`,'','')}${row('Em destaque',feat,feat?'Ver':'', 'featured')}${noPhoto?row('Sem foto',noPhoto,'Ver','nophoto'):''}${out?row('Esgotados',out,'Ver','soldout'):''}
      <li><span>Como o cliente finaliza</span><b>${reg?'Pedido registrado no VECONI':K.validPhone(phone)?'Pelo WhatsApp':'WhatsApp não configurado'}</b></li></ul></section>`;
  }
  function moreCard(){
    const st=status();
    return `<details class="lo-panel lo-more" ${state.receptionConfirm!==null||state.receptionMessage?'open':''}><summary><span><b>Mais opções</b><small>Endereço da loja, pedidos registrados e pausa</small></span>${icon('chevron-down')}</summary>
      <div class="lo-more-body">
        <div class="lo-more-block"><h3>Endereço da loja</h3><p>Ao trocar, o link antigo continua abrindo esta mesma loja.</p><div class="lo-inline-form"><div class="lo-affix"><span>…?loja=</span><input data-slug value="${esc(state.errors.slugValue??state.draft.slug)}" maxlength="48" autocapitalize="off" spellcheck="false" aria-label="Endereço da loja" ${owner()?'':'disabled'}></div><button type="button" class="lo-btn lo-btn-quiet" data-act="save-slug" ${owner()?'':'disabled'}>Salvar endereço</button></div><small class="lo-error" role="alert">${esc(state.errors.slug||'')}</small></div>
        <div class="lo-more-block">${receptionPanel()}</div>
        ${st==='published'?`<div class="lo-more-block"><h3>Pausar a loja</h3><p>O link continua existindo, mas mostra que a loja está indisponível. Produtos e configurações ficam guardados.</p><button type="button" class="lo-btn lo-btn-danger-quiet" data-act="ask-pause" ${owner()&&!state.busy?'':'disabled'}>${icon('pause')}<span>Pausar loja</span></button></div>`:''}
      </div></details>`;
  }
  // Recebimento de pedidos registrados (fluxo existente, com reserva de estoque). Textos e regras preservados.
  function receptionPanel(){
    const r=state.data.orderReception||{enabled:false,canEnable:false,reason:'backend_update_required'},enabled=r.enabled===true,
      name=spaces().find(s=>s.id===state.spaceId)?.name||'este espaço',pending=state.receptionConfirm;
    const reasons={not_published:'Publique esta loja antes de ativar os pedidos.',publication_required:'Atualize a publicação deste espaço antes de ativar os pedidos.',sales_disabled:'Este espaço não está habilitado para vendas.',delivery_required:'Configure entrega ou retirada antes de ativar os pedidos.',payment_required:'Configure uma preferência de pagamento antes de ativar os pedidos.',backend_update_required:'Atualize a conexão da loja para verificar o recebimento de pedidos.'};
    return `<section class="store-reception" aria-labelledby="store-reception-title"><div class="store-reception-summary"><div><h3 id="store-reception-title">Pedidos registrados no VECONI</h3><span class="lo-status ${enabled?'lo-status-published':'lo-status-draft'}">${enabled?'Recebendo pedidos':'Pedidos pausados'}</span><p>${esc(reasons[r.reason]||(enabled?'Clientes podem finalizar pedidos nesta loja.':'Pedidos registrados pausados. O WhatsApp continua disponível quando configurado.'))}</p><p class="lo-note">Opcional. Com isso ativo, o pedido é registrado em Pedidos online e reserva estoque por 30 minutos. Sem ele, o cliente envia o pedido pelo WhatsApp e nada é reservado.</p></div><button type="button" class="lo-btn ${enabled?'lo-btn-quiet':'lo-btn-primary'}" data-reception ${state.busy||!state.data.owner||!enabled&&!r.canEnable?'disabled':''}>${enabled?'Pausar pedidos':'Ativar pedidos'}</button></div>${!state.data.owner?'<p>Somente o proprietário pode alterar o recebimento.</p>':''}${pending!==null?`<div class="store-reception-confirm" role="group" aria-labelledby="store-reception-confirm-title"><h3 id="store-reception-confirm-title">${pending?'Ativar':'Pausar'} pedidos em “${esc(name)}”?</h3><p>${pending?'Clientes poderão enviar pedidos e reservar estoque ao finalizar o checkout. Nenhuma cobrança automática será iniciada.':'Novos pedidos serão bloqueados. Pedidos e reservas já existentes continuam seguindo suas regras de atendimento e expiração.'}</p><p>Somente esta loja será alterada. Alterações não salvas de tema e catálogo não serão publicadas.</p><div class="lo-actions"><button type="button" class="lo-btn lo-btn-quiet" data-reception-cancel ${state.busy?'disabled':''}>Voltar</button><button type="button" class="lo-btn lo-btn-primary" data-reception-confirm ${state.busy?'disabled':''}>${state.busy?'Confirmando…':pending?'Confirmar ativação':'Confirmar pausa'}</button></div></div>`:''}<p class="store-reception-message" role="status" aria-live="polite">${esc(state.receptionMessage)}</p></section>`;
  }
  async function changeReception(){
    if(state.busy||!state.data.owner||typeof state.receptionConfirm!=='boolean')return;
    const enabled=state.receptionConfirm,c=scope(),sequence=state.sequence,revision=state.data.store?.revision;
    state.busy=true;draw();
    try{
      const result=await call('saveOnlineStore',{...c,action:'set_order_reception',enabled,confirmed:true,revision});
      if(sequence!==state.sequence||c.businessId!==business()||c.spaceId!==state.spaceId)return;
      if(result.orderReception?.enabled!==enabled)throw Error('A alteração ainda não foi confirmada. Recarregue a loja para verificar.');
      state.data.store=result.store;state.data.orderReception=result.orderReception;
      if(state.base?.settings)state.base.settings.checkoutEnabled=result.store.checkoutEnabled;
      if(state.draft?.settings)state.draft.settings.checkoutEnabled=result.store.checkoutEnabled;
      state.receptionConfirm=null;
      state.receptionMessage=enabled?'Pedidos ativados somente neste espaço.':'Novos pedidos pausados somente neste espaço. Pedidos existentes foram preservados.';
      if(state.live)state.live={...state.live,revision:result.store.revision};
    }catch(e){if(sequence===state.sequence&&c.businessId===business())state.receptionMessage=`Não foi possível confirmar a alteração. Recarregue a loja antes de tentar novamente. ${e.message}`;}
    finally{if(sequence===state.sequence&&c.businessId===business()){state.busy=false;draw();}}
  }

  /* ---------- Produtos ---------- */
  function categories(){const set=new Set();for(const p of index.list)set.add(categoryOf(p));return [...set].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
  function matches(p,scopeName){
    switch(scopeName){case 'in':return state.sel.has(p.id);case 'out':return !state.sel.has(p.id);case 'featured':return featured(p.id);case 'nophoto':return state.sel.has(p.id)&&!p.image;case 'soldout':return state.sel.has(p.id)&&soldOut(p);default:return true;}
  }
  function baseResults(){const q=norm(state.filter.q).split(/\s+/).filter(Boolean),cat=state.filter.category;return index.list.filter(p=>(!cat||categoryOf(p)===cat)&&q.every(t=>p.search.includes(t)));}
  function scopes(base){const defs=[['all','Todos'],['in','Na loja'],['out','Fora da loja'],['featured','Destaques']];if(state.filter.scope==='nophoto'||base.some(p=>matches(p,'nophoto')))defs.push(['nophoto','Sem foto']);if(state.filter.scope==='soldout'||base.some(p=>matches(p,'soldout')))defs.push(['soldout','Esgotados']);return defs.map(([id,label])=>({id,label,count:base.reduce((n,p)=>n+(matches(p,id)?1:0),0)}));}
  function productsView(){
    if(!index.list.length)return `<section class="lo-panel lo-empty"><h2>Nenhum produto disponível neste espaço</h2><p>Cadastre produtos em Produtos. Eles aparecem aqui para você escolher o que vai para a loja.</p><a class="lo-btn lo-btn-primary" href="#/produtos">${icon('plus')}<span>Cadastrar produtos</span></a></section>`;
    const cats=categories();
    return `<div class="lo-products ${state.selecting?'is-selecting':''}"><div class="lo-toolbar"><label class="lo-search">${icon('search')}<span class="lo-sr">Buscar por nome, código ou categoria</span><input type="search" data-q value="${esc(state.filter.q)}" placeholder="Buscar produtos" autocomplete="off"></label>
      <label class="lo-select"><span class="lo-sr">Categoria</span><select data-category><option value="">Todas as categorias</option>${cats.map(c=>`<option ${c===state.filter.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
      <div class="lo-toolbar-actions"><button type="button" class="lo-btn lo-btn-quiet" data-act="select-mode" aria-pressed="${state.selecting}">${icon('list-checks')}<span>${state.selecting?'Concluir seleção':'Selecionar vários'}</span></button><button type="button" class="lo-btn lo-btn-quiet" data-act="organize" ${state.sel.size?'':'disabled'}>${icon('arrow-up-down')}<span>Organizar</span></button></div></div>
      <div class="lo-chips" role="group" aria-label="Filtrar produtos" data-region-chips>${chips()}</div>
      <p class="lo-count" data-count="line" aria-live="polite"></p>
      <div class="lo-grid" data-grid role="list"></div><div class="lo-more-sentinel" data-more></div>
      ${state.selecting?bulkBar():''}</div>`;
  }
  function chips(){return scopes(baseResults()).map(s=>`<button type="button" class="lo-chip" data-act="scope" data-scope="${s.id}" aria-pressed="${state.filter.scope===s.id}">${s.label}<b>${s.count}</b></button>`).join('');}
  function bulkBar(){const n=state.picked.size;return `<div class="lo-bulk" role="region" aria-label="Ações em lote"><span><b data-count="picked">${n}</b> selecionados</span><button type="button" class="lo-link-btn" data-act="pick-all">Selecionar os ${state.results.length} resultados</button><div class="lo-bulk-actions"><button type="button" class="lo-btn lo-btn-primary lo-btn-sm" data-act="bulk" data-op="in" ${n?'':'disabled'}>Incluir na loja</button><button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="bulk" data-op="out" ${n?'':'disabled'}>Retirar</button><button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="bulk" data-op="star" ${n?'':'disabled'}>Destacar</button><button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="bulk" data-op="unstar" ${n?'':'disabled'}>Tirar destaque</button></div></div>`;}
  function priceText(p){return p.variable&&p.minPrice!=null?`a partir de ${K.money(p.minPrice)}`:K.money(p.price);}
  function availText(p){if(p.kind==='service')return 'Serviço';if(p.kind==='subscription')return 'Assinatura';if(p.avail===null)return p.variable?`${p.variants||'Com'} variações`:'Sem controle de estoque';if(soldOut(p))return 'Esgotado';return p.variable&&p.variants?`${p.avail} em ${p.variants} variações`:`${p.avail} em estoque`;}
  function card(p){
    const on=state.sel.has(p.id),feat=featured(p.id),picked=state.picked.has(p.id),sel=state.selecting;
    return `<article class="lo-pcard ${on?'is-on':''} ${feat?'is-featured':''} ${picked?'is-picked':''}" data-pid="${esc(p.id)}" role="listitem">
      <button type="button" class="lo-pcard-main" data-act="${sel?'pick':'toggle'}" data-id="${esc(p.id)}" role="${sel?'checkbox':'switch'}" aria-checked="${sel?picked:on}" aria-label="${esc(p.name)}, ${esc(priceText(p))}. ${sel?'Selecionar':'Mostrar na loja'}">
        <span class="lo-pcard-media">${p.image?`<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">`:`<span class="lo-pcard-initials">${esc(initials(p.name))}</span>`}<span class="lo-pcard-tick" aria-hidden="true">${SVG.check}</span></span>
        <span class="lo-pcard-body"><span class="lo-pcard-name">${esc(p.name)}</span><span class="lo-pcard-price">${esc(priceText(p))}</span><span class="lo-pcard-meta">${esc(categoryOf(p))}</span><span class="lo-pcard-avail ${soldOut(p)?'is-out':''}">${esc(availText(p))}</span></span>
        <span class="lo-pcard-state" aria-hidden="true"><span class="lo-switch"></span><span class="lo-pcard-state-on">Na loja</span><span class="lo-pcard-state-off">Fora da loja</span></span>
      </button>
      <button type="button" class="lo-star" data-act="star" data-id="${esc(p.id)}" aria-pressed="${feat}" aria-label="${feat?'Tirar dos destaques':'Destacar'}: ${esc(p.name)}" title="${feat?'Em destaque':'Destacar na loja'}">${SVG.star}</button></article>`;
  }
  function mountGrid(){
    const grid=document.querySelector('#store-v2 [data-grid]');if(!grid)return;
    state.results=baseResults().filter(p=>matches(p,state.filter.scope));state.shown=0;grid.innerHTML='';
    if(!state.results.length)grid.innerHTML=`<div class="lo-grid-empty" role="listitem"><p>${state.filter.q||state.filter.category||state.filter.scope!=='all'?'Nenhum produto com esses filtros.':'Nenhum produto.'}</p>${state.filter.q||state.filter.category||state.filter.scope!=='all'?'<button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="clear-filters">Limpar filtros</button>':''}</div>`;
    appendBatch();paintCounts();
    observer?.disconnect();
    const sentinel=document.querySelector('#store-v2 [data-more]');
    if(sentinel&&'IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))appendBatch();},{rootMargin:'600px 0px'});observer.observe(sentinel);}
  }
  function appendBatch(){
    const grid=document.querySelector('#store-v2 [data-grid]');if(!grid||state.shown>=state.results.length){paintMore();return;}
    const next=state.results.slice(state.shown,state.shown+BATCH);state.shown+=next.length;grid.insertAdjacentHTML('beforeend',next.map(card).join(''));paintMore();
  }
  function paintMore(){const el=document.querySelector('#store-v2 [data-more]');if(!el)return;const left=state.results.length-state.shown;el.innerHTML=left>0?`<button type="button" class="lo-btn lo-btn-quiet" data-act="more">Mostrar mais ${Math.min(left,BATCH)} de ${left}</button>`:'';}
  function paintCounts(){
    const root=document.querySelector('#store-v2');if(!root)return;
    root.querySelectorAll('[data-count="tab"]').forEach(el=>el.textContent=state.sel.size);
    const line=root.querySelector('[data-count="line"]');if(line)line.textContent=`${state.sel.size} de até ${LIMIT} produtos na loja. ${state.results.length} ${state.results.length===1?'resultado':'resultados'} nesta lista.`;
    const chipsEl=root.querySelector('[data-region-chips]');if(chipsEl)chipsEl.innerHTML=chips();
    const picked=root.querySelector('[data-count="picked"]');if(picked){picked.textContent=state.picked.size;root.querySelectorAll('[data-act="bulk"]').forEach(b=>b.disabled=!state.picked.size);}
  }
  function patchCard(id){
    const selector=`#store-v2 .lo-pcard[data-pid="${CSS.escape(id)}"]`;
    const el=document.querySelector(selector),p=index.byId.get(id);if(!el||!p)return;
    const focused=el.contains(document.activeElement)?document.activeElement.dataset.act:null;
    el.outerHTML=card(p);
    if(focused)document.querySelector(selector+` [data-act="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function toggle(id){
    if(!guard())return;const on=!state.sel.has(id);
    if(on&&state.sel.size>=LIMIT){toast(`A loja aceita até ${LIMIT} produtos. Retire algum antes de incluir outro.`,true);return;}
    queue({t:'select',id,on});patchCard(id);paintCounts();
  }
  function star(id){
    if(!guard())return;const on=!featured(id),ops=[];
    if(on&&!state.sel.has(id)){if(state.sel.size>=LIMIT){toast(`A loja aceita até ${LIMIT} produtos.`,true);return;}ops.push({t:'select',id,on:true});}
    ops.push({t:'feature',id,on});queue(...ops);patchCard(id);paintCounts();
    if(on)toast('Em destaque: aparece primeiro na loja.');
  }
  function bulk(op){
    if(!guard())return;const ids=[...state.picked];if(!ids.length)return;
    if(op==='in'||op==='star'){const add=ids.filter(id=>!state.sel.has(id));if(state.sel.size+add.length>LIMIT){toast(`Isso passaria do limite de ${LIMIT} produtos na loja (${state.sel.size} agora). Selecione menos itens.`,true);return;}}
    if(op==='in')queue({t:'selectMany',ids,on:true});
    else if(op==='out')queue({t:'selectMany',ids,on:false});
    else if(op==='star')queue({t:'selectMany',ids,on:true},{t:'featureMany',ids,on:true});
    else queue({t:'featureMany',ids:ids.filter(id=>state.sel.has(id)),on:false});
    const n=ids.length;state.picked=new Set();state.selecting=false;paint('view');
    toast({in:`${n} ${n===1?'produto incluído':'produtos incluídos'} na loja.`,out:`${n} ${n===1?'produto retirado':'produtos retirados'} da loja.`,star:`${n} ${n===1?'produto destacado':'produtos destacados'}.`,unstar:'Destaques removidos.'}[op]);
  }

  /* ---------- Organizar: categorias e ordem (arrastar, setas ou teclado) ---------- */
  function categoryRows(){
    const meta=new Map(state.draft.presentation.categories.map(c=>[c.internalName,c])),counts=new Map();
    for(const id of state.sel){const p=index.byId.get(id);if(p)counts.set(categoryOf(p),(counts.get(categoryOf(p))||0)+1);}
    return [...counts.keys()].sort((a,b)=>(meta.get(a)?.order??999)-(meta.get(b)?.order??999)||a.localeCompare(b,'pt-BR')).map(name=>({name,publicName:meta.get(name)?.publicName||name,count:counts.get(name)}));
  }
  function productRows(cat){
    return [...state.sel].map(id=>index.byId.get(id)).filter(p=>p&&categoryOf(p)===cat).sort((a,b)=>Number(featured(b.id))-Number(featured(a.id))||(Number(pres(a.id).order)||9999)-(Number(pres(b.id).order)||9999)||a.name.localeCompare(b.name,'pt-BR'));
  }
  function organizeSheet(){
    const cats=categoryRows();if(!state.sortCategory||!cats.some(c=>c.name===state.sortCategory))state.sortCategory=cats[0]?.name||'';
    const rows=productRows(state.sortCategory),move=(kind,key,label,i,len)=>`<button type="button" class="lo-icon-btn" data-act="move" data-kind="${kind}" data-key="${esc(key)}" data-dir="-1" aria-label="Mover ${esc(label)} para cima" ${i===0?'disabled':''}>${icon('chevron-up')}</button><button type="button" class="lo-icon-btn" data-act="move" data-kind="${kind}" data-key="${esc(key)}" data-dir="1" aria-label="Mover ${esc(label)} para baixo" ${i===len-1?'disabled':''}>${icon('chevron-down')}</button>`;
    return `<div class="lo-sheet-backdrop" data-act="close-sheet"></div><section class="lo-sheet lo-sheet-wide" role="dialog" aria-modal="true" aria-labelledby="lo-organize-title"><header class="lo-sheet-head"><div><h2 id="lo-organize-title">Organizar a vitrine</h2><p>Arraste pela alça, use as setas ou Alt + ↑/↓. Cada mudança é salva no rascunho.</p></div><button type="button" class="lo-icon-btn" data-act="close-sheet" aria-label="Fechar">${icon('x')}</button></header>
      <div class="lo-organize"><section aria-labelledby="lo-cat-title"><h3 id="lo-cat-title">Categorias</h3><p class="lo-note">A primeira aparece primeiro. O nome exibido vale só para a loja.</p><ol class="lo-sortable" data-sortable="categories">${cats.map((c,i)=>`<li class="lo-sort-row" data-key="${esc(c.name)}"><span class="lo-handle" data-drag tabindex="0" role="button" aria-label="Arrastar ${esc(c.publicName)}. Use Alt mais setas para mover.">${SVG.grip}</span><input class="lo-rename" data-rename="${esc(c.name)}" value="${esc(c.publicName)}" maxlength="100" aria-label="Nome exibido para ${esc(c.name)}" ${owner()?'':'disabled'}><small>${c.count}</small>${move('categories',c.name,c.publicName,i,cats.length)}</li>`).join('')}</ol></section>
      <section aria-labelledby="lo-prod-title"><h3 id="lo-prod-title">Ordem dos produtos</h3><div class="lo-chips lo-chips-tight" role="group" aria-label="Categoria">${cats.map(c=>`<button type="button" class="lo-chip" data-act="sort-category" data-key="${esc(c.name)}" aria-pressed="${c.name===state.sortCategory}">${esc(c.publicName)}</button>`).join('')}</div><p class="lo-note">Destaques ficam no topo da categoria.</p><ol class="lo-sortable" data-sortable="products">${rows.map((p,i)=>`<li class="lo-sort-row" data-key="${esc(p.id)}"><span class="lo-handle" data-drag tabindex="0" role="button" aria-label="Arrastar ${esc(p.name)}. Use Alt mais setas para mover.">${SVG.grip}</span><span class="lo-sort-thumb">${p.image?`<img src="${esc(p.image)}" alt="">`:esc(initials(p.name))}</span><span class="lo-sort-name">${esc(p.name)}${featured(p.id)?' <em class="lo-tag">Destaque</em>':''}</span>${move('products',p.id,p.name,i,rows.length)}</li>`).join('')||'<li class="lo-note">Nenhum produto nesta categoria.</li>'}</ol></section></div>
      <footer class="lo-sheet-foot"><button type="button" class="lo-btn lo-btn-primary" data-act="close-sheet">Concluir</button></footer></section>`;
  }
  function commitOrder(kind,keys){
    if(!guard())return;
    if(kind==='categories')queue({t:'categoryOrder',names:keys});
    else queue({t:'order',ids:keys});
  }
  function moveRow(kind,key,dir){
    const keys=kind==='categories'?categoryRows().map(c=>c.name):productRows(state.sortCategory).map(p=>p.id),i=keys.indexOf(key),j=i+dir;if(i<0||j<0||j>=keys.length)return;
    [keys[i],keys[j]]=[keys[j],keys[i]];commitOrder(kind,keys);paint('sheet');
    requestAnimationFrame(()=>{const row=document.querySelector(`#store-v2 [data-sortable="${kind}"] [data-key="${CSS.escape(key)}"]`);(row?.querySelector(`[data-dir="${dir}"]:not(:disabled)`)||row?.querySelector('[data-drag]'))?.focus();});
  }
  function bindSortables(){
    document.querySelectorAll('#store-v2 [data-sortable]').forEach(list=>{
      list.querySelectorAll('[data-drag]').forEach(handle=>{
        handle.addEventListener('keydown',e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();moveRow(list.dataset.sortable,handle.closest('[data-key]').dataset.key,e.key==='ArrowUp'?-1:1);}});
        handle.addEventListener('pointerdown',e=>{
          if(!owner())return;e.preventDefault();const row=handle.closest('.lo-sort-row'),rows=()=>[...list.querySelectorAll('.lo-sort-row')];
          row.classList.add('is-dragging');handle.setPointerCapture?.(e.pointerId);
          const onMove=ev=>{const y=ev.clientY,target=rows().find(r=>r!==row&&(()=>{const b=r.getBoundingClientRect();return y>b.top&&y<b.bottom;})());if(!target)return;const b=target.getBoundingClientRect();list.insertBefore(row,y<b.top+b.height/2?target:target.nextSibling);};
          const onUp=()=>{handle.removeEventListener('pointermove',onMove);handle.removeEventListener('pointerup',onUp);handle.removeEventListener('pointercancel',onUp);row.classList.remove('is-dragging');commitOrder(list.dataset.sortable,rows().map(r=>r.dataset.key));paint('sheet');};
          handle.addEventListener('pointermove',onMove);handle.addEventListener('pointerup',onUp);handle.addEventListener('pointercancel',onUp);
        });
      });
    });
  }

  /* ---------- Aparência ---------- */
  function fieldHtml({key,label,value,type='text',max=300,hint='',placeholder='',multiline=false,inputmode='',autocomplete='off',required=false,disabled=false}){
    const err=state.errors[key+'Error']||'',id=`lo-${key}`,desc=[hint?`${id}-hint`:'',`${id}-error`].filter(Boolean).join(' ');
    const attrs=`id="${id}" name="${key}" data-field="${key}" maxlength="${max}" ${placeholder?`placeholder="${esc(placeholder)}"`:''} ${inputmode?`inputmode="${inputmode}"`:''} autocomplete="${autocomplete}" aria-describedby="${desc}" ${err?'aria-invalid="true"':''} ${required?'required':''} ${disabled?'disabled':''}`;
    return `<div class="lo-field"><label for="${id}">${label}${required?'':' <span class="lo-optional">(opcional)</span>'}</label>${multiline?`<textarea ${attrs} rows="3">${esc(value)}</textarea>`:`<input type="${type}" ${attrs} value="${esc(value)}">`}${max>=120&&multiline?`<small class="lo-counter" data-counter="${key}">${String(value||'').length}/${max}</small>`:''}${hint?`<small id="${id}-hint">${hint}</small>`:''}<small class="lo-error" id="${id}-error" role="alert">${esc(err)}</small></div>`;
  }
  function designView(){
    const d=state.draft.settings,ro=!owner(),current=K.paletteId(d),warn=K.colorWarning(d),pay=d.paymentMethods||[];
    const upload=uploadHtml;
    return `<div class="lo-design"><div class="lo-design-form">
      <section class="lo-panel" id="lo-sec-identity" aria-labelledby="lo-id-title"><header class="lo-panel-head"><div><h2 id="lo-id-title">Identidade</h2><p>O que o cliente vê primeiro.</p></div></header>
        ${fieldHtml({key:'publicName',label:'Nome da loja',value:d.publicName,max:100,required:true,disabled:ro})}
        ${fieldHtml({key:'welcomeText',label:'Descrição curta',value:d.welcomeText,max:300,multiline:true,placeholder:'Ex.: Doces artesanais feitos por encomenda. Entregamos no bairro.',disabled:ro})}
        ${upload('logo')}${upload('cover')}</section>
      <section class="lo-panel" id="lo-sec-style" aria-labelledby="lo-style-title"><header class="lo-panel-head"><div><h2 id="lo-style-title">Estilo</h2><p>Escolha um estilo pronto. O texto se ajusta para continuar legível.</p></div></header>
        <div class="lo-palettes" role="radiogroup" aria-label="Estilo da loja">${K.PALETTES.map(p=>{const t=K.theme({primaryColor:p.primary,secondaryColor:p.secondary});return `<button type="button" class="lo-palette" role="radio" aria-checked="${current===p.id}" data-act="palette" data-id="${p.id}" style="--pb:${t.band};--pf:${t.onBand};--pa:${t.accent};--pt:${t.onAccent}" ${ro?'disabled':''}><span class="lo-palette-band"><b>Aa</b><i></i></span><span class="lo-palette-name">${p.name}</span></button>`;}).join('')}</div>
        <details class="lo-custom lo-custom-colors" ${current==='custom'?'open':''}><summary>Cores personalizadas</summary><div class="lo-colors"><label class="lo-color"><span>Destaque <small>botões e preços</small></span><input type="color" data-color="primaryColor" value="${esc(d.primaryColor||'#0f9f94')}" ${ro?'disabled':''}></label><label class="lo-color"><span>Faixa da marca <small>topo da loja</small></span><input type="color" data-color="secondaryColor" value="${esc(d.secondaryColor||'#0b2730')}" ${ro?'disabled':''}></label></div>${warn?`<p class="lo-warn" role="status">${icon('triangle-alert')}<span>${esc(warn)}</span></p>`:''}</details></section>
      <section class="lo-panel" id="lo-sec-service" aria-labelledby="lo-service-title"><header class="lo-panel-head"><div><h2 id="lo-service-title">Atendimento e pedidos</h2><p>Para onde vão os pedidos e como o cliente recebe.</p></div></header>
        ${fieldHtml({key:'contactPhone',label:'WhatsApp que recebe os pedidos',value:d.contactPhone,type:'tel',max:30,inputmode:'tel',autocomplete:'tel',placeholder:'(11) 91234-5678',hint:'O cliente abre uma conversa com este número já com o pedido escrito.',disabled:ro})}
        ${K.validPhone(d.contactPhone)?`<a class="lo-link-btn lo-test-wa" href="https://wa.me/${esc(K.phoneDigits(d.contactPhone))}" target="_blank" rel="noopener">${icon('message-circle')}<span>Testar este número no WhatsApp</span></a>`:''}
        <fieldset class="lo-modes"><legend>Como o cliente recebe</legend>
          <label class="lo-toggle"><input type="checkbox" data-bool="pickupEnabled" ${d.pickupEnabled!==false?'checked':''} ${ro?'disabled':''}><span class="lo-switch" aria-hidden="true"></span><span><b>Retirada</b><small>O cliente busca no local.</small></span></label>
          <div data-mode-field="pickupEnabled" ${d.pickupEnabled!==false?'':'hidden'}>${fieldHtml({key:'pickupAddress',label:'Local de retirada',value:d.pickupAddress,max:300,placeholder:'Ex.: Rua das Flores, 120 — Centro',disabled:ro})}</div>
          <label class="lo-toggle"><input type="checkbox" data-bool="deliveryEnabled" ${d.deliveryEnabled?'checked':''} ${ro?'disabled':''}><span class="lo-switch" aria-hidden="true"></span><span><b>Entrega</b><small>A taxa é combinada pelo WhatsApp: a loja não calcula frete.</small></span></label>
          <div data-mode-field="deliveryEnabled" ${d.deliveryEnabled?'':'hidden'}>${fieldHtml({key:'deliveryInstructions',label:'Onde e como você entrega',value:d.deliveryInstructions,max:500,multiline:true,placeholder:'Ex.: Entregamos nos bairros Centro e Jardim, de terça a sábado.',disabled:ro})}</div>
        </fieldset>
        ${fieldHtml({key:'openingHours',label:'Horário de atendimento',value:d.openingHours,max:300,placeholder:'Ex.: Seg. a sáb., das 9h às 18h',disabled:ro})}
        ${fieldHtml({key:'address',label:'Endereço da loja',value:d.address,max:300,placeholder:'Mostrado no rodapé da loja',disabled:ro})}
        ${fieldHtml({key:'instagram',label:'Instagram',value:d.instagram,max:100,placeholder:'@sualoja',disabled:ro})}
        <details class="lo-custom"><summary>Formas de pagamento aceitas</summary><p class="lo-note">O cliente indica a preferência no pedido. Nada é cobrado pela loja online.</p><div class="lo-pay">${[['pix','Pix'],['dinheiro','Dinheiro'],['cartao','Cartão na entrega ou retirada'],['entrega','A combinar']].map(([id,label])=>`<label class="lo-check"><input type="checkbox" data-pay="${id}" ${pay.includes(id)?'checked':''} ${ro?'disabled':''}><span><b>${label}</b></span></label>`).join('')}</div></details>
      </section></div></div>`;
  }
  const UPLOADS={logo:['Logo','Imagem quadrada. JPG, PNG ou WebP até 3 MB.'],cover:['Capa','Foto larga que aparece atrás do nome. Opcional.']};
  function uploadHtml(slot){
    const d=state.draft.settings,ro=!owner(),url=d[slot+'Url']||(slot==='cover'?d.bannerUrl:''),[label,hint]=UPLOADS[slot];
    return `<div class="lo-upload" data-upload-slot="${slot}"><span class="lo-upload-thumb lo-upload-${slot}">${url?`<img src="${esc(url)}" alt="">`:icon(slot==='logo'?'image':'image-plus')}</span><div class="lo-upload-copy"><b>${label}</b><small>${hint}</small></div><div class="lo-upload-actions"><label class="lo-btn lo-btn-quiet lo-btn-sm ${ro?'is-disabled':''}">${icon('upload')}<span>${url?'Trocar':'Enviar'}</span><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${slot}" class="lo-sr" ${ro?'disabled':''}></label>${url?`<button type="button" class="lo-btn lo-btn-quiet lo-btn-sm" data-act="remove-image" data-slot="${slot}" ${ro?'disabled':''}>Remover</button>`:''}</div></div>`;
  }
  function syncUpload(slot){const el=document.querySelector(`#store-v2 [data-upload-slot="${slot}"]`);if(el){el.outerHTML=uploadHtml(slot);window.lucide?.createIcons?.();}}
  function syncPalettes(){
    const d=state.draft.settings,id=K.paletteId(d),warn=K.colorWarning(d);
    document.querySelectorAll('#store-v2 .lo-palette').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.id===id)));
    document.querySelectorAll('#store-v2 [data-color]').forEach(i=>{if(document.activeElement!==i)i.value=d[i.dataset.color]||i.value;});
    const custom=document.querySelector('#store-v2 .lo-custom-colors');if(custom){let box=custom.querySelector('.lo-warn');if(warn&&!box){custom.insertAdjacentHTML('beforeend',`<p class="lo-warn" role="status">${icon('triangle-alert')}<span></span></p>`);box=custom.querySelector('.lo-warn');window.lucide?.createIcons?.();}if(box){if(warn)box.querySelector('span').textContent=warn;else box.remove();}}
    paint('head');
  }
  const FIELD_MAX={publicName:100,welcomeText:300,contactPhone:30,instagram:100,address:300,openingHours:300,pickupAddress:300,deliveryInstructions:500};
  function validateField(key,value){
    if(key==='publicName'&&!String(value).trim())return 'Informe o nome da loja.';
    if(key==='contactPhone'&&String(value).trim())return K.phoneProblem(value);
    return '';
  }
  function onField(el){
    const key=el.dataset.field,raw=el.value,value=key==='instagram'?raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i,'').replace(/\/$/,''):raw;
    const counter=document.querySelector(`#store-v2 [data-counter="${key}"]`);if(counter)counter.textContent=`${raw.length}/${FIELD_MAX[key]||300}`;
    const err=validateField(key,value);state.errors[key+'Error']=err;
    const errEl=document.querySelector(`#store-v2 #lo-${key}-error`);if(errEl)errEl.textContent=err;el.toggleAttribute('aria-invalid',!!err);
    if(err){state.saveState=state.ops.length?state.saveState:'invalid';paint('save');return;}
    if(!guard())return;
    queue({t:'setting',key,value:key==='contactPhone'&&value.trim()?K.formatPhone(value):value.trim?value.trim():value});
  }
  async function uploadImage(input){
    const file=input.files?.[0],slot=input.dataset.upload;if(!file||!guard())return;
    const c=scope(),ticket=state.sequence;input.disabled=true;toast('Enviando imagem…');
    try{
      if(!window.ProductImages?.processImage||!window.CatalogImageStorage)throw Error('O serviço de imagens ainda está carregando. Tente de novo em instantes.');
      const processed=await ProductImages.processImage(file);if(ticket!==state.sequence)return;
      const asset=await CatalogImageStorage.upload('store',{spaceId:c.spaceId,slot},processed);if(ticket!==state.sequence)return;
      queue({t:'setting',key:slot+'Url',value:asset.imageUrl});flush();syncUpload(slot);if(slot==='logo')paint('head');toast('Imagem enviada. Salvando no rascunho…');
    }catch(e){toast(e.message||'Não foi possível enviar a imagem.',true);}finally{input.disabled=false;}
  }

  /* ---------- Prévia ao vivo (a própria loja pública, alimentada pelo rascunho) ---------- */
  function previewPanel(){
    return `<section class="lo-panel lo-preview" aria-labelledby="lo-preview-title"><header class="lo-panel-head"><div><h2 id="lo-preview-title">Prévia</h2><p>Rascunho. O cliente só vê depois de publicar.</p></div><div class="lo-seg" role="group" aria-label="Tamanho da prévia"><button type="button" data-act="device" data-v="phone" aria-pressed="${state.device==='phone'}">${icon('smartphone')}<span class="lo-sr">Celular</span></button><button type="button" data-act="device" data-v="desktop" aria-pressed="${state.device==='desktop'}">${icon('monitor')}<span class="lo-sr">Computador</span></button></div></header>
      <div class="lo-stage is-${state.device}" data-stage><div class="lo-device"><iframe class="lo-preview-frame" src="${esc(previewSrc())}" title="Prévia da loja como o cliente vê" loading="lazy"></iframe></div></div>
      <button type="button" class="lo-btn lo-btn-quiet lo-btn-wide" data-act="fullpreview">${icon('maximize-2')}<span>Abrir prévia em tela cheia</span></button></section>`;
  }
  function previewCatalog(){
    const d=state.draft;let s;try{s=M.settings(d.settings);}catch{s={...d.settings};}
    const items=d.productIds.map(id=>index.byId.get(id)).filter(Boolean).map(p=>{
      const raw=index.local.products.get(p.id);let item=null;
      if(raw)try{item=M.product(raw,index.local.variants,d.presentation);}catch{item=null;}
      if(!item){const x=pres(p.id);item={...p.src,category:x.category||p.baseCategory,featured:!!x.featured,displayOrder:Number(x.order||0),active:true};}
      return item;});
    let categories=[];try{categories=M.publicPresentation(d.presentation).categories;}catch{}
    return {preview:true,schemaVersion:6,catalogType:'space_store',businessId:business(),spaceId:state.spaceId,...s,publicName:s.publicName||spaceName(),publicSettings:s,items,categories,banners:[],
      serviceModes:[...(s.pickupEnabled?[{id:'pickup',type:'pickup',label:'Retirada',active:true}]:[]),...(s.deliveryEnabled?[{id:'delivery',type:'delivery',label:'Entrega',active:true}]:[])],
      acceptingOrders:state.data.orderReception?.enabled===true,active:true,catalogVisible:true};
  }
  function sendPreview(){
    const frames=document.querySelectorAll('.lo-preview-frame');if(!frames.length||!state.draft)return;
    const message={type:'veconi-store-preview',catalog:previewCatalog()};
    frames.forEach(f=>{try{f.contentWindow?.postMessage(message,location.origin);}catch{}});
  }
  function schedulePreview(){clearTimeout(previewTimer);previewTimer=setTimeout(sendPreview,140);}
  function mountPreviews(){
    document.querySelectorAll('#store-v2 .lo-preview-frame').forEach(frame=>{if(!frame.dataset.bound){frame.dataset.bound='1';frame.addEventListener('load',sendPreview);}});
    document.querySelectorAll('#store-v2 [data-stage]').forEach(stage=>{
      const fit=()=>{const w=stage.clientWidth,base=stage.classList.contains('is-desktop')?1280:390;stage.style.setProperty('--scale',String(Math.min(1,w/base)));};
      fit();if(!stage.dataset.observed&&'ResizeObserver' in window){stage.dataset.observed='1';new ResizeObserver(fit).observe(stage);}
    });
    schedulePreview();
  }
  globalThis.addEventListener?.('message',e=>{if(e.origin===location.origin&&e.data?.type==='veconi-store-preview-ready')sendPreview();});

  /* ---------- Folhas: publicar, pausar, compartilhar, prévia ---------- */
  function sheet(){
    const t=state.sheet?.type;if(!t)return '';
    if(t==='organize')return organizeSheet();
    if(t==='preview')return `<div class="lo-sheet-backdrop" data-act="close-sheet"></div><section class="lo-sheet lo-sheet-full" role="dialog" aria-modal="true" aria-label="Prévia da loja"><header class="lo-sheet-head"><div><h2>Prévia da loja</h2><p>Rascunho: teste o carrinho e veja a mensagem do pedido. Nada é enviado.</p></div><button type="button" class="lo-icon-btn" data-act="close-sheet" aria-label="Fechar prévia">${icon('x')}</button></header><iframe class="lo-preview-frame lo-preview-full" src="${esc(previewSrc())}" title="Prévia da loja em tela cheia"></iframe></section>`;
    if(t==='share')return shareSheet();
    const st=status(),r=readiness(),pause=t==='pause',resume=!pause&&st==='paused',d=state.draft.settings,phoneOk=K.validPhone(d.contactPhone),url=publicUrl(),diff=diffList();
    const check=(ok,label,warn)=>`<li class="${ok?'is-ok':'is-warn'}">${ok?SVG.check:icon('triangle-alert')}<span>${ok?label:warn}</span></li>`;
    const title=pause?'Pausar a loja?':st==='paused'?'Retomar a loja?':st==='published'?'Publicar alterações?':'Publicar a loja?';
    const body=pause?'<p>O link continua existindo, mas o cliente verá que a loja está indisponível. Seus produtos e configurações ficam guardados para quando você retomar.</p>'
      :resume?'<p>A última vitrine publicada ficará disponível novamente. Para aplicar as edições do rascunho, use Publicar alterações depois de retomar.</p>'
      :`<ul class="lo-checklist">${check(!!d.publicName,`Nome: ${esc(d.publicName)}`,'Falta o nome da loja')}${check(state.sel.size>0,`${state.sel.size} ${state.sel.size===1?'produto':'produtos'} na vitrine`,'Nenhum produto escolhido')}${check(phoneOk,`Pedidos pelo WhatsApp ${esc(K.formatPhone(d.contactPhone))}`,'Sem WhatsApp: o cliente vê a loja, mas não consegue enviar o pedido')}${d.pickupEnabled===false&&!d.deliveryEnabled?check(false,'','Nem retirada nem entrega ativas: o pedido vai sem forma de recebimento'):''}</ul>${st==='published'&&diff.length?`<p>Vai mudar: ${esc(diff.join(', '))}.</p>`:''}<p>Qualquer pessoa com o link ${url?`<b>${esc(shortUrl(url))}</b> `:''}poderá ver a loja. Você pode pausar quando quiser.</p>`;
    const explicit=!pause&&!resume;
    return `<div class="lo-sheet-backdrop" data-act="close-sheet"></div><section class="lo-sheet" role="dialog" aria-modal="true" aria-labelledby="lo-sheet-title"><header class="lo-sheet-head"><div><h2 id="lo-sheet-title">${title}</h2></div><button type="button" class="lo-icon-btn" data-act="close-sheet" aria-label="Fechar">${icon('x')}</button></header><div class="lo-sheet-body">${body}${explicit&&!phoneOk?`<button type="button" class="lo-link-btn" data-act="view" data-v="design" data-focus="whatsapp">Configurar WhatsApp agora</button>`:''}</div><footer class="lo-sheet-foot"><button type="button" class="lo-btn lo-btn-quiet" data-act="close-sheet">Voltar</button><button type="button" class="lo-btn ${pause?'lo-btn-danger':'lo-btn-primary'}" data-act="${pause?'do-pause':'do-publish'}" ${explicit&&!r.canPublish||state.busy?'disabled':''}>${pause?'Pausar loja':resume?'Retomar loja':st==='published'?'Publicar alterações':'Publicar loja'}</button></footer></section>`;
  }
  function shareSheet(){
    const url=publicUrl(),st=status(),name=state.live?.publicName,text=`${name?`Conheça a loja ${name}.`:'Conheça nossa loja.'} ${url}`;
    return `<div class="lo-sheet-backdrop" data-act="close-sheet"></div><section class="lo-sheet" role="dialog" aria-modal="true" aria-labelledby="lo-share-title"><header class="lo-sheet-head"><div><h2 id="lo-share-title">Compartilhar a loja</h2><p>${st==='published'?'Envie o link para clientes, coloque na bio do Instagram ou imprima o QR Code.':'O link só funciona depois de publicar a loja.'}</p></div><button type="button" class="lo-icon-btn" data-act="close-sheet" aria-label="Fechar">${icon('x')}</button></header>
      <div class="lo-sheet-body"><div class="lo-share-link"><input readonly value="${esc(url)}" aria-label="Link da loja"><button type="button" class="lo-btn lo-btn-primary" data-act="copy">${icon('copy')}<span>Copiar</span></button></div>
      <div class="lo-share-actions"><a class="lo-btn lo-btn-quiet" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon('message-circle')}<span>Enviar pelo WhatsApp</span></a>${navigator.share?`<button type="button" class="lo-btn lo-btn-quiet" data-act="native-share">${icon('share-2')}<span>Mais opções</span></button>`:''}<button type="button" class="lo-btn lo-btn-quiet" data-act="qr">${icon('qr-code')}<span>QR Code</span></button></div><div id="store-qr" class="lo-qr"></div></div></section>`;
  }
  function openSheet(type){state.sheet={type,opener:document.activeElement};paint('sheet');document.body.classList.add('lo-sheet-open');requestAnimationFrame(()=>document.querySelector('#store-v2 .lo-sheet [data-act]:not(.lo-sheet-backdrop), #store-v2 .lo-sheet input, #store-v2 .lo-sheet button')?.focus());}
  function closeSheet(){const opener=state.sheet?.opener;state.sheet=null;paint('sheet');document.body.classList.remove('lo-sheet-open');if(opener?.isConnected)opener.focus();}
  async function publish(kind){
    if(state.busy||!owner())return;
    const ticket=state.sequence;
    if(!(await settle())){toast('Salve as alterações pendentes antes de publicar.',true);return;}
    if(ticket!==state.sequence||state.busy||!owner())return;
    const wanted=kind!=='pause',resume=wanted&&status()==='paused',explicit=wanted&&!resume;
    if(explicit&&!readiness().canPublish){toast('Dê um nome e escolha ao menos um produto antes de publicar.',true);return;}
    const c=scope(),d=state.base,payload=K.savePayload(d);
    state.busy=true;state.sheet=null;document.body.classList.remove('lo-sheet-open');draw();
    try{
      payload.settings=M.settings({...d.settings,checkoutEnabled:store()?.checkoutEnabled===true});
      const revision=store()?.revision||0;
      const r=await call('saveOnlineStore',{...c,action:'publish',confirmed:true,published:wanted,revision,...(explicit?payload:{})});
      if(ticket!==state.sequence)return;
      if(r?.store?.published!==wanted||!confirmsDraft(r.store,payload,revision))throw Error('O servidor não confirmou a publicação. Recarregue a loja para conferir.');
      state.data.store=r.store;state.base=K.draftFromStore(r.store,spaceName());refreshDraft();
      state.unpublished=explicit?false:null;state.live=null;state.liveMissing=false;
      state.saveState=explicit?'published':resume?'resumed':'paused';state.savedAt=Date.now();
      state.data.orderReception=null;state.receptionConfirm=null;state.receptionMessage='';
      toast(explicit?'Loja publicada. O link já mostra esta versão.':resume?'Loja retomada com a última vitrine publicada.':'Loja pausada. O link mostra que ela está indisponível.');
      readLive();
      refreshReception(c,ticket,r.store.revision);
    }catch(e){if(ticket===state.sequence)toast(`Não foi possível ${explicit?'publicar':resume?'retomar':'pausar'}: ${friendly(e)}`,true);}
    finally{if(ticket===state.sequence){state.busy=false;draw();}}
  }
  async function refreshReception(c,ticket,revision){
    try{
      const result=await call('getOnlineStore',c);
      if(ticket!==state.sequence||store()?.revision!==revision||result.store?.revision!==revision)return;
      state.data.orderReception=result.orderReception;
      if(state.view==='home')paint('main');
    }catch{/* A interface mantém a recepção indisponível até uma nova leitura. */}
  }
  async function qr(){
    const link=publicUrl(),sequence=state.sequence;
    try{
      if(!link)throw Error('Salve a loja primeiro.');
      if(!window.qrcode)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=`${window.OnlineStoreAssetBase||'./'}assets/qrcode.min.js`;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Não foi possível carregar o QR Code.'));};document.head.appendChild(s);});
      const node=document.querySelector('#store-qr');if(!node||sequence!==state.sequence)return;
      const code=window.qrcode(0,'M');code.addData(link);code.make();node.innerHTML=code.createImgTag(5,12,'QR Code da loja');
      const image=node.querySelector('img'),download=document.createElement('button');image.style.maxWidth='100%';image.style.height='auto';
      download.type='button';download.className='lo-btn lo-btn-quiet lo-btn-sm';download.textContent='Baixar QR Code';
      download.onclick=()=>{const a=document.createElement('a');a.href=image.src;a.download=`loja-${store().slug}.gif`;a.click();};node.appendChild(download);
    }catch(e){toast(e.message,true);}
  }

  /* ---------- Barra de salvamento ---------- */
  function saveBar(){
    const s=state.saveState,time=state.savedAt?new Date(state.savedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
    if(status()==='new')return '';
    if(!owner())return `<div class="lo-savebar is-readonly">${icon('lock')}<span>Somente o proprietário pode alterar esta loja. Você está vendo a configuração atual.</span></div>`;
    if(s==='error')return `<div class="lo-savebar is-error" role="alert">${icon('cloud-off')}<span><b>Não salvo.</b> ${esc(state.saveError)}</span><div class="lo-savebar-actions"><button type="button" class="lo-btn lo-btn-sm lo-btn-primary" data-act="retry-save">Tentar de novo</button><button type="button" class="lo-btn lo-btn-sm lo-btn-quiet" data-act="discard">Descartar</button></div></div>`;
    if(s==='invalid')return `<div class="lo-savebar is-warn" role="status">${icon('pencil')}<span>Corrija o campo destacado para salvar.</span></div>`;
    if(state.ops.length||state.inflight)return `<div class="lo-savebar is-saving" role="status"><span class="lo-spinner" aria-hidden="true"></span><span>${state.inflight?'Salvando no rascunho…':'Alterações pendentes…'}</span></div>`;
    const pending=pendingPublish();
    if(pending)return `<div class="lo-savebar is-publish" role="status">${icon('cloud-check')}<span>${s==='saved'?`Rascunho salvo às ${time}. `:''}O cliente ainda vê a versão anterior.</span><div class="lo-savebar-actions"><button type="button" class="lo-btn lo-btn-sm lo-btn-primary" data-act="ask-publish" ${state.busy?'disabled':''}>Publicar alterações</button></div></div>`;
    if(s==='published'&&status()==='published')return `<div class="lo-savebar is-saved" role="status">${icon('globe')}<span>Publicado às ${time}. O link já mostra esta versão.</span></div>`;
    if(s==='resumed'&&status()==='published')return `<div class="lo-savebar is-saved" role="status">${icon('globe')}<span>Última vitrine retomada às ${time}.${publicationUnknown()?' Confira a vitrine antes de publicar alterações.':''}</span></div>`;
    return s==='saved'?`<div class="lo-savebar is-saved" role="status">${icon('cloud-check')}<span>Rascunho salvo às ${time}.</span></div>`:'';
  }

  /* ---------- Eventos (delegação: um ouvinte por raiz) ---------- */
  function toast(message,error=false){const el=document.querySelector('#store-v2 .lo-toast');if(!el){window.Utils?.toast?.(message,error);return;}el.textContent=message;el.classList.toggle('is-error',!!error);el.classList.add('is-on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-on'),error?6000:3200);}
  function goView(v,focus){
    if(state.view===v&&!focus)return;state.view=v;state.selecting=false;state.picked=new Set();paint('view');
    document.querySelectorAll('#store-v2 .lo-tabs [data-v]').forEach(b=>b.setAttribute('aria-current',b.dataset.v===v?'page':'false'));
    const root=document.querySelector('#store-v2');root.dataset.view=v;
    const target=focus==='whatsapp'?'#lo-contactPhone':focus==='identity'?'#lo-publicName':null;
    if(target)requestAnimationFrame(()=>{const el=document.querySelector(`#store-v2 ${target}`);el?.scrollIntoView?.({block:'center',behavior:'smooth'});el?.focus({preventScroll:true});});
    else root.querySelector('.lo-tabs')?.scrollIntoView?.({block:'nearest'});
  }
  function bind(root){
    if(root.dataset.bound)return;root.dataset.bound='1';
    root.addEventListener('click',onClick);
    root.addEventListener('input',e=>{
      const el=e.target;
      if(el.matches('[data-q]')){clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.filter.q=el.value;mountGrid();},120);return;}
      if(el.matches('[data-field]')){clearTimeout(el._t);el._t=setTimeout(()=>onField(el),el.tagName==='TEXTAREA'||el.type==='text'?500:300);return;}
      if(el.matches('[data-color]')){clearTimeout(el._t);el._t=setTimeout(()=>{if(!guard())return;queue({t:'setting',key:el.dataset.color,value:el.value.toLowerCase()});syncPalettes();},200);return;}
    });
    root.addEventListener('change',e=>{
      const el=e.target;
      if(el.matches('[data-space]'))return switchSpace(el);
      if(el.matches('[data-category]')){state.filter.category=el.value;mountGrid();return;}
      if(el.matches('[data-field]')){clearTimeout(el._t);onField(el);return;}
      if(el.matches('[data-bool]')){if(!guard()){el.checked=!el.checked;return;}const key=el.dataset.bool,other=key==='pickupEnabled'?'deliveryEnabled':'pickupEnabled';
        if(!el.checked&&store()?.checkoutEnabled&&!state.draft.settings[other]){el.checked=true;toast('Com pedidos registrados ativos, mantenha retirada ou entrega ligada.',true);return;}
        queue({t:'setting',key,value:el.checked});const sub=root.querySelector(`[data-mode-field="${key}"]`);if(sub)sub.hidden=!el.checked;return;}
      if(el.matches('[data-pay]')){if(!guard()){el.checked=!el.checked;return;}const list=[...root.querySelectorAll('[data-pay]:checked')].map(x=>x.dataset.pay);
        if(!list.length&&store()?.checkoutEnabled){el.checked=true;toast('Com pedidos registrados ativos, mantenha ao menos uma forma de pagamento.',true);return;}
        queue({t:'setting',key:'paymentMethods',value:list});return;}
      if(el.matches('[data-upload]'))return uploadImage(el);
    });
    root.addEventListener('submit',e=>{if(e.target.matches('[data-create]')){e.preventDefault();createStore(e.target);}});
    root.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.sheet){e.preventDefault();closeSheet();}else if(e.key==='Tab'&&state.sheet)trapFocus(e);});
    root.addEventListener('focusout',e=>{const el=e.target;if(el.matches?.('[data-rename]')&&owner()){const v=el.value.trim();const current=state.draft.presentation.categories.find(c=>c.internalName===el.dataset.rename)?.publicName||el.dataset.rename;if(v&&v!==current)queue({t:'categoryName',name:el.dataset.rename,value:v});else if(!v)el.value=current;}});
  }
  function trapFocus(e){const nodes=[...document.querySelectorAll('#store-v2 .lo-sheet :is(button,a,input,select,textarea,iframe,[tabindex="0"]):not([disabled])')];if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  async function switchSpace(el){
    if(state.ops.length||state.inflight){if(!(await settle())){el.value=state.spaceId;toast('Salve ou descarte as alterações antes de trocar de espaço.',true);return;}}
    state.spaceId=el.value;state.data=null;state.draft=null;state.base=null;state.ops=[];state.view='home';state.receptionConfirm=null;state.receptionMessage='';state.saveState='idle';state.filter={q:'',scope:'all',category:''};state.errors={};state.live=null;
    const root=document.querySelector('#store-v2');root.innerHTML='<div class="lo-loading" role="status"><span class="lo-spinner" aria-hidden="true"></span>Carregando este espaço…</div>';load();
  }
  function onClick(e){
    if(e.target.closest('[data-reception]')){if(state.busy||!state.data.owner)return;state.receptionConfirm=!state.data.orderReception?.enabled;state.receptionMessage='';draw();document.querySelector('#store-v2 .lo-more')?.setAttribute('open','');document.querySelector('#store-v2 [data-reception-cancel]')?.focus();return;}
    if(e.target.closest('[data-reception-cancel]')){state.receptionConfirm=null;draw();document.querySelector('#store-v2 [data-reception]')?.focus();return;}
    if(e.target.closest('[data-reception-confirm]')){changeReception();return;}
    const b=e.target.closest('[data-act]');if(!b||b.disabled)return;
    const act=b.dataset.act,id=b.dataset.id;
    switch(act){
      case 'view':if(state.sheet)closeSheet();return goView(b.dataset.v,b.dataset.focus);
      case 'toggle':return toggle(id);
      case 'star':return star(id);
      case 'pick':{state.picked.has(id)?state.picked.delete(id):state.picked.add(id);patchCard(id);paintCounts();return;}
      case 'pick-all':{for(const p of state.results)state.picked.add(p.id);document.querySelectorAll('#store-v2 .lo-pcard').forEach(el=>patchCard(el.dataset.pid));paintCounts();return;}
      case 'select-mode':state.selecting=!state.selecting;state.picked=new Set();paint('view');return;
      case 'bulk':return bulk(b.dataset.op);
      case 'scope':state.filter.scope=b.dataset.scope;mountGrid();return;
      case 'filter-go':state.filter={q:'',scope:b.dataset.scope,category:''};return goView('products',null);
      case 'clear-filters':state.filter={q:'',scope:'all',category:''};paint('view');return;
      case 'more':return appendBatch();
      case 'organize':return openSheet('organize');
      case 'sort-category':state.sortCategory=b.dataset.key;paint('sheet');return;
      case 'move':return moveRow(b.dataset.kind,b.dataset.key,Number(b.dataset.dir));
      case 'palette':{if(!guard())return;const p=K.PALETTES.find(x=>x.id=== b.dataset.id);if(p){queue({t:'setting',key:'primaryColor',value:p.primary},{t:'setting',key:'secondaryColor',value:p.secondary});syncPalettes();}return;}
      case 'remove-image':{if(!guard())return;const slot=b.dataset.slot,ops=[{t:'setting',key:slot+'Url',value:''}];if(slot==='cover'&&state.draft.settings.bannerUrl)ops.push({t:'setting',key:'bannerUrl',value:''});queue(...ops);syncUpload(slot);if(slot==='logo')paint('head');return;}
      case 'device':{state.device=b.dataset.v;const panel=b.closest('.lo-preview');panel?.querySelectorAll('[data-act="device"]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));const stage=panel?.querySelector('[data-stage]');if(stage){stage.classList.toggle('is-phone',state.device==='phone');stage.classList.toggle('is-desktop',state.device==='desktop');mountPreviews();}return;}
      case 'fullpreview':return openSheet('preview');
      case 'share':return openSheet('share');
      case 'ask-publish':return openSheet('publish');
      case 'ask-pause':return openSheet('pause');
      case 'do-publish':return publish('publish');
      case 'do-pause':return publish('pause');
      case 'close-sheet':return closeSheet();
      case 'retry-save':state.saveState='pending';paint('save');return flush();
      case 'discard':return discard();
      case 'save-slug':return saveSlug();
      case 'copy':return copyLink();
      case 'native-share':return navigator.share?.({title:state.draft.settings.publicName,url:publicUrl()}).catch(()=>{});
      case 'qr':return qr();
    }
  }
  async function saveSlug(){
    if(!guard())return;const input=document.querySelector('#store-v2 [data-slug]'),value=String(input?.value||'').trim().toLowerCase(),problem=K.slugProblem(value);
    state.errors.slugValue=value;state.errors.slug=problem;if(problem){paint('main');return;}
    if(value===store()?.slug){state.errors.slug='';toast('Esse já é o endereço atual.');return;}
    queue({t:'slug',value});await flush();
    if(state.saveState==='error'&&/pertence a outra loja|already/i.test(state.saveError)){state.ops=state.ops.filter(o=>o.t!=='slug');refreshDraft();state.saveState='idle';state.errors.slug='Esse endereço já pertence a outra loja. Escolha outro.';paint('save');}
    else if(state.saveState!=='error'){delete state.errors.slugValue;state.errors.slug='';toast(status()==='published'?'Endereço salvo. Os links abrem a versão pública atual.':'Endereço salvo.');}
    paint('main');paint('head');
  }
  async function copyLink(){try{if(!publicUrl())throw Error('Salve a loja primeiro.');await navigator.clipboard.writeText(publicUrl());toast('Link copiado.');}catch(e){toast(e.message||'Não foi possível copiar. Selecione o link e copie manualmente.',true);}}
  // Sair com alterações pendentes: tenta salvar e avisa o navegador.
  globalThis.addEventListener?.('hashchange',()=>{if(state.ops.length)flush();});
  globalThis.addEventListener?.('beforeunload',e=>{if(state.ops.length||state.inflight){e.preventDefault();e.returnValue='';}});
  globalThis.addEventListener?.('online',()=>{if(state.saveState==='error'&&state.ops.length)flush();});
  globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.hidden&&state.ops.length)flush();});
  window.OnlineStoreUI={render,bind:()=>load()};
})();
