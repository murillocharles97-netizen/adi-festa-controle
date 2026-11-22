// VECONI Loja Online V3 — loja pública (link compartilhável de um espaço).
// Mostra só o documento publicado (publicCatalogs/{token}): sem custos, clientes ou dados internos.
// Finalização: pelo WhatsApp da loja (padrão) ou, quando o lojista ativou, pedido registrado com reserva.
// Abrir o WhatsApp NÃO registra pedido, venda, pagamento nem baixa de estoque.
const K=window.StoreKit;
const root=document.querySelector('#catalog-app'),params=new URLSearchParams(location.search),preview=params.get('preview')==='1';
const queryToken=params.get('v'),legacyPathMatch=location.pathname.match(/\/catalogo\/([^/?#]+)/),legacyPathToken=legacyPathMatch?legacyPathMatch[1]:'';
const money=v=>K.money(v),esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])),uuid=()=>crypto.randomUUID();
const norm=v=>String(v??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const darkScheme=matchMedia('(prefers-color-scheme: dark)');
let previewTheme='';
function syncPublicTheme(){document.documentElement.dataset.storeTheme=previewTheme||(darkScheme.matches?'dark':'light');}
darkScheme.addEventListener('change',syncPublicTheme);syncPublicTheme();
let fb=null;
// Firebase só fora da prévia: a prévia do painel nunca lê nem grava nada.
async function firebase(){
  if(preview)throw Object.assign(Error('Indisponível na prévia.'),{code:'preview'});
  if(fb)return fb;
  const [cfg,fs,fn]=await Promise.all([import('./firebase/firebase-config.js'),import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js'),import('https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js')]);
  fb={db:cfg.db,functions:cfg.functions,doc:fs.doc,getDoc:fs.getDoc,httpsCallable:fn.httpsCallable};return fb;
}
const callable=async(name,data)=>{const f=await firebase();return f.httpsCallable(f.functions,name)(data);};
let visitToken=queryToken||legacyPathToken||'';
let slugResolutionError=null;
if(!preview&&params.has('loja')){
  try{const slug=String(params.get('loja')||'');if(!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug))throw Object.assign(Error('Link da loja inválido.'),{code:'not-found'});const f=await firebase();const alias=await f.getDoc(f.doc(f.db,'publicCatalogSlugs',slug));if(!alias.exists())throw Object.assign(Error('Loja não encontrada.'),{code:'not-found'});visitToken=alias.data().catalogToken||'';}
  catch(error){slugResolutionError=error;}
}
const cartKey=`adiFesta:catalogCart:${visitToken}`,noteKey=`adiCatalogNote:${visitToken}`,customerKey=`veconi:storeCustomer:${visitToken}`,serviceModeKey=`adiFesta:catalogServiceMode:${visitToken}`;
let catalog=null,view='catalog',query='',category='',sheet=null,toastTimer=0,lastFocus=null,sentUrl='',successOrder=null,renderedOnce=false;
let cart=preview?{}:read(cartKey,{}),customer=preview?{}:read(customerKey,{}),note=preview?'':read(noteKey,''),serviceModeId=preview?'':read(serviceModeKey,''),payment='',orders=[],pendingOrderAttempt=null,submittingOrder=false,errors={};
const v2=()=>Number(catalog?.schemaVersion)>=6;
const attempts=()=>window.OnlineCheckoutAttempts.create(window.DB.localRecords,visitToken);
const orderStatusCall=data=>callable('getOnlineOrderStatus',data);
function safeStorage(key,value){if(preview)return;try{localStorage.setItem(key,value);}catch{/* Checkout é durável no IndexedDB antes de qualquer envio. */}}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function save(){safeStorage(cartKey,JSON.stringify(cart));safeStorage(customerKey,JSON.stringify(customer));safeStorage(noteKey,JSON.stringify(note));}
const validVisitToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{20,128}$/.test(value);
const publicCatalogError=(code,message)=>Object.assign(new Error(message||code),{code});
function normalizedCatalogErrorCode(error){const code=String(error?.code||'').replace('firestore/','');if(code==='permission-denied')return'permission-denied';if(code==='not-found')return'not-found';if(code==='inactive')return'inactive';if(code==='paused')return'paused';return'network'}
function validatePublicCatalog(snapshot){
  if(!snapshot.exists())throw publicCatalogError('not-found','Documento público não encontrado.');
  if(snapshot.id!==visitToken)throw publicCatalogError('not-found','O token não corresponde ao ID do documento.');
  const data=snapshot.data()||{};
  if(data.legacyStoreRetired||data.schemaVersion<6||data.catalogType!=='space_store'||!data.spaceId)throw publicCatalogError('inactive','Esta loja antiga foi desativada. Peça o novo link da loja.');
  if(data.catalogToken&&data.catalogToken!==snapshot.id)throw publicCatalogError('not-found','O token publicado não corresponde ao ID do documento.');
  if(!data.visitId||!data.businessId||!data.publicName||!Array.isArray(data.items))throw publicCatalogError('not-found','Documento público incompleto.');
  // Loja pausada pelo lojista: mostra a marca e o contato, sem produtos.
  if(data.active!==true)throw Object.assign(publicCatalogError('paused','Loja pausada.'),{store:{publicName:data.publicName,logoUrl:data.logoUrl,primaryColor:data.primaryColor,secondaryColor:data.secondaryColor,contactPhone:data.contactPhone,openingHours:data.openingHours}});
  if(data.catalogVisible===false)throw publicCatalogError('inactive','Catálogo indisponível.');
  return{token:snapshot.id,...data};
}
async function loadPublicCatalog(){
  if(slugResolutionError)throw slugResolutionError;
  if(!validVisitToken(visitToken))throw publicCatalogError('not-found','Token ausente ou inválido.');
  const f=await firebase(),reference=f.doc(f.db,'publicCatalogs',visitToken);
  if(reference.id!==visitToken)throw publicCatalogError('not-found','O token não corresponde ao ID do documento.');
  return validatePublicCatalog(await f.getDoc(reference));
}
let availabilityRefresh=null;
async function refreshPublicAvailability(){
  if(!v2()||view!=='catalog'||!navigator.onLine)return false;
  if(availabilityRefresh)return availabilityRefresh;
  availabilityRefresh=(async()=>{
    try{
      const fresh=await loadPublicCatalog();
      if(fresh.businessId!==catalog.businessId||fresh.spaceId!==catalog.spaceId||fresh.workspaceGeneration!==catalog.workspaceGeneration)
        throw publicCatalogError('inactive','A configuração desta loja mudou. Reabra o link da loja.');
      catalog=fresh;prepareCatalogIdentity();
      if(view==='catalog')render(); // Never replace a checkout form or discard its inputs/cart.
      try{await DB.localRecords.transaction('readwrite',(store,done)=>{store.put({key:`public-catalog:${visitToken}:cache`,scope:`public-catalog:${visitToken}`,type:'reconstructable-catalog',data:catalog});done(true);});}
      catch(error){console.warn('[Public availability cache]',{code:error.code||'local-cache-write'});}
      return true;
    }catch(error){
      const code=normalizedCatalogErrorCode(error);
      if(code!=='network'){catalog={...catalog,acceptingOrders:false,active:false};showCatalogError(code,error);}
      else console.warn('[Public availability refresh]',{code,stage:'current_store_refresh'});
      return false;
    }
  })();
  try{return await availabilityRefresh;}finally{availabilityRefresh=null;}
}
// Refresh ONLY this public document on navigation/return, no global listener or polling.
if(!preview){document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPublicAvailability();});addEventListener('pageshow',event=>{if(event.persisted)refreshPublicAvailability();});addEventListener('online',()=>refreshPublicAvailability());}

/* ---------- Ícones (inline: sem dependência e sem varrer o documento) ---------- */
const svg=(d,extra='')=>`<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const I={search:svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),bag:svg('<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),plus:svg('<path d="M12 5v14M5 12h14"/>'),minus:svg('<path d="M5 12h14"/>'),x:svg('<path d="M6 6l12 12M18 6 6 18"/>'),back:svg('<path d="m15 18-6-6 6-6"/>'),clock:svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),pin:svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),store:svg('<path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>'),truck:svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),insta:svg('<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".9" fill="currentColor"/>'),check:svg('<path d="m5 12.5 4.2 4.2L19 7"/>'),trash:svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  wa:'<svg viewBox="0 0 32 32" aria-hidden="true" class="sf-wa-glyph"><path fill="currentColor" d="M16.04 4C9.4 4 4 9.38 4 16c0 2.1.56 4.15 1.6 5.95L4 28l6.2-1.62A12 12 0 0 0 16.04 28C22.66 28 28 22.62 28 16S22.66 4 16.04 4zm0 21.8c-1.86 0-3.68-.5-5.27-1.45l-.38-.22-3.68.96.98-3.58-.25-.37A9.77 9.77 0 0 1 6.2 16c0-5.42 4.42-9.82 9.84-9.82 5.42 0 9.82 4.4 9.82 9.82 0 5.42-4.4 9.8-9.82 9.8zm5.4-7.34c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.48.71.31 1.27.5 1.7.63.72.23 1.37.2 1.88.12.57-.08 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/></svg>'};

/* ---------- Dados derivados ---------- */
const tracksStock=item=>item.controlaEstoque!==false&&item.trackStock!==false&&item.semControleEstoque!==true&&item.itemKind!=='service'&&item.itemKind!=='subscription';
const unlimited=item=>!tracksStock(item)||item.allowNegativeStock===true;
const variantsOf=item=>(item.variants||[]).filter(v=>v.active!==false&&v.catalogVisible!==false);
const isVariable=item=>item.productType==='variable';
function stockOf(item,variant){if(variant){if(variant.allowNegativeStock||!tracksStock(item))return Infinity;return Math.max(0,Number(variant.availableQuantity||0));}if(isVariable(item))return variantsOf(item).reduce((s,v)=>s+stockOf(item,v),0);if(unlimited(item))return Infinity;return Math.max(0,Number(item.availableQuantity??0));}
const soldOut=item=>stockOf(item)<=0;
function priceLabel(item){if(isVariable(item)){const prices=variantsOf(item).map(v=>Number(v.salePrice||0));if(!prices.length)return 'Indisponível';const min=Math.min(...prices),max=Math.max(...prices);return min!==max?`a partir de ${money(min)}`:money(min);}return money(item.salePrice);}
const orderable=()=>catalog.items.filter(item=>item.active!==false).flatMap(item=>isVariable(item)?variantsOf(item).map(v=>({key:`${item.id}::${v.id}`,item,variant:v,name:item.productName,variantName:v.displayName,price:Number(v.salePrice||0),image:v.imageUrl||item.productImage})):[{key:item.id,item,variant:null,name:item.productName,variantName:'',price:Number(item.salePrice||0),image:item.productImage}]);
const cartLines=()=>{const map=new Map(orderable().map(o=>[o.key,o]));return Object.entries(cart).map(([key,qty])=>({...map.get(key),key,qty:Number(qty)})).filter(l=>l.item&&l.qty>0);};
const count=()=>cartLines().reduce((s,l)=>s+l.qty,0),total=()=>Math.round(cartLines().reduce((s,l)=>s+l.qty*l.price,0)*100)/100;
const qtyForItem=item=>Object.entries(cart).reduce((s,[k,q])=>s+(k===item.id||k.startsWith(`${item.id}::`)?Number(q):0),0);
const registered=()=>catalog.acceptingOrders===true;
const hasPendingOrder=()=>Boolean(pendingOrderAttempt?.payload);
const paymentOptions=()=>(catalog.paymentMethods||[]).filter(p=>Object.hasOwn(K.PAYMENT_LABELS,p));
const requiresPaymentChoice=()=>registered()&&!paymentOptions().includes('entrega');
const phoneOk=()=>K.validPhone(catalog.contactPhone||catalog.publicSettings?.contactPhone);
const storePhone=()=>catalog.contactPhone||catalog.publicSettings?.contactPhone||'';
const canOrder=()=>hasPendingOrder()||registered()||phoneOk();
function modes(){const configured=(catalog.serviceModes||[]).filter(m=>m.active!==false&&['pickup','delivery'].includes(m.type));if(configured.length)return configured;return[...(catalog.pickupEnabled?[{id:'pickup',type:'pickup',label:'Retirada'}]:[]),...(catalog.deliveryEnabled?[{id:'delivery',type:'delivery',label:'Entrega'}]:[])];}
function currentMode(){const list=modes();return list.find(m=>String(m.id||m.type)===String(serviceModeId))||list[0]||null;}
function categoryName(internal){const c=(catalog.categories||[]).find(x=>x.internalName===internal);return c?.publicName||internal||'Outros';}
function categoryOrder(internal){const c=(catalog.categories||[]).find(x=>x.internalName===internal);return c?Number(c.order||0):999;}
const sortItems=list=>[...list].sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||Number(a.displayOrder||0)-Number(b.displayOrder||0)||String(a.productName).localeCompare(String(b.productName),'pt-BR'));
function sections(){
  const groups=new Map();for(const item of catalog.items.filter(i=>i.active!==false)){const k=item.category||'Outros';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item);}
  return [...groups.entries()].sort((a,b)=>categoryOrder(a[0])-categoryOrder(b[0])||categoryName(a[0]).localeCompare(categoryName(b[0]),'pt-BR')).map(([k,items])=>({key:k,name:categoryName(k),items:sortItems(items)}));
}
function searchResults(){const terms=norm(query).split(/\s+/).filter(Boolean);return sortItems(catalog.items.filter(i=>i.active!==false&&terms.every(t=>norm(`${i.productName} ${categoryName(i.category)} ${i.description||''}`).includes(t))));}

/* ---------- Tema da marca ---------- */
function themeStyle(){const t=K.theme({primaryColor:catalog.primaryColor||catalog.publicSettings?.primaryColor,secondaryColor:catalog.secondaryColor||catalog.publicSettings?.secondaryColor});return `--sf-accent:${t.accent};--sf-on-accent:${t.onAccent};--sf-readable-dark:${K.readable(t.accent,'#223137')};--sf-accent-text:${t.accentText};--sf-accent-soft:${t.accentSoft};--sf-band:${t.band};--sf-on-band:${t.onBand};--sf-band-muted:${t.bandMuted};--sf-band-chip:${t.bandChip};--sf-band-accent:${t.bandAccent}`;}
// Enquadramento salvo da foto (quando publicado): ajuste, posição e zoom, sem ler metadados do Storage.
function imageStyle(item){const v=item?.imagePresentation||{},fit=v.fit==='contain'?'contain':'cover',x=Math.min(100,Math.max(0,Number(v.positionX??50))),y=Math.min(100,Math.max(0,Number(v.positionY??50))),zoom=Math.min(3,Math.max(1,Number(v.zoom??1)));return `--catalog-image-fit:${fit};--catalog-image-x:${x}%;--catalog-image-y:${y}%;--catalog-image-zoom:${zoom}`;}
const cssUrl=u=>`url(&quot;${esc(String(u).replace(/["\\\n\r]/g,''))}&quot;)`;
const initials=name=>String(name||'Loja').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
const instagramHandle=v=>String(v||'').trim().replace(/^@/,'').replace(/^https?:\/\/(www\.)?instagram\.com\//i,'').replace(/[/?#].*$/,'').replace(/[^A-Za-z0-9._]/g,'').slice(0,30);

/* ---------- Telas ---------- */
let slideIndex = 0, rotationPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let heroCleanup = () => {};
function activeSlides() {
  const layout=K.storefrontLayout(catalog);
  if(preview && params.get('banner')==='1'){const selected=catalog.previewSlide===-1?layout.secondary:layout.slides[catalog.previewSlide||0];return selected?[selected]:[];}
  return layout.slides.filter(slide => slide.active);
}
function bannerAction(slide) {
  if (!slide.button) return '';
  if (/^https?:\/\//i.test(slide.target)) return `<a class="vv-action" href="${esc(slide.target)}" target="_blank" rel="noopener noreferrer">${esc(slide.button)} ↗</a>`;
  return `<button type="button" class="vv-action" data-viva-target="${esc(slide.target)}">${esc(slide.button)} <span aria-hidden="true">↗</span></button>`;
}
function courier() {
  return '<div class="vv-scene" aria-hidden="true"><div class="vv-orbit"></div><div class="vv-stars"></div><div class="vv-flight"><div class="vv-robot"></div><i class="vv-parcel"></i><div class="vv-trolley"><i></i><b></b></div></div></div>';
}
function bannerContent(slide) {
  const image = String(slide.imageUrl || '');
  const safeImage = /^https?:\/\//i.test(image) || (preview && /^data:image\/(jpeg|png|webp);base64,/i.test(image));
  return `<div class="vv-slide" data-model="${esc(slide.template)}">${safeImage?`<img class="vv-art" alt="" src="${esc(image)}">`:slide.template==='robot'?courier():`<div class="vv-sculpture" aria-hidden="true"><span class="vv-motif" data-model="${esc(slide.template)}"></span></div>`}
    <div class="vv-caption"><h2>${esc(slide.title)}</h2>${slide.description?`<p>${esc(slide.description)}</p>`:''}${bannerAction(slide)}</div></div>`;
}
function hero() {
  const slides = activeSlides();
  if (!slides.length) return '';
  slideIndex = Math.min(slideIndex,slides.length-1);
  return `<section class="vv-hero" aria-label="Banners da loja" aria-roledescription="carrossel">
    <div class="vv-stage">${bannerContent(slides[slideIndex])}</div>
    <div class="vv-controls">${slides.length>1?`<button type="button" data-shift="-1" aria-label="Banner anterior">‹</button><span data-slide-count>${slideIndex+1} / ${slides.length}</span><button type="button" data-shift="1" aria-label="Próximo banner">›</button>`:''}<button type="button" data-viva-pause aria-pressed="${rotationPaused}" aria-label="Pausar animação">${rotationPaused?'▶':'Ⅱ'}</button></div></section>`;
}
function attachHero() {
  heroCleanup();
  const el=root.querySelector('.vv-hero');
  if (!el) return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let timer, startX, startY, visible=true, hovering=false;
  function schedule() {
    clearTimeout(timer);
    el.classList.toggle('vv-rest',rotationPaused||!visible||document.hidden||motion.matches);
    if(!rotationPaused&&!motion.matches&&visible&&!hovering&&!document.hidden&&!el.contains(document.activeElement)&&activeSlides().length>1)
      timer=setTimeout(()=>shift(1),7500);
  }
  function shift(delta) {
    const slides=activeSlides();
    if(slides.length<2)return;
    slideIndex=(slideIndex+delta+slides.length)%slides.length;
    el.querySelector('.vv-stage').innerHTML=bannerContent(slides[slideIndex]);
    el.querySelector('[data-slide-count]').textContent=`${slideIndex+1} / ${slides.length}`;
    schedule();
  }
  el.onclick=e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.dataset.shift)shift(Number(button.dataset.shift));
    if(button.hasAttribute('data-viva-pause')){
      rotationPaused=!rotationPaused;button.setAttribute('aria-pressed',String(rotationPaused));button.textContent=rotationPaused?'▶':'Ⅱ';schedule();
    }
  };
  el.onkeydown=e=>{if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();shift(e.key==='ArrowRight'?1:-1);}};
  el.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;startY=e.touches[0].clientY;},{passive:true});
  el.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)shift(dx<0?1:-1);},{passive:true});
  el.onpointerenter=e=>{hovering=e.pointerType==='mouse';schedule();};
  el.onpointermove=e=>{if(e.pointerType==='mouse'&&!rotationPaused&&!motion.matches){const r=el.getBoundingClientRect();el.style.setProperty('--vv-drift',((e.clientX-r.left)/r.width*10-5)+'px');}};
  el.onpointerleave=()=>{hovering=false;el.style.removeProperty('--vv-drift');schedule();};
  el.onfocusin=schedule;el.onfocusout=()=>queueMicrotask(()=>el.isConnected&&schedule());
  const observer='IntersectionObserver' in window?new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule();}):null;
  observer?.observe(el);document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',schedule);schedule();
  heroCleanup=()=>{clearTimeout(timer);observer?.disconnect();document.removeEventListener('visibilitychange',schedule);motion.removeEventListener('change',schedule);};
}

function band(){
  const name=catalog.publicName||'Loja',cover=catalog.coverUrl||catalog.bannerUrl,ig=instagramHandle(catalog.instagram),list=modes();
  return `<header class="sf-band ${cover?'has-cover':''}">${cover?`<div class="sf-band-cover" style="background-image:${cssUrl(cover)}"></div>`:''}<div class="sf-band-inner">
    <div class="sf-brand"><span class="sf-logo">${catalog.logoUrl?`<img src="${esc(catalog.logoUrl)}" alt="">`:`<span>${esc(initials(name))}</span>`}</span><div class="sf-brand-copy"><h1>${esc(name)}</h1>${catalog.welcomeText?`<p>${esc(catalog.welcomeText)}</p>`:''}</div></div>
    <ul class="sf-facts" aria-label="Informações da loja">${catalog.openingHours?`<li>${I.clock}<span>${esc(catalog.openingHours)}</span></li>`:''}${list.map(m=>`<li>${m.type==='delivery'?I.truck:I.store}<span>${m.type==='delivery'?'Entrega':'Retirada'}</span></li>`).join('')}${ig?`<li><a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">${I.insta}<span>@${esc(ig)}</span></a></li>`:''}</ul>
  </div></header>`;
}
function topbar(title,back='catalog'){
  const name=catalog.publicName||'Loja';
  return `<header class="sf-top"><div class="sf-top-inner"><button type="button" class="sf-icon-btn" data-back="${back}" aria-label="Voltar">${I.back}</button><span class="sf-top-logo">${catalog.logoUrl?`<img src="${esc(catalog.logoUrl)}" alt="">`:esc(initials(name))}</span><div class="sf-top-copy"><small>${esc(name)}</small><b>${esc(title)}</b></div></div></header>`;
}
function tools(){
  const secs=sections(),n=count(),home=K.storefrontLayout(catalog).home||{};
  return `<div class="sf-tools"><div class="sf-tools-inner"><label class="sf-search" ${home.search===false&&!query?'hidden':''}>${I.search}<span class="sf-sr">Buscar produtos</span><input type="search" id="sf-search" value="${esc(query)}" placeholder="${esc(home.placeholder||'Buscar produtos')}" autocomplete="off" enterkeyhint="search"></label>${home.search===false&&!query?'<button class="vv-show-search" data-show-search type="button">Pesquisar produtos</button>':''}<button type="button" class="sf-cart-btn" data-go="cart" aria-label="${n?`Ver pedido com ${n} ${n===1?'item':'itens'}`:'Pedido vazio'}">${I.bag}<b class="sf-cart-n" ${n?'':'hidden'}>${n>99?'99+':n}</b></button></div>
    ${secs.length>1?`<nav class="sf-cats" aria-label="Categorias" ${query?'hidden':''}><button type="button" data-cat="" aria-pressed="${!category}">Tudo</button>${secs.map(s=>`<button type="button" data-cat="${esc(s.key)}" aria-pressed="${category===s.key}">${esc(s.name)}</button>`).join('')}</nav>`:''}</div>`;
}
function card(item,size=''){
  const out=soldOut(item),qty=qtyForItem(item),stock=stockOf(item),low=!out&&Number.isFinite(stock)&&stock<=5;
  const img=item.productImage?`<img src="${esc(item.productImage)}" alt="" loading="lazy" decoding="async">`:`<span class="sf-noimg">${esc(initials(item.productName))}</span>`;
  return `<article class="sf-card ${size} ${out?'is-out':''}" data-item="${esc(item.id)}"><button type="button" class="sf-card-open" data-open="${esc(item.id)}" aria-label="${esc(item.productName)}, ${esc(priceLabel(item))}${out?', esgotado':''}"><span class="sf-card-img" style="${imageStyle(item)}">${img}${out?'<span class="sf-flag">Esgotado</span>':low?`<span class="sf-flag sf-flag-low">Últimas ${stock}</span>`:''}</span><span class="sf-card-body"><span class="sf-card-name">${esc(item.productName)}</span><span class="sf-card-price">${esc(priceLabel(item))}</span>${isVariable(item)?`<span class="sf-card-note">${variantsOf(item).length} opções</span>`:''}</span></button>${!out&&canOrder()?`<button type="button" class="sf-add ${qty?'has-qty':''}" data-add="${esc(item.id)}" aria-label="${isVariable(item)?'Escolher opção de':'Adicionar'} ${esc(item.productName)}${qty?` (${qty} no pedido)`:''}">${qty?`<b>${qty}</b>`:I.plus}</button>`:''}</article>`;
}
const catalogBatch = 36;
let catalogLimit = catalogBatch;
function mainBody(){
  let remaining = catalogLimit, overflow = false;
  function visible(items) {
    const batch = items.slice(0,remaining);
    remaining -= batch.length;
    if(batch.length < items.length) overflow = true;
    return batch;
  }
  const secs=sections(),featured=sortItems(catalog.items.filter(i=>i.featured&&i.active!==false)).slice(0,12);
  let body;
  if(!catalog.items.length)body=`<div class="sf-empty"><h2>Os produtos chegam em breve</h2><p>${phoneOk()?'Enquanto isso, fale com a loja pelo WhatsApp.':'Volte mais tarde.'}</p>${phoneOk()?`<a class="sf-btn sf-btn-wa" href="https://wa.me/${esc(K.phoneDigits(storePhone()))}" target="_blank" rel="noopener">${I.wa}<span>Falar com a loja</span></a>`:''}</div>`;
  else if(query){const r=searchResults();body=`<section class="sf-section"><header class="sf-section-head"><h2>${r.length?`${r.length} ${r.length===1?'resultado':'resultados'} para “${esc(query)}”`:`Nada encontrado para “${esc(query)}”`}</h2>${r.length?'':'<button type="button" class="sf-link" data-clear-search>Limpar busca</button>'}</header><div class="sf-grid">${visible(r).map(i=>card(i)).join('')}</div></section>`;}
  else body=`${!category&&K.storefrontLayout(catalog).featured&&featured.length?`<section class="sf-section sf-featured" aria-labelledby="sf-feat"><header class="sf-section-head"><h2 tabindex="-1" id="sf-feat">${esc(K.storefrontLayout(catalog).home?.featuredTitle||'Destaques')}</h2></header><div class="sf-rail">${featured.map(i=>card(i,'sf-card-wide')).join('')}</div></section>`:''}${!category && K.storefrontLayout(catalog).secondary?.active ? `<section class="vv-secondary">${bannerContent(K.storefrontLayout(catalog).secondary)}</section>` : ''}${secs.filter(s=>!category||s.key===category).map(s=>({...s,visible:visible(s.items)})).filter(s=>s.visible.length).map(s=>`<section class="sf-section" aria-labelledby="sf-cat-${esc(s.key).replace(/\W/g,'')}"><header class="sf-section-head"><h2 id="sf-cat-${esc(s.key).replace(/\W/g,'')}">${esc(s.name)}</h2><small>${s.items.length} ${s.items.length===1?'item':'itens'}</small></header><div class="sf-grid">${s.visible.map(i=>card(i)).join('')}</div></section>`).join('')}`;
  return body + (overflow ? '<button type="button" class="sf-btn sf-btn-ghost sf-btn-wide" data-viva-more>Mostrar mais produtos</button>' : '');
}
function catalogView(){
  return `${band()}${hero()}${tools()}${canOrder()?'':'<p class="sf-notice">Esta loja ainda não recebe pedidos pelo site. Você pode conferir os produtos e os preços.</p>'}<div class="sf-layout"><main class="sf-main" id="sf-main" tabindex="-1">${mainBody()}</main><aside class="sf-aside" aria-label="Seu pedido">${asideCart()}</aside></div>`;
}
function lineHtml(l,compact=false){
  const max=stockOf(l.item,l.variant);
  return `<li class="sf-line" data-line="${esc(l.key)}">${compact?'':`<span class="sf-line-img">${l.image?`<img src="${esc(l.image)}" alt="">`:esc(initials(l.name))}</span>`}<div class="sf-line-copy"><b>${esc(l.name)}</b>${l.variantName?`<small>${esc(l.variantName)}</small>`:''}<small>${money(l.price)} cada</small></div><div class="sf-qty" role="group" aria-label="Quantidade de ${esc(l.name)}"><button type="button" data-dec="${esc(l.key)}" aria-label="${l.qty===1?'Remover':'Diminuir'} ${esc(l.name)}">${l.qty===1?I.trash:I.minus}</button><output aria-live="polite">${l.qty}</output><button type="button" data-inc="${esc(l.key)}" aria-label="Aumentar ${esc(l.name)}" ${l.qty>=max?'disabled':''}>${I.plus}</button></div><b class="sf-line-total">${money(l.qty*l.price)}</b></li>`;
}
function asideCart(){
  const lines=cartLines();
  return `<div class="sf-aside-card"><h2>Seu pedido</h2>${lines.length?`<ul class="sf-lines">${lines.map(l=>lineHtml(l,true)).join('')}</ul><div class="sf-sum"><span>Total dos produtos</span><b>${money(total())}</b></div><button type="button" class="sf-btn sf-btn-accent sf-btn-wide" data-go="checkout" ${canOrder()?'':'disabled'}>Finalizar pedido</button>`:`<p class="sf-muted">Escolha os produtos e eles aparecem aqui.</p>`}</div>${phoneOk()?`<a class="sf-aside-wa" href="https://wa.me/${esc(K.phoneDigits(storePhone()))}" target="_blank" rel="noopener">${I.wa}<span>Dúvidas? Fale com a loja</span></a>`:''}`;
}
function cartBar(){const n=count();if(view!=='catalog'||!n)return '';return `<button type="button" class="sf-cartbar" data-go="cart"><span class="sf-cartbar-n">${n}</span><span>Ver pedido</span><b>${money(total())}</b></button>`;}
function cartView(){
  if(hasPendingOrder())return pendingOrderView();
  const lines=cartLines();
  if(!lines.length)return `${topbar('Seu pedido')}<main class="sf-page"><div class="sf-empty"><h2>Seu pedido está vazio</h2><p>Toque em + nos produtos para montar o pedido.</p><button type="button" class="sf-btn sf-btn-accent" data-go="catalog">Ver produtos</button></div></main>`;
  return `${topbar('Seu pedido')}<main class="sf-page"><section class="sf-panel"><ul class="sf-lines">${lines.map(l=>lineHtml(l)).join('')}</ul></section>
    <section class="sf-panel"><label class="sf-field"><span>Observações <small>(opcional)</small></span><textarea id="sf-note" maxlength="500" rows="3" placeholder="Ex.: sem cobertura, entregar após as 18h">${esc(note)}</textarea></label></section>
    <section class="sf-panel sf-summary"><div class="sf-sum"><span>Subtotal</span><b>${money(total())}</b></div>${modes().some(m=>m.type==='delivery')?'<p class="sf-muted">Se escolher entrega, a taxa é combinada com a loja.</p>':''}</section>
    <div class="sf-actions"><button type="button" class="sf-btn sf-btn-accent sf-btn-wide" data-go="checkout" ${canOrder()?'':'disabled'}>Continuar</button><button type="button" class="sf-btn sf-btn-ghost sf-btn-wide" data-go="catalog">Adicionar mais itens</button></div></main>`;
}
function orderInput(){
  const mode=currentMode();
  return {storeName:catalog.publicName,items:cartLines().map(l=>({name:l.name,variant:l.variantName,quantity:l.qty,unitPrice:l.price})),mode:mode?.type||null,pickupAddress:catalog.pickupAddress,customer:{name:customer.name||'',phone:customer.phone||'',address:customer.address||''},payment,note};
}
function message(extraTop=''){try{const m=K.orderMessage(orderInput());return extraTop?{...m,text:`${extraTop}\n\n${m.text}`}:m;}catch{return {text:'',subtotal:0};}}
function waHref(text){try{return K.whatsappUrl(storePhone(),text);}catch{return '';}}
function whatsAppActions(href,confirmed=false){
  const chat=phoneOk()?K.whatsappChatUrl(storePhone()):'';
  return `<a class="sf-btn sf-btn-wa sf-btn-wide" ${confirmed?'':'id="sf-send-wa"'} ${href?`href="${esc(href)}"`:'hidden'} target="_blank" rel="noopener">${I.wa}<span>Abrir pedido no WhatsApp</span></a>
    <div class="sf-actions" data-wa-long ${!href&&chat?'':'hidden'}>
      <p class="sf-muted">Para levar todos os itens, copie o resumo completo. Abra o WhatsApp da loja, cole a mensagem e toque em enviar.</p>
      <button type="button" class="sf-btn sf-btn-accent sf-btn-wide" data-wa-copy>Copiar resumo completo</button>
      <p class="sf-muted" data-wa-status role="status"></p>
      <label class="sf-field" data-wa-manual hidden><span>Resumo para copiar</span><textarea rows="4" readonly></textarea></label>
      <a class="sf-btn sf-btn-ghost sf-btn-wide" href="${esc(chat)}" target="_blank" rel="noopener">${I.wa}<span>Abrir WhatsApp da loja</span></a>
    </div>
    <p class="sf-muted sf-center">O pedido só é confirmado quando a loja responder.</p>`;
}
function pendingOrderView(){
  return `${topbar('Pedido em confirmação','catalog')}<main class="sf-page"><form class="sf-panel" id="sf-checkout" novalidate>
    <h2>Verifique o envio pendente</h2><p role="status">Existe um envio em confirmação. Vamos consultar a mesma tentativa para evitar outro pedido.</p>
    <button type="submit" class="sf-btn sf-btn-accent sf-btn-wide" ${submittingOrder?'disabled':''}>${submittingOrder?'Verificando pedido…':'Verificar envio pendente'}</button>
  </form></main>`;
}
function checkoutView(){
  if(hasPendingOrder())return pendingOrderView();
  const lines=cartLines();if(!lines.length){view='cart';return cartView();}
  const list=modes(),mode=currentMode(),pays=paymentOptions(),reg=registered(),m=message(),err=k=>errors[k]?`<small class="sf-error" id="sf-err-${k}" role="alert">${esc(errors[k])}</small>`:'';
  const href=reg?'':waHref(m.text),long=!reg&&!href&&phoneOk();
  const modeInfo=mode?.type==='delivery'?esc(catalog.deliveryInstructions||'Informe o endereço. A taxa de entrega é combinada com a loja.'):mode?.type==='pickup'?esc(catalog.pickupAddress?`Retire em: ${catalog.pickupAddress}`:'A loja informa onde retirar.'):'';
  return `${topbar('Finalizar pedido','cart')}<main class="sf-page"><form class="sf-checkout" id="sf-checkout" data-wa-long-summary="${long}" novalidate>
    ${list.length?`<section class="sf-panel"><h2>Como você quer receber?</h2><div class="sf-modes" role="radiogroup" aria-label="Forma de receber">${list.map(x=>{const id=String(x.id||x.type),on=id===String(mode?.id||mode?.type);return `<button type="button" role="radio" aria-checked="${on}" class="sf-mode" data-mode="${esc(id)}">${x.type==='delivery'?I.truck:I.store}<span><b>${x.type==='delivery'?'Entrega':'Retirada'}</b><small>${x.type==='delivery'?'Taxa combinada com a loja':'Sem taxa de entrega'}</small></span></button>`;}).join('')}</div>${modeInfo?`<p class="sf-muted">${modeInfo}</p>`:''}</section>`:''}
    <section class="sf-panel"><h2>Seus dados</h2>
      <label class="sf-field"><span>Seu nome</span><input name="name" value="${esc(customer.name||'')}" autocomplete="name" maxlength="80" required ${errors.name?'aria-invalid="true" aria-describedby="sf-err-name"':''}>${err('name')}</label>
      ${reg?`<label class="sf-field"><span>Seu WhatsApp</span><input name="phone" value="${esc(customer.phone?K.formatPhone(customer.phone):'')}" inputmode="tel" autocomplete="tel" placeholder="(11) 91234-5678" required ${errors.phone?'aria-invalid="true" aria-describedby="sf-err-phone"':''}>${err('phone')}</label>`:''}
      ${mode?.type==='delivery'?`<label class="sf-field"><span>Endereço de entrega</span><textarea name="address" rows="2" maxlength="200" autocomplete="street-address" placeholder="Rua, número, bairro e complemento" required ${errors.address?'aria-invalid="true" aria-describedby="sf-err-address"':''}>${esc(customer.address||'')}</textarea>${err('address')}</label>`:''}
    </section>
    ${pays.length?`<section class="sf-panel"><h2>Como prefere pagar? ${requiresPaymentChoice()?'':'<small>(opcional)</small>'}</h2><div class="sf-chips" role="radiogroup" aria-label="Forma de pagamento" ${errors.payment?'aria-invalid="true" aria-describedby="sf-err-payment"':''}>${pays.map(p=>`<button type="button" role="radio" class="sf-chip" data-pay="${p}" aria-checked="${payment===p}">${esc(K.PAYMENT_LABELS[p])}</button>`).join('')}</div>${err('payment')}<p class="sf-muted">O pagamento é combinado com a loja. Nada é cobrado aqui.</p></section>`:''}
    <section class="sf-panel sf-summary"><ul class="sf-review" aria-label="Itens do pedido" ${long?'tabindex="0"':''}>${lines.map(l=>`<li><span>${l.qty}x ${esc(l.name)}${l.variantName?` <small>(${esc(l.variantName)})</small>`:''}</span><b>${money(l.qty*l.price)}</b></li>`).join('')}</ul><div class="sf-sum"><span>Total dos produtos</span><b>${money(total())}</b></div>${mode?.type==='delivery'?'<p class="sf-muted">A taxa de entrega será combinada com a loja.</p>':''}</section>
    ${reg?'':`<section class="sf-panel sf-msg"><h2>Resumo para o WhatsApp</h2><p class="sf-muted">Confira todos os itens antes de enviar.</p><div class="sf-bubble" data-msg>${esc(m.text)}</div></section>`}
    <div class="sf-actions sf-actions-sticky">${reg?`<button type="submit" class="sf-btn sf-btn-accent sf-btn-wide" ${submittingOrder?'disabled':''}>${submittingOrder?'Enviando pedido…':'Fazer pedido'}</button>`
      :whatsAppActions(href)}</div>
  </form></main>`;
}
function sentView(){
  return `${topbar('Pedido no WhatsApp','checkout')}<main class="sf-page"><section class="sf-panel sf-sent"><span class="sf-sent-icon">${I.wa}</span><h2>Agora é só enviar no WhatsApp</h2><p>Se a conversa com <b>${esc(catalog.publicName)}</b> abriu, confira o pedido e toque em enviar. Se precisar, use o botão abaixo para tentar de novo.</p><p class="sf-muted">A loja confirma disponibilidade, entrega e pagamento pela conversa. Seu pedido ainda não foi confirmado.</p>
    <div class="sf-actions"><a class="sf-btn sf-btn-wa sf-btn-wide" href="${esc(sentUrl)}" target="_blank" rel="noopener">${I.wa}<span>Abrir o WhatsApp de novo</span></a><button type="button" class="sf-btn sf-btn-ghost sf-btn-wide" data-clear-cart>Já enviei, limpar o carrinho</button><button type="button" class="sf-link" data-go="catalog">Voltar à loja</button></div></section></main>`;
}
const orderLabel=s=>window.OnlineOrderModel?.labels?.[s]||({recebido:'Recebido',confirmado:'Confirmado',preparando:'Preparando',separando:'Pronto',deslocamento:'Enviado',entregue:'Concluído',cancelado:'Cancelado',expirado:'Expirado'}[s]||s);
const reservationInfo=order=>order.expiryEligibility==='review_required'?'<p class="sf-muted">A reserva aguarda revisão da loja. Nenhuma liberação foi realizada.</p>':order.orderStatus==='expirado'?'<p class="sf-muted">Reserva liberada: a loja não confirmou em 30 minutos. Revise a disponibilidade antes de fazer um novo pedido.</p>':order.orderStatus==='recebido'&&order.reservationExpiresAt?`<p class="sf-muted">Reserva aguardando confirmação da loja até ${esc(new Date(order.reservationExpiresAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))}.</p>`:'';
function successView(order){
  const o=order||successOrder||{};
  const text=o.items?.length && o.items.every(i=>Number.isFinite(i.unitPrice)&&Number.isFinite(i.quantity))?K.orderMessage({storeName:catalog.publicName,orderNumber:o.publicOrderNumber,
    items:o.items.map(i=>({name:i.productNameSnapshot||i.name,variant:i.variantNameSnapshot,quantity:i.quantity,unitPrice:i.unitPrice})),
    customer:{name:o.customerName,phone:o.customerPhone,address:o.customerLocation},mode:o.serviceModeType,pickupAddress:catalog.pickupAddress,
    payment:o.paymentPreference,note:o.note}).text:`Pedido #${o.publicOrderNumber||''} · ${catalog.publicName}`;
  const href=phoneOk()?waHref(text):'';
  return `${topbar('Pedido recebido')}<main class="sf-page"><section class="sf-panel sf-sent"><span class="sf-sent-icon sf-ok">${I.check}</span><h2>${o.orderStatus==='expirado'?'Reserva expirada':'Pedido recebido pela loja'}</h2><p>Pedido <b>#${esc(o.publicOrderNumber||'')}</b></p>${reservationInfo(o)}<p class="sf-muted">A loja confirma o atendimento. O pagamento é combinado com ela.</p><div class="sf-actions">${phoneOk()?`<details><summary>Resumo do pedido</summary><div class="sf-bubble" data-msg>${esc(text)}</div></details>${whatsAppActions(href,true)}`:''}<button type="button" class="sf-btn sf-btn-ghost sf-btn-wide" data-go="orders">Acompanhar meus pedidos</button><button type="button" class="sf-link" data-go="catalog">Voltar à loja</button></div></section></main>`;
}
function ordersView(){
  const list=orders.map(o=>o.data).filter(Boolean).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return `${topbar('Meus pedidos')}<main class="sf-page"><p class="sf-muted">Pedidos feitos neste aparelho.</p>${list.length?list.map(o=>`<article class="sf-panel sf-order"><header><b>Pedido #${esc(o.publicOrderNumber)}</b><span class="sf-pill">${esc(orderLabel(o.orderStatus))}</span></header><small class="sf-muted">${esc(new Date(o.createdAt?.toDate?.()||o.createdAt).toLocaleString('pt-BR'))}</small>${reservationInfo(o)}<ul class="sf-review">${(o.items||[]).map(i=>`<li><span>${i.quantity}x ${esc(i.name)}</span><b>${money(i.subtotal)}</b></li>`).join('')}</ul><div class="sf-sum"><span>Total</span><b>${money(o.total)}</b></div></article>`).join(''):'<div class="sf-empty"><h2>Nenhum pedido ainda</h2></div>'}</main>`;
}
function footer(){
  if(view!=='catalog')return '';
  const ig=instagramHandle(catalog.instagram);
  return `<footer class="sf-footer"><div class="sf-footer-inner"><div class="sf-footer-store"><b>${esc(catalog.publicName)}</b>${catalog.address?`<p>${I.pin}<span>${esc(catalog.address)}</span></p>`:''}${catalog.openingHours?`<p>${I.clock}<span>${esc(catalog.openingHours)}</span></p>`:''}<div class="sf-footer-links">${phoneOk()?`<a href="https://wa.me/${esc(K.phoneDigits(storePhone()))}" target="_blank" rel="noopener">${I.wa}<span>WhatsApp</span></a>`:''}${ig?`<a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">${I.insta}<span>Instagram</span></a>`:''}${orders.length?'<button type="button" class="sf-link" data-go="orders">Meus pedidos</button>':''}</div></div><p class="sf-made"><img src="./assets/veconi-symbol.svg" alt="" width="16" height="16"><span>Loja criada com VECONI</span></p></div></footer>`;
}

/* ---------- Folha do produto ---------- */
function groupsOf(item){
  const vs=variantsOf(item),keys=[...new Set(vs.flatMap(v=>Object.keys(v.attributeValues||{})))];
  if(keys.length&&vs.every(v=>keys.every(k=>v.attributeValues?.[k]!=null)))return keys.map(k=>({key:k,options:[...new Set(vs.map(v=>String(v.attributeValues[k])))]}));
  return [{key:'Opção',options:vs.map(v=>v.displayName),byName:true}];
}
function resolveVariant(item,picks){const vs=variantsOf(item),groups=groupsOf(item);if(groups[0]?.byName)return vs.find(v=>v.displayName===picks['Opção'])||null;return vs.find(v=>groups.every(g=>String(v.attributeValues?.[g.key])===picks[g.key]))||null;}
function optionOut(item,group,value,picks){const vs=variantsOf(item);return !vs.some(v=>{const ok=group.byName?v.displayName===value:String(v.attributeValues?.[group.key])===value;if(!ok)return false;const others=groupsOf(item).filter(g=>g.key!==group.key&&picks[g.key]);if(!group.byName&&others.some(g=>String(v.attributeValues?.[g.key])!==picks[g.key]))return false;return stockOf(item,v)>0;});}
function productSheet(){
  const item=catalog.items.find(i=>String(i.id)===String(sheet?.id));if(!item)return '';
  const variable=isVariable(item),groups=variable?groupsOf(item):[],variant=variable?resolveVariant(item,sheet.picks):null,price=variable?(variant?Number(variant.salePrice):null):Number(item.salePrice);
  const stock=variable?(variant?stockOf(item,variant):0):stockOf(item),key=variant?`${item.id}::${variant.id}`:item.id,inCart=Number(cart[key]||0),room=Number.isFinite(stock)?Math.max(0,stock-inCart):Infinity;
  const qty=Math.max(1,Math.min(sheet.qty,Number.isFinite(room)?Math.max(1,room):99)),ready=!variable||variant,canAdd=canOrder()&&ready&&room>0;
  const img=(variant?.imageUrl)||item.productMainImage||item.productImage;
  const stockNote=!ready?'Escolha uma opção.':room<=0?(inCart?'Você já colocou todas as unidades disponíveis no pedido.':'Esgotado no momento.'):Number.isFinite(stock)&&stock<=5?`Últimas ${stock} unidades.`:'';
  return `<div class="sf-backdrop" data-close></div><section class="sf-sheet sf-product" role="dialog" aria-modal="true" aria-labelledby="sf-p-title"><button type="button" class="sf-sheet-x" data-close aria-label="Fechar">${I.x}</button>
    <div class="sf-product-img" style="${imageStyle(item)}">${img?`<img src="${esc(img)}" alt="${esc(item.productName)}">`:`<span class="sf-noimg">${esc(initials(item.productName))}</span>`}</div>
    <div class="sf-product-body"><small class="sf-product-cat">${esc(categoryName(item.category))}</small><h2 id="sf-p-title">${esc(item.productName)}</h2><b class="sf-product-price">${price!=null?money(price):esc(priceLabel(item))}</b>${item.description?`<p class="sf-product-desc">${esc(item.description)}</p>`:''}
      ${groups.map(g=>`<fieldset class="sf-options"><legend>${esc(g.key)}</legend><div class="sf-chips">${g.options.map(o=>{const out=optionOut(item,g,o,sheet.picks),on=sheet.picks[g.key]===o;return `<button type="button" class="sf-chip" role="radio" aria-checked="${on}" data-pick="${esc(g.key)}" data-value="${esc(o)}" ${out?'disabled aria-disabled="true"':''}>${esc(o)}${out?' <small>esgotado</small>':''}</button>`;}).join('')}</div></fieldset>`).join('')}
      <p class="sf-stock" role="status">${esc(stockNote)}</p>
      ${canOrder()?`<div class="sf-buy"><div class="sf-qty sf-qty-lg" role="group" aria-label="Quantidade"><button type="button" data-sheet-qty="-1" aria-label="Diminuir" ${qty<=1?'disabled':''}>${I.minus}</button><output>${qty}</output><button type="button" data-sheet-qty="1" aria-label="Aumentar" ${!canAdd||qty>=room?'disabled':''}>${I.plus}</button></div><button type="button" class="sf-btn sf-btn-accent sf-buy-btn" data-sheet-add ${canAdd?'':'disabled'}>${ready?`Adicionar ${money((price||0)*qty)}`:'Escolha uma opção'}</button></div>`:`<p class="sf-muted">Esta loja ainda não recebe pedidos pelo site.</p>`}
    </div></section>`;
}

/* ---------- Render e interações ---------- */
function render(order=null){
  if(!catalog)return;
  if(order)successOrder=order;
  const scrollY=renderedOnce&&view==='catalog'?scrollY_():0;
  const previousDrawer=root.querySelector('.vv-drawer'),drawerScroll=previousDrawer?.scrollTop||0;
  const content=preview && params.get('banner')==='1'?hero():view==='cart'?cartView():view==='checkout'?checkoutView():view==='sent'?sentView():view==='success'?successView(successOrder):view==='orders'?ordersView():catalogView();
  root.innerHTML=`<div class="sf sf-view-${esc(view)}" style="${themeStyle()}">${view==='cart'?`<div class="vv-cart-underlay" inert>${band()}</div><div class="vv-cart-shade" data-back="catalog"></div><section class="vv-drawer ${previousDrawer?'':'vv-drawer-opening'}" role="dialog" aria-modal="true" aria-label="Carrinho">${content}${footer()}</section>`:`${content}${footer()}`}${cartBar()}${sheet?productSheet():''}<div class="sf-toast" role="status" aria-live="polite"></div></div>`;
  if(previousDrawer && view==='cart')root.querySelector('.vv-drawer').scrollTop=drawerScroll;
  if(preview && params.get('banner')==='1')root.classList.add('vv-banner-preview');
  attachHero();
  renderedOnce=true;
  if(view==='catalog'&&scrollY)scrollTo(0,scrollY);
  document.body.classList.toggle('sf-lock',!!sheet||view==='cart');
}
const scrollY_=()=>window.scrollY||document.documentElement.scrollTop||0;
// Atualiza só o que muda com o carrinho, sem perder a rolagem nem o foco.
function paintMain(){const main=root.querySelector('#sf-main');if(!main){render();return;}main.innerHTML=mainBody();const cats=root.querySelector('.sf-cats');if(cats){cats.hidden=!!query;cats.querySelectorAll('[data-cat]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cat===category)));}}
function paintCart(itemId=null){
  if(view!=='catalog'){render();return;}
  const n=count(),badge=root.querySelector('.sf-cart-n');if(badge){badge.hidden=!n;badge.textContent=n>99?'99+':n;}
  root.querySelector('.sf-cart-btn')?.setAttribute('aria-label',n?`Ver pedido com ${n} ${n===1?'item':'itens'}`:'Pedido vazio');
  const bar=root.querySelector('.sf-cartbar');if(bar)bar.outerHTML=cartBar();else if(n)root.querySelector('.sf').insertAdjacentHTML('beforeend',cartBar());
  const aside=root.querySelector('.sf-aside');if(aside)aside.innerHTML=asideCart();
  for(const el of root.querySelectorAll(itemId?`.sf-card[data-item="${CSS.escape(itemId)}"]`:'.sf-card[data-item]')){const item=catalog.items.find(i=>String(i.id)===el.dataset.item);if(item){const fresh=document.createElement('div');fresh.innerHTML=card(item,el.classList.contains('sf-card-wide')?'sf-card-wide':'');const add=fresh.querySelector('.sf-add'),old=el.querySelector('.sf-add');if(old&&add){const focused=document.activeElement===old;old.replaceWith(add);add.classList.add('vv-added');if(focused)add.focus({preventScroll:true});}}}
}
function toast(text){const el=root.querySelector('.sf-toast');if(!el)return;el.textContent=text;el.classList.add('is-on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-on'),2400);}
function setQty(key,next){
  const o=orderable().find(x=>x.key===key);if(!o)return;
  if(pendingOrderAttempt?.payload)return toast('Verifique o envio pendente antes de alterar o pedido.');
  const max=stockOf(o.item,o.variant);next=Math.max(0,next);
  if(next>max)return toast(`Só ${max===1?'resta 1 unidade':`restam ${max} unidades`} deste item.`);
  if(next)cart[key]=next;else delete cart[key];save();
}
function openSheet(id,opener){lastFocus=opener||document.activeElement;const item=catalog.items.find(i=>String(i.id)===String(id));if(!item)return;const picks={};if(isVariable(item)){const groups=groupsOf(item);for(const g of groups){const avail=g.options.filter(o=>!optionOut(item,g,o,picks));if(avail.length===1||(g.options.length===1))picks[g.key]=avail[0]||g.options[0];}}sheet={id,qty:1,picks};render();pushState('sheet');requestAnimationFrame(()=>root.querySelector('.sf-sheet .sf-chip:not(:disabled),.sf-sheet [data-sheet-add],.sf-sheet-x')?.focus());}
function closeSheet(fromPop=false){if(!sheet)return;sheet=null;render();if(!fromPop&&!preview&&history.state?.sf==='sheet')history.back();lastFocus?.isConnected?lastFocus.focus():root.querySelector(`[data-open]`)?.focus();}
const DEPTH={catalog:0,cart:1,orders:1,checkout:2,sent:3,success:3};
function go(next){
  if(next===view)return;
  if(next==='checkout'&&!canOrder())return toast('Esta loja ainda não recebe pedidos pelo site.');
  const forward=(DEPTH[next]??0)>(DEPTH[view]??0);
  view=next;sheet=null;errors={};render();forward?pushState(next):replaceState(next);scrollTo(0,0);
  root.querySelector('.sf-top .sf-icon-btn,.sf-search input')?.focus({preventScroll:true});
  if(next==='orders')refreshV2Orders();
}
function pushState(v){if(preview)return;try{history.pushState({sf:v},'',location.href);}catch{}}
function replaceState(v){if(preview)return;try{history.replaceState({sf:v},'',location.href);}catch{}}
addEventListener('popstate',e=>{if(sheet){closeSheet(true);return;}const v=e.state?.sf;const next=['cart','checkout','sent','orders','success'].includes(v)?v:'catalog';if(next===view)return;readForm();view=next;errors={};render();scrollTo(0,0);if(next==='catalog')refreshPublicAvailability();});
function readForm(){const form=root.querySelector('#sf-checkout');if(!form)return;const fd=new FormData(form);if(fd.has('name'))customer.name=String(fd.get('name')||'').slice(0,80);if(fd.has('phone'))customer.phone=String(fd.get('phone')||'');if(fd.has('address'))customer.address=String(fd.get('address')||'').slice(0,200);save();}
function validate(){
  errors={};const mode=currentMode();
  if(!String(customer.name||'').trim())errors.name='Informe seu nome.';
  if(mode?.type==='delivery'&&String(customer.address||'').trim().length<8)errors.address='Informe o endereço completo para a entrega.';
  if(registered()&&!K.validPhone(customer.phone))errors.phone='Informe um WhatsApp válido com DDD.';
  if(requiresPaymentChoice()&&!paymentOptions().includes(payment))errors.payment='Escolha uma forma de pagamento oferecida pela loja.';
  return !Object.keys(errors).length;
}
function refreshMessage(){
  const bubble=root.querySelector('[data-msg]');
  if(!bubble)return;
  const {text}=message(),href=waHref(text),link=root.querySelector('#sf-send-wa');
  bubble.textContent=text;
  link.hidden=!href;
  if(href)link.href=href;else link.removeAttribute('href');
  const long=!href&&phoneOk();
  const form=bubble.closest('form');
  form.dataset.waLongSummary=String(long);
  const review=form.querySelector('.sf-review');
  if(long)review.tabIndex=0;else review.removeAttribute('tabindex');
  root.querySelector('[data-wa-long]').hidden=!long;
  root.querySelector('[data-wa-status]').textContent='';
  root.querySelector('[data-wa-manual] textarea').value=text;
}
function validateWhatsApp(){
  readForm();
  if(validate())return true;
  render();
  root.querySelector('[aria-invalid="true"]')?.focus();
  toast('Confira os campos destacados.');
  return false;
}
async function copyWhatsApp(){
  if(view!=='success'&&!validateWhatsApp())return;
  const text=view==='success'?root.querySelector('[data-msg]').textContent:message().text,status=root.querySelector('[data-wa-status]');
  if(preview){previewMessage(text);return;}
  const current=()=>status.isConnected&&root.querySelector('[data-msg]')?.textContent===text;
  try{
    await navigator.clipboard.writeText(text);
    if(current())status.textContent='Resumo copiado. Abra o WhatsApp da loja e cole a mensagem.';
  }catch{
    if(!current())return;
    const manual=root.querySelector('[data-wa-manual]'),field=manual.querySelector('textarea');
    manual.hidden=false;
    field.value=text;
    field.focus();
    field.select();
    status.textContent='Use a opção Copiar do seu dispositivo para copiar o texto selecionado.';
  }
}
root.addEventListener('click',event=>{
  const t=event.target;
  if(t.closest('[data-viva-more]')){
    const shown=root.querySelectorAll('.sf-grid .sf-card').length;
    catalogLimit+=catalogBatch;paintMain();
    root.querySelectorAll('.sf-grid .sf-card-open')[shown]?.focus({preventScroll:true});return;
  }
  if(t.closest('[data-show-search]')){root.querySelector('.sf-search').hidden=false;t.closest('[data-show-search]').hidden=true;root.querySelector('#sf-search').focus();return;}
  const target=t.closest('[data-viva-target]')?.dataset.vivaTarget;
  if(target){if(target==='cart')go('cart');else{const node=(target==='featured'&&root.querySelector('#sf-feat'))||root.querySelector('#sf-main');node?.scrollIntoView({block:'center'});node?.focus({preventScroll:true});}return;}
  const close=t.closest('[data-close]');if(close){closeSheet();return;}
  const add=t.closest('[data-add]');if(add){const item=catalog.items.find(i=>String(i.id)===add.dataset.add);if(!item)return;if(isVariable(item))return openSheet(item.id,add);if(!canOrder())return;const before=Number(cart[item.id]||0);setQty(item.id,before+1);if(Number(cart[item.id]||0)>before){navigator.vibrate?.(12);paintCart(item.id);toast(`${item.productName} no pedido`);}return;}
  const open=t.closest('[data-open]');if(open){openSheet(open.dataset.open,open);return;}
  const inc=t.closest('[data-inc]'),dec=t.closest('[data-dec]');if(inc||dec){const key=(inc||dec).dataset[inc?'inc':'dec'];setQty(key,Number(cart[key]||0)+(inc?1:-1));if(view==='catalog')paintCart(key.split('::')[0]);else{render();root.querySelector(`[data-${inc?'inc':'dec'}="${CSS.escape(key)}"]`)?.focus();}return;}
  const pick=t.closest('[data-pick]');if(pick&&sheet){sheet.picks={...sheet.picks,[pick.dataset.pick]:pick.dataset.value};sheet.qty=1;const y=root.querySelector('.sf-sheet')?.scrollTop||0;render();const s=root.querySelector('.sf-sheet');if(s)s.scrollTop=y;root.querySelector(`[data-pick="${CSS.escape(pick.dataset.pick)}"][data-value="${CSS.escape(pick.dataset.value)}"]`)?.focus();return;}
  const sq=t.closest('[data-sheet-qty]');if(sq&&sheet){sheet.qty=Math.max(1,sheet.qty+Number(sq.dataset.sheetQty));render();root.querySelector(`[data-sheet-qty="${sq.dataset.sheetQty}"]`)?.focus();return;}
  if(t.closest('[data-sheet-add]')&&sheet){const item=catalog.items.find(i=>String(i.id)===String(sheet.id)),variant=isVariable(item)?resolveVariant(item,sheet.picks):null,key=variant?`${item.id}::${variant.id}`:item.id;const before=Number(cart[key]||0);setQty(key,before+sheet.qty);if(Number(cart[key]||0)>before){sheet=null;render();if(!preview&&history.state?.sf==='sheet')history.back();toast(`${item.productName}${variant?` (${variant.displayName})`:''} no pedido`);}return;}
  const cat=t.closest('[data-cat]');if(cat){catalogLimit=catalogBatch;category=cat.dataset.cat;paintMain();const tools_=root.querySelector('.sf-tools');if(tools_&&tools_.getBoundingClientRect().top<0)tools_.scrollIntoView({block:'start'});return;}
  const back=t.closest('[data-back]');if(back){readForm();if(!preview&&history.state?.sf===view)history.back();else go(back.dataset.back);return;}
  const g=t.closest('[data-go]');if(g){readForm();go(g.dataset.go);return;}
  const mode=t.closest('[data-mode]');if(mode){readForm();serviceModeId=mode.dataset.mode;safeStorage(serviceModeKey,JSON.stringify(serviceModeId));render();root.querySelector(`[data-mode="${CSS.escape(serviceModeId)}"]`)?.focus();return;}
  const pay=t.closest('[data-pay]');if(pay){readForm();payment=payment===pay.dataset.pay?'':pay.dataset.pay;root.querySelectorAll('[data-pay]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.pay===payment)));refreshMessage();return;}
  if(t.closest('[data-clear-search]')){catalogLimit=catalogBatch;query='';const input=root.querySelector('#sf-search');if(input)input.value='';paintMain();input?.focus();return;}
  if(t.closest('[data-clear-cart]')){cart={};note='';save();view='catalog';render();toast('Carrinho limpo. Obrigado pela compra!');return;}
  if(t.closest('[data-wa-copy]')){void copyWhatsApp();return;}
  const wa=t.closest('#sf-send-wa');
  if(wa){if(hasPendingOrder()||(!preview&&!navigator.onLine)){event.preventDefault();toast('Conecte-se à internet para continuar com seu pedido.');return;}if(!validateWhatsApp()){event.preventDefault();return;}
    const m=message(),href=waHref(m.text);if(!href){event.preventDefault();refreshMessage();root.querySelector('[data-wa-copy]')?.focus();return;}
    wa.href=href;
    if(preview){event.preventDefault();previewMessage(m.text);return;}
    sentUrl=href;setTimeout(()=>{view='sent';render();pushState('sent');scrollTo(0,0);},60);return;}
  const ext=t.closest('a[target="_blank"]');if(ext&&preview){event.preventDefault();toast('Na prévia, links externos não abrem.');}
});
root.addEventListener('input',event=>{
  const t=event.target;
  if(t.id==='sf-search'){clearTimeout(t._t);t._t=setTimeout(()=>{catalogLimit=catalogBatch;query=t.value.trim();paintMain();},140);return;}
  if(t.id==='sf-note'){note=t.value.slice(0,500);save();return;}
  if(t.closest('#sf-checkout')){readForm();if(errors[t.name]){delete errors[t.name];t.removeAttribute('aria-invalid');t.parentElement.querySelector('.sf-error')?.remove();}refreshMessage();}
});
root.addEventListener('submit',async event=>{if(event.target.id!=='sf-checkout')return;event.preventDefault();if(hasPendingOrder()){await submitOrder();return;}readForm();if(!registered()){root.querySelector('#sf-send-wa:not([hidden]),[data-wa-long]:not([hidden]) [data-wa-copy]')?.click();return;}if(!validate()){render();root.querySelector('[aria-invalid="true"] input,[aria-invalid="true"] button,[aria-invalid="true"]')?.focus();return;}await submitOrder();});
root.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&sheet){event.preventDefault();closeSheet();return;}
  if(view==='cart'&&event.key==='Escape'){event.preventDefault();root.querySelector('.vv-drawer [data-back]')?.click();return;}
  if(event.key==='Tab'&&(sheet||view==='cart')){const panel=root.querySelector(sheet?'.sf-sheet':'.vv-drawer');const nodes=[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea,select')].filter(n=>n.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
function previewMessage(text){
  const el=document.createElement('div');el.className='sf-preview-msg';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Prévia da mensagem');
  el.innerHTML=`<div class="sf-backdrop" data-close-msg></div><section class="sf-sheet sf-msg-sheet"><h2>Prévia da mensagem</h2><p class="sf-muted">Na loja publicada, o cliente abre o WhatsApp ${phoneOk()?`de ${esc(K.formatPhone(storePhone()))} `:''}com este texto. Nada foi enviado.</p><div class="sf-bubble">${esc(text)}</div><button type="button" class="sf-btn sf-btn-accent sf-btn-wide" data-close-msg>Fechar</button></section>`;
  root.querySelector('.sf').appendChild(el);el.querySelector('button').focus();el.addEventListener('click',e=>{if(e.target.closest('[data-close-msg]'))el.remove();});
}

/* ---------- Pedido registrado (fluxo existente, com reserva de estoque) ---------- */
async function acceptV2(payload,order){await attempts().accept(payload,order);orders=await attempts().list();cart={};pendingOrderAttempt=null;save();view='success';render(order);return true;}
async function restoreV2(checkStatus=true){
  orders=await attempts().list();const payload=await attempts().pending();
  if(payload){pendingOrderAttempt={payload};cart=Object.fromEntries(payload.items.map(i=>[i.catalogItemId,i.quantity]));customer={...customer,name:payload.customerName,phone:payload.customerPhone,address:payload.customerLocation};serviceModeId=payload.serviceModeId;view='checkout';
    if(!checkStatus)return false;
    try{const r=await orderStatusCall({catalogToken:visitToken,id:payload.id,orderAccessToken:payload.orderAccessToken});await acceptV2(payload,r.data.order);return true;}catch(e){if(!String(e.code||'').endsWith('not-found'))setTimeout(()=>toast('Há um envio em confirmação. Tente verificar novamente, sem criar outro pedido.'),300);}
  }return false;
}
async function refreshV2Orders(){
  if(preview||document.hidden||!navigator.onLine)return;
  for(const entry of orders.filter(o=>!['entregue','cancelado','expirado'].includes(o.data?.orderStatus)).slice(0,5)){
    try{const r=await orderStatusCall({catalogToken:visitToken,id:entry.id,orderAccessToken:entry.accessToken});entry.data=r.data.order;await attempts().accept({orderAccessToken:entry.accessToken},entry.data);}catch{/* Mantém o último estado confirmado; nunca afirma sucesso por falha de transporte. */}
  }if(view==='orders')render();
}
function orderErrorMessage(error){
  const code=String(error?.code||'').replace(/^(firestore|functions)\//,'');
  if(['invalid-argument','failed-precondition','aborted','already-exists'].includes(code))return error.message||'Revise os dados e tente novamente.';
  if(code==='permission-denied')return'Não foi possível registrar o pedido. Os dados enviados não foram aceitos.';
  if(code==='resource-exhausted'||code==='deadline-exceeded')return'O servidor atingiu um limite temporário. Seu carrinho continua salvo; tente novamente mais tarde.';
  if(!navigator.onLine)return'Sem conexão. Seu carrinho continua salvo.';
  if(code==='unavailable')return'Não foi possível confirmar a resposta do servidor. Verifique o envio pendente; seu carrinho continua salvo.';
  return'Não foi possível enviar o pedido. Tente novamente.';
}
function orderWriteWithTimeout(payload,timeoutMs=12000){let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Tempo limite ao registrar pedido.'),{code:'deadline-exceeded'})),timeoutMs)});return Promise.race([callable('submitCatalogOrder',payload),timeout]).finally(()=>clearTimeout(timer));}
function generateSecureToken(length=32){const bytes=crypto.getRandomValues(new Uint8Array(Math.ceil(length/2)));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,length);}
const normalizePaymentPreference=value=>({pix:'pix',dinheiro:'dinheiro',cartao:'cartao',entrega:'entrega'}[value]||'entrega');
async function submitOrder(){
  if(submittingOrder||preview)return;
  if(!navigator.onLine){toast('Sem conexão. Seu carrinho continua salvo.');return;}
  submittingOrder=true;render();
  try{
    const pending=pendingOrderAttempt?.payload;
    if(pending){
      try{const response=await attempts().verify(pending,p=>orderStatusCall({catalogToken:visitToken,id:p.id,orderAccessToken:p.orderAccessToken}),p=>orderWriteWithTimeout(p));await acceptV2(pending,response.data.order);toast('Pedido confirmado.');}
      catch(error){console.error('[Catalog Order] verify failed',{code:error.code||'local-persistence',stage:'verify_pending_order'});view='checkout';render();toast(orderErrorMessage(error));}
    }else await submitOrderData();
  }finally{submittingOrder=false;if(view==='checkout')render();}
}
async function submitOrderData(){
  const mode=currentMode(),data={nome:String(customer.name||'').trim(),telefone:K.phoneDigits(customer.phone),local:String(customer.address||'').trim(),payment:normalizePaymentPreference(payment),serviceModeId:String(mode?.id||mode?.type||'')};
  const normalizedItems=cartLines().map(l=>({catalogItemId:String(l.key),quantity:l.qty,unitPrice:Number(l.price.toFixed(2)),subtotal:Number((l.qty*l.price).toFixed(2))}));
  const canonicalTotal=Number(normalizedItems.reduce((s,i)=>s+i.subtotal,0).toFixed(2));
  if(!normalizedItems.length){toast('Seu carrinho está vazio.');return false;}
  if(normalizedItems.length>40||normalizedItems.some(i=>!Number.isInteger(i.quantity)||i.quantity>999)){
    toast('O pedido registrado aceita até 40 itens diferentes e 999 unidades por item. Revise o carrinho.');return false;
  }
  if(!(canonicalTotal>0&&canonicalTotal<=10000)){toast('O total do pedido precisa estar entre R$ 0,01 e R$ 10.000,00.');return false;}
  const attemptKey=JSON.stringify({items:normalizedItems.map(i=>[i.catalogItemId,i.quantity,i.unitPrice]),total:canonicalTotal,...data});
  if(!pendingOrderAttempt||pendingOrderAttempt.key!==attemptKey)pendingOrderAttempt={key:attemptKey,orderId:uuid(),orderAccessToken:generateSecureToken(32),publicOrderNumber:`VC${Date.now().toString().slice(-6)}`};
  const {orderId,orderAccessToken,publicOrderNumber}=pendingOrderAttempt;
  const payload={id:orderId,businessId:catalog.businessId,workspaceGeneration:catalog.workspaceGeneration??0,catalogToken:visitToken,source:'online_catalog',orderStatus:'recebido',customerName:data.nome,customerPhone:data.telefone,customerLocation:data.local,
    items:normalizedItems.map(i=>({catalogItemId:i.catalogItemId,quantity:i.quantity})),subtotal:canonicalTotal,discount:0,fee:0,total:canonicalTotal,expectedTotal:canonicalTotal,paymentPreference:data.payment,serviceModeId:data.serviceModeId||null,
    orderAccessToken,operationId:`catalog-order:${orderId}`,publicOrderNumber,visitId:catalog.visitId,clientRefToken:null,portalSessionHash:null,paymentStatus:'pendente',note:String(note||'').slice(0,1000),customerSessionToken:null};
  let durableAttempt=null;
  try{
    // Grava a tentativa exata ANTES da rede. Outra aba ou recarga reutiliza a mesma.
    const durable=await attempts().prepare(payload);durableAttempt=durable;pendingOrderAttempt={payload:durable};
    const response=await orderWriteWithTimeout(durable);
    await acceptV2(durable,response.data.order);toast('Pedido recebido. Estoque reservado.');return true;
  }catch(error){
    if(durableAttempt&&['invalid-argument','failed-precondition','permission-denied'].some(c=>String(error.code||'').endsWith(c))){
      const recovery=await attempts().reconcileFailure(durableAttempt,async p=>(await orderStatusCall({catalogToken:visitToken,id:p.id,orderAccessToken:p.orderAccessToken})).data.order);
      if(recovery.status==='accepted'){await acceptV2(durableAttempt,recovery.order);return true;}
      if(recovery.status==='absent')pendingOrderAttempt=null;
    }
    console.error('[Catalog Order] create failed',{code:error.code||'local-persistence',stage:'submit_order'});
    view='checkout';render();toast(orderErrorMessage(error));return false;
  }
}

/* ---------- Início, erros e prévia ---------- */
function prepareCatalogIdentity(){
  const modes_=modes();if(!modes_.some(m=>String(m.id||m.type)===String(serviceModeId)))serviceModeId=String(modes_[0]?.id||modes_[0]?.type||'');
  const brand=catalog.publicName||'Loja';
  if(!preview){document.title=`${brand} — Catálogo online`;document.querySelector('meta[name="description"]')?.setAttribute('content',`Catálogo online de ${brand}. Veja produtos disponíveis e faça seu pedido.`);}
  const t=K.theme({primaryColor:catalog.primaryColor,secondaryColor:catalog.secondaryColor});document.querySelector('meta[name="theme-color"]')?.setAttribute('content',t.band);document.documentElement.style.setProperty('--sf-page-band',t.band);
  for(const key of Object.keys(cart))if(!orderable().some(o=>o.key===key))delete cart[key];
}
function showCatalogError(code,error){
  const s=error?.store;
  if(code==='paused'&&s){const t=K.theme(s),phone=K.validPhone(s.contactPhone)?K.phoneDigits(s.contactPhone):'';document.title=`${s.publicName} — Loja pausada`;
    root.innerHTML=`<div class="sf sf-state" style="--sf-band:${t.band};--sf-on-band:${t.onBand};--sf-accent:${t.accent};--sf-on-accent:${t.onAccent};--sf-band-muted:${t.bandMuted}"><section class="sf-state-card"><span class="sf-logo">${s.logoUrl?`<img src="${esc(s.logoUrl)}" alt="">`:`<span>${esc(initials(s.publicName))}</span>`}</span><h1>${esc(s.publicName)}</h1><p>A loja está pausada no momento e não recebe pedidos por aqui.</p>${s.openingHours?`<p class="sf-muted">${esc(s.openingHours)}</p>`:''}${phone?`<a class="sf-btn sf-btn-wa" href="https://wa.me/${phone}" target="_blank" rel="noopener">${I.wa}<span>Falar com a loja</span></a>`:''}<p class="sf-made"><img src="./assets/veconi-symbol.svg" alt="" width="16" height="16"><span>Loja criada com VECONI</span></p></section></div>`;return;}
  const messages={'permission-denied':['Sem acesso a esta loja','O link existe, mas o acesso público não foi autorizado.'],'not-found':['Loja não encontrada','Confira se o link recebido está completo ou peça um novo link à loja.'],inactive:['Esta loja não está disponível','Peça à loja o link atualizado.'],network:['Sem conexão com a loja','Verifique sua internet e tente de novo.']}[code]||['Sem conexão com a loja','Verifique sua internet e tente de novo.'];
  console.error('[Public catalog load]',{code,firestoreCode:error?.code||null,tokenSource:queryToken?'query-v':legacyPathToken?'legacy-path':params.has('loja')?'slug':'missing',online:navigator.onLine});
  root.innerHTML=`<div class="sf sf-state"><section class="sf-state-card"><img src="./assets/veconi-symbol.svg" alt="" width="44" height="44"><h1>${messages[0]}</h1><p>${messages[1]}</p><button type="button" class="sf-btn sf-btn-ghost" onclick="location.reload()">Tentar de novo</button><p class="sf-made"><span>Loja criada com VECONI</span></p></section></div>`;
}
async function start(){
  try{
    catalog=await loadPublicCatalog();prepareCatalogIdentity();
    await DB.localRecords.transaction('readwrite',(store,done)=>{store.put({key:`public-catalog:${visitToken}:cache`,scope:`public-catalog:${visitToken}`,type:'reconstructable-catalog',data:catalog});done(true);}).catch(()=>{});
    if(await restoreV2().catch(()=>false))return;
    render();
  }catch(error){
    const code=normalizedCatalogErrorCode(error);
    if(code==='network'){const cached=(await DB.localRecords.read(`public-catalog:${visitToken}:cache`).catch(()=>null))?.data;if(cached?.schemaVersion>=6&&cached.catalogType==='space_store'&&cached.spaceId&&cached.active===true&&cached.catalogVisible!==false&&(!cached.catalogToken||cached.catalogToken===visitToken)){catalog=cached;prepareCatalogIdentity();await restoreV2(false).catch(()=>false);render();root.querySelector('.sf')?.insertAdjacentHTML('afterbegin','<p class="sf-notice sf-notice-warn" role="status">Sem conexão: mostrando a última versão salva da loja.</p>');return;}}
    showCatalogError(code,error);
  }
}
// Prévia do painel: só aceita mensagens da própria origem, vindas da janela que embute a loja.
function startPreview(){
  root.innerHTML='<div class="catalog-loading"><span class="catalog-logo"><img src="./assets/veconi-symbol.svg" alt=""></span><p>Montando a prévia…</p></div>';
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='veconi-store-preview')return;
    const data=event.data.catalog;if(!data||!Array.isArray(data.items))return;
    previewTheme=['light','dark'].includes(data.previewTheme)?data.previewTheme:'';syncPublicTheme();
    const y=scrollY_(),sheetY=root.querySelector('.sf-sheet')?.scrollTop||0;
    catalog={...data,schemaVersion:6,catalogType:'space_store'};prepareCatalogIdentity();
    if(Number.isInteger(data.previewSlide) && data.previewSlide>=0)slideIndex=Math.max(0,K.storefrontLayout(catalog).slides.slice(0,data.previewSlide).filter(s=>s.active).length);
    if(sheet&&!catalog.items.some(i=>String(i.id)===String(sheet.id)))sheet=null;
    render();scrollTo(0,y);const s=root.querySelector('.sf-sheet');if(s)s.scrollTop=sheetY;
  });
  try{window.parent?.postMessage({type:'veconi-store-preview-ready'},location.origin);}catch{}
}
preview?startPreview():start();
if(!preview){addEventListener('online',()=>catalog&&view==='catalog'&&render());addEventListener('offline',()=>catalog&&view==='catalog'&&render());}
// Register after the navigation handler: the view must already be "catalog".
root.addEventListener('click',event=>{if(!preview&&event.target.closest('[data-go="catalog"],[data-back="catalog"]'))refreshPublicAvailability();});
if(!preview&&'serviceWorker'in navigator&&location.protocol.startsWith('http')&&!['localhost','127.0.0.1'].includes(location.hostname))navigator.serviceWorker.register('./service-worker.js').catch(error=>console.error('[Catalog service worker]',error));
