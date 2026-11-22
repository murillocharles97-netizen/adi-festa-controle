// VECONI Loja Online V3 — helpers puros compartilhados pelo painel e pela loja pública.
// Sem rede, sem Firebase e sem dados internos: só apresentação, rascunho e mensagem do pedido.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StoreKit=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const clip=(v,max)=>v.slice(0,max).replace(/[\uD800-\uDBFF]$/,'');
  const text=(v,max=160)=>clip(String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim(),max);
  const line=(v,max=160)=>clip(text(v,max*2).replace(/\s+/g,' '),max);
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/ /g,' ');

  /* ---------- Telefone (mesma regra de js/phone.js, sem depender da página) ---------- */
  function phoneDigits(value){let d=String(value||'').replace(/\D/g,'');if(d.startsWith('00'))d=d.slice(2);if(d.startsWith('0')&&(d.length===11||d.length===12))d=d.slice(1);if(d.length===10||d.length===11)d=`55${d}`;return d;}
  const validPhone=value=>/^55[1-9]\d\d{8,9}$/.test(phoneDigits(value));
  function formatPhone(value){const full=phoneDigits(value),local=full.startsWith('55')?full.slice(2):full;if(local.length<10)return String(value||'');const ddd=local.slice(0,2),n=local.slice(2),cut=Math.max(4,n.length-4);return `(${ddd}) ${n.slice(0,cut)}-${n.slice(cut)}`;}
  function phoneProblem(value){
    const raw=String(value||'').trim();if(!raw)return 'Informe o WhatsApp que vai receber os pedidos.';
    const d=phoneDigits(raw);if(!validPhone(d))return d.length<12?'Inclua o DDD e o número completo. Ex.: (11) 91234-5678.':'Use um número brasileiro com DDD. Ex.: (11) 91234-5678.';
    return '';
  }

  /* ---------- Cores: estilos prontos e contraste automático ---------- */
  // Cada estilo é um par (destaque, faixa da marca). O texto sobre cada cor é calculado.
  const PALETTES=Object.freeze([
    {id:'turquesa',name:'Turquesa',primary:'#0f9f94',secondary:'#0b2730'},
    {id:'menta',name:'Menta clara',primary:'#0d8a73',secondary:'#e3f4ef'},
    {id:'rose',name:'Rosé',primary:'#c23b6a',secondary:'#fbe7ee'},
    {id:'ambar',name:'Âmbar',primary:'#b45309',secondary:'#fcefdc'},
    {id:'folha',name:'Folha',primary:'#2f9e57',secondary:'#11291c'},
    {id:'grafite',name:'Grafite',primary:'#2b2d31',secondary:'#ecedee'},
    {id:'ameixa',name:'Ameixa',primary:'#8b5cf6',secondary:'#1c1530'},
    {id:'oceano',name:'Oceano',primary:'#0b6fb8',secondary:'#e5f0f9'},
    {id:'coral',name:'Coral',primary:'#e0533d',secondary:'#2b1712'}
  ]);
  const hex=v=>/^#[a-f0-9]{6}$/i.test(v||'')?String(v).toLowerCase():'';
  const rgb=v=>{const h=hex(v)||'#000000';return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16));};
  const toHex=c=>'#'+c.map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join('');
  function luminance(v){return rgb(v).map(c=>{c/=255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);}
  function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  const INK='#14191c',WHITE='#ffffff';
  function onColor(bg){
    const light=contrast(bg,WHITE),dark=contrast(bg,INK);
    if(Math.max(light,dark)<4.5)return '#000000';
    return light>=dark?WHITE:INK;
  }
  function mix(a,b,t){const x=rgb(a),y=rgb(b);return toHex(x.map((c,i)=>c+(y[i]-c)*t));}
  // Escurece (ou clareia) a cor até ser legível como texto sobre a superfície.
  function readable(color,surface=WHITE,target=4.5){let c=hex(color)||'#0f9f94';const towards=luminance(surface)>.4?'#000000':'#ffffff';for(let i=0;i<20&&contrast(c,surface)<target;i++)c=mix(c,towards,.12);return c;}
  function paletteId(settings={}){const p=hex(settings.primaryColor),s=hex(settings.secondaryColor);return PALETTES.find(x=>x.primary===p&&x.secondary===s)?.id||'custom';}
  function theme(settings={}){
    const accent=hex(settings.primaryColor)||'#0f9f94',band=hex(settings.secondaryColor)||'#0b2730',onBand=onColor(band),bandDark=onBand===WHITE;
    return {accent,onAccent:onColor(accent),accentText:readable(accent,WHITE),band,onBand,bandDark,
      bandMuted:bandDark?'rgba(255,255,255,.74)':'rgba(20,25,28,.68)',bandChip:bandDark?'rgba(255,255,255,.12)':'rgba(20,25,28,.07)',
      accentSoft:mix(accent,WHITE,.88),bandAccent:readable(accent,band,3)};
  }
  function colorWarning(settings={}){
    const t=theme(settings);
    if(contrast(t.accent,WHITE)<1.6)return 'A cor de destaque está muito clara: botões e preços vão perder destaque.';
    if(contrast(t.band,t.accent)<1.25)return 'As duas cores estão muito parecidas: os botões vão se misturar com a faixa da marca.';
    return '';
  }

  /* ---------- Link da loja ---------- */
  const RESERVED=['admin','api','login','planos','catalogo','app'];
  function slugify(value){
    let s=String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' e ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48).replace(/-+$/,'');
    if(s.length<3)s=(s+'-loja').replace(/^-/,'');
    if(RESERVED.includes(s))s=`${s}-loja`;
    return s;
  }
  function slugProblem(value){
    const s=String(value||'');
    if(!s)return 'Escolha o endereço da loja.';
    if(!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(s))return 'Use de 3 a 48 letras minúsculas, números ou hífens, sem hífen no começo ou no fim.';
    if(RESERVED.includes(s))return 'Esse endereço é reservado. Escolha outro.';
    return '';
  }

  /* ---------- Rascunho: base confirmada + alterações locais ---------- */
  const clone=v=>JSON.parse(JSON.stringify(v??null));
  function draftFromStore(store,fallbackName=''){
    const s=store||{};
    return {settings:{...(s.catalogSettings||{publicName:fallbackName})},slug:s.slug||'',productIds:[...(s.selectedProductIds||[])],
      presentation:{...(s.presentation?.storefrontLayout ? {storefrontLayout:clone(s.presentation.storefrontLayout)} : {}),products:clone(s.presentation?.products)||{},categories:clone(s.presentation?.categories)||[]}};
  }
  function applyOp(d,op){
    const products=d.presentation.products,p=id=>(products[id]=products[id]||{});
    switch(op.t){
      case 'select':{const set=new Set(d.productIds);op.on?set.add(op.id):set.delete(op.id);d.productIds=[...set];if(!op.on&&products[op.id])products[op.id].featured=false;break;}
      case 'selectMany':{const set=new Set(d.productIds);for(const id of op.ids)op.on?set.add(id):set.delete(id);d.productIds=[...set];if(!op.on)for(const id of op.ids)if(products[id])products[id].featured=false;break;}
      case 'storefrontLayout':d.presentation.storefrontLayout=clone(op.value);break;
      case 'feature':p(op.id).featured=!!op.on;break;
      case 'featureMany':for(const id of op.ids)p(id).featured=!!op.on;break;
      case 'order':op.ids.forEach((id,i)=>{p(id).order=i+1;});break;
      case 'category':p(op.id).category=line(op.value,100);break;
      case 'categoryOrder':{const list=d.presentation.categories,by=new Map(list.map(c=>[c.internalName,c]));op.names.forEach((name,i)=>{const c=by.get(name)||{internalName:name,publicName:name,active:true};c.order=i;by.set(name,c);});d.presentation.categories=[...by.values()];break;}
      case 'categoryName':{const list=d.presentation.categories,c=list.find(x=>x.internalName===op.name);const publicName=line(op.value,100)||op.name;if(c)c.publicName=publicName;else list.push({internalName:op.name,publicName,active:true,order:list.length});break;}
      case 'setting':d.settings[op.key]=op.value;break;
      case 'settings':Object.assign(d.settings,op.values);break;
      case 'slug':d.slug=op.value;break;
      default:throw Error(`Alteração desconhecida: ${op.t}`);
    }
    return d;
  }
  function applyOps(base,ops){return ops.reduce((d,op)=>applyOp(d,op),clone(base));}
  // Exatamente o contrato atual de saveOnlineStore: apresentação apenas dos itens selecionados.
  function savePayload(d){
    const products={};
    for(const id of d.productIds){const x=d.presentation.products[id]||{};products[id]={featured:x.featured===true,bestseller:x.bestseller===true,order:Math.max(0,Number(x.order)||0),category:line(x.category||'',100)};}
    return {slug:d.slug,settings:d.settings,productIds:[...d.productIds],presentation:{...(d.presentation.storefrontLayout ? {storefrontLayout:clone(d.presentation.storefrontLayout)} : {}),products,categories:d.presentation.categories.map(c=>({internalName:c.internalName,publicName:c.publicName||c.internalName,active:c.active!==false,order:Math.max(0,Number(c.order)||0)}))}};
  }

  /* ---------- Situação, preparação e diferenças para a versão publicada ---------- */
  function status(store){if(!store)return 'new';if(store.published===true)return 'published';return store.activation?'paused':'draft';}
  function readiness({settings={},selectedCount=0,state='draft',pending=false}){
    const steps=[
      {id:'identity',title:'Identidade',done:!!text(settings.publicName)},
      {id:'products',title:'Produtos',done:selectedCount>0},
      {id:'whatsapp',title:'WhatsApp',done:validPhone(settings.contactPhone)},
      {id:'publish',title:'Publicar e compartilhar',done:state==='published'&&!pending}
    ];
    return {steps,done:steps.filter(s=>s.done).length,next:steps.find(s=>!s.done)?.id||null,canPublish:steps.slice(0,2).every(s=>s.done)};
  }
  const SETTING_LABELS={publicName:'nome',welcomeText:'descrição',primaryColor:'cores',secondaryColor:'cores',logoUrl:'logo',bannerUrl:'capa',coverUrl:'capa',contactPhone:'WhatsApp',instagram:'Instagram',address:'endereço',openingHours:'horários',pickupEnabled:'retirada',deliveryEnabled:'entrega',pickupAddress:'retirada',deliveryInstructions:'entrega',paymentMethods:'formas de pagamento'};
  function publishedDiff(draft,live,baseCategory){
    if(!live)return null;
    const changes=[],seen=new Set(),ls=live.publicSettings||live;
    for(const [key,label] of Object.entries(SETTING_LABELS)){const a=JSON.stringify(draft.settings[key]??''),b=JSON.stringify(ls[key]??'');if(a!==b&&!seen.has(label)){seen.add(label);changes.push(label);}}
    if(draft.presentation.storefrontLayout && (!live.storefrontLayout || JSON.stringify(visibleLayout(draft.presentation.storefrontLayout))!==JSON.stringify(visibleLayout(live.storefrontLayout))))changes.push('layout e banners');
    const liveIds=new Set((live.items||[]).map(i=>i.productId)),ids=new Set(draft.productIds);
    const added=[...ids].filter(id=>!liveIds.has(id)).length,removed=[...liveIds].filter(id=>!ids.has(id)).length;
    if(added)changes.push(added===1?'1 produto incluído':`${added} produtos incluídos`);
    if(removed)changes.push(removed===1?'1 produto retirado':`${removed} produtos retirados`);
    const liveItems=new Map((live.items||[]).map(i=>[i.productId,i]));
    let featured=0,order=0,categoryChanged=false;for(const id of ids){const i=liveItems.get(id),x=draft.presentation.products[id]||{};if(!i)continue;if(!!i.featured!==!!x.featured||!!i.bestseller!==!!x.bestseller)featured++;if(Number(i.displayOrder||0)!==Number(x.order||0))order++;const category=x.category||baseCategory?.(id);if(category&&i.category!==category)categoryChanged=true;}
    if(featured)changes.push('destaques');if(order)changes.push('ordem dos produtos');
    const liveCategories=new Map((live.categories||[]).map(c=>[c.internalName,c]));
    if(categoryChanged||draft.presentation.categories.some(c=>{
      const previous=liveCategories.get(c.internalName);
      return !previous||['publicName','active','order'].some(k=>c[k]!==previous[k]);
    }))changes.push('categorias');
    return changes;
  }

  /* ---------- Pedido pelo WhatsApp ---------- */
  const PAYMENT_LABELS={entrega:'A combinar',pix:'Pix',dinheiro:'Dinheiro',cartao:'Cartão'};
  function orderMessage(input){
    const store=line(input.storeName,100)||'da loja',items=(input.items||[]).filter(i=>Number(i.quantity)>0);
    if(!items.length)throw Error('O carrinho está vazio.');
    const rows=items.map(i=>{const q=Math.max(1,Math.floor(Number(i.quantity))),name=line(i.name),variant=line(i.variant);return {text:`${q}x ${name}${variant?` (${variant})`:''} — ${money(q*Number(i.unitPrice||0))} (${money(i.unitPrice)} cada)`,total:q*Number(i.unitPrice||0)};});
    const subtotal=Math.round(rows.reduce((s,r)=>s+r.total,0)*100)/100,mode=input.mode||null,customer=input.customer||{};
    const code=line(input.orderNumber,80);
    const out=[code?`Pedido #${code} · ${store}`:`Olá! Gostaria de fazer um pedido pela loja ${store}.`,'','🛒 *Meu pedido*',...rows.map(r=>r.text),'',`Subtotal: ${money(subtotal)}`];
    if(mode==='pickup'){out.push('Entrega: Retirada na loja');const address=line(input.pickupAddress,300);if(address)out.push(`Local de retirada: ${address}`);}
    else if(mode==='delivery'){out.push('Entrega: Entregar no endereço');const address=line(customer.address,200);if(address)out.push(`Endereço: ${address}`);out.push('Taxa de entrega: a combinar');}
    const payment=PAYMENT_LABELS[input.payment];if(payment&&input.payment!=='entrega')out.push(`Pagamento: ${payment}`);
    const note=text(input.note,500).replace(/\n{3,}/g,'\n\n');if(note)out.push(`Observações: ${note}`);
    const name=line(customer.name,80);if(name)out.push(`Nome: ${name}`);
    const phone=line(customer.phone,30);if(phone)out.push(`Telefone: ${phone}`);
    out.push('',`*Total dos produtos: ${money(subtotal)}*`);
    if(mode==='delivery')out.push('A taxa de entrega ainda não está incluída.');
    if(!code)out.push('','Aguardo a confirmação da disponibilidade e do pedido. Obrigado!');
    return {text:out.join('\n'),subtotal};
  }
  // Budget for the encoded URL, leaving room for redirects within the HTTP
  // interoperability recommendation (RFC 9110 §4.1). WhatsApp publishes no cap.
  const WHATSAPP_PREFILL_URL_BUDGET=4000;
  function whatsappPhone(phone){
    if(!validPhone(phone))throw Error('Esta loja ainda não informou um WhatsApp válido.');
    return phoneDigits(phone);
  }
  const whatsappChatUrl=phone=>`https://wa.me/${whatsappPhone(phone)}`;
  function whatsappUrl(phone,message){
    // The wa.me redirect can replace emoji. Use its web destination directly.
    const prefix=`https://api.whatsapp.com/send/?phone=${whatsappPhone(phone)}&text=`;
    const text=String(message);
    if(prefix.length+text.length>WHATSAPP_PREFILL_URL_BUDGET)return '';
    const safeMessage=text.replace(/(?:[\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g,part=>part.length===2?part:'\uFFFD');
    const url=prefix+encodeURIComponent(safeMessage);
    return url.length<=WHATSAPP_PREFILL_URL_BUDGET?url:'';
  }

  const bannerTemplates = {
    robot: ['Monte seu carrinho.', 'Finalize pelo WhatsApp.', 'Ver catálogo'],
    offers: ['Ofertas especiais', '', 'Ver produtos'],
    arrivals: ['Novidades da loja', '', 'Explorar catálogo'],
    promotion: ['Promoções', '', 'Ver produtos'],
    featured: ['Produtos em destaque', '', 'Ver destaques'],
    discover: ['Aproveite nossas ofertas', '', 'Ver catálogo'],
    easy: ['Compre com facilidade', '', 'Escolher produtos']
  };
  function bannerSlide(template = 'robot') {
    const [title, description, button] = bannerTemplates[template];
    return {template, title, description, button, target:template === 'featured' ? 'featured' : 'catalog', active:true, imageUrl:''};
  }
  function storefrontLayout(catalog = {}) {
    const configured=catalog.storefrontLayout;
    if(configured?.version===1 && Array.isArray(configured.slides)){
      const readSlide=s=>{
        const template=Object.hasOwn(bannerTemplates,s?.template)?s.template:'robot';
        return {...bannerSlide(template),title:line(s?.title,100),description:line(s?.description,300),button:line(s?.button,40),
          target:typeof s?.target==='string'?s.target:'catalog',active:s?.active!==false,imageUrl:typeof s?.imageUrl==='string'?s.imageUrl:''};
      };
      return {version:1,slides:configured.slides.filter(Boolean).map(readSlide),featured:configured.featured!==false,
        secondary:configured.secondary?readSlide(configured.secondary):{...bannerSlide('easy'),active:false}};
    }
    const slides = (catalog.banners || []).filter(b => b.active !== false && b.imageUrl &&
      (!b.startsAt || Date.parse(b.startsAt) <= Date.now()) && (!b.endsAt || Date.parse(b.endsAt) >= Date.now()))
      .slice().sort((a,b) => a.order-b.order)
      .map(b => ({...bannerSlide(), title:b.title || catalog.publicName, description:b.subtitle || '', imageUrl:b.imageUrl,
        button:b.actionUrl ? 'Saiba mais' : 'Ver catálogo', target:/^https?:\/\//i.test(b.actionUrl || '') ? b.actionUrl : 'catalog'}));
    if (!slides.length) {
      const slide = bannerSlide();
      if (catalog.acceptingOrders || !validPhone(catalog.contactPhone)) slide.description = 'Escolha os produtos da loja.';
      slides.push(slide);
    }
    return {version:1, slides, featured:true, secondary:{...bannerSlide('easy'), active:false}};
  }

  function visibleLayout(value) {
    const layout=storefrontLayout({storefrontLayout:value});
    return {...layout,slides:layout.slides.filter(s=>s.active),secondary:layout.secondary.active?layout.secondary:null};
  }
  return Object.freeze({bannerTemplates,bannerSlide,storefrontLayout,text,line,money,phoneDigits,validPhone,formatPhone,phoneProblem,PALETTES,hex,contrast,onColor,readable,paletteId,theme,colorWarning,
    slugify,slugProblem,draftFromStore,applyOp,applyOps,savePayload,status,readiness,publishedDiff,PAYMENT_LABELS,orderMessage,whatsappChatUrl,whatsappUrl});
});
