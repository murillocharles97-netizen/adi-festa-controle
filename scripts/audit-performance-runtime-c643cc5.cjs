'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, links, assetServer, launch, setup, metrics, delta, profiler, listen, save } = require('./performance-lab-helpers.cjs');

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const shell = read('tests/desktop-shell-content.fixture.html');
const finance = read('tests/financial-module.fixture.html');
const scripts = [...index.matchAll(/<script\b([^>]*)><\/script>/g)]
  .filter(([, attrs]) => !attrs.includes('type="module"'))
  .map(([tag]) => tag.replace(/src="\.\//, 'src="/'));
const scriptFile = tag => tag.match(/src="(?:\.\.\/|\.\/|\/)?([^"?]+)/)?.[1];
const shellFiles = new Set([...shell.matchAll(/<script\b[^>]*src="[^"]+"[^>]*>/g)].map(([tag]) => scriptFile(tag)));
const additions = scripts.filter(tag => {
  const file = scriptFile(tag);
  return file && !shellFiles.has(file) && !/auth|google-|firebase\/|pwa-update|financial-ui|financial-engine|financial-accounts-carousel/.test(file);
});
const financeService = [...finance.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .find(([, body]) => body.includes('window.FinancialSpaceService='));
assert.ok(financeService);

const seeded = `
 const large = new URLSearchParams(location.search).get("volume") === "large";
 const n = large ? 2000 : 25, salesCount = large ? 5000 : 50, payCount = large ? 1600 : 20;
 const name = (group,i) => group + " QA " + String(i).padStart(5,"0");
 for (let i = 0; i < n; i++) {
   data.produtos.push({
     id:"bench-p"+i, nome:name("Produto",i), ativo:true, categoria:"Categoria "+(i%12),
     preco:10+i%80, custo:7, estoque:20, estoqueAtual:20, estoqueMinimo:2,
     image:i%9===0?{url:"/tests/fixtures/sample-product.svg",thumbnailUrl:"/tests/fixtures/sample-product.svg"}:undefined
   });
   data.clientes.push({id:"bench-c"+i,nome:name("Cliente",i),ativo:true,saldo:0,criadoEm:iso(i%95),ultimaCompra:iso(i%15)});
 }
 for(let i=0;i<salesCount;i++) data.vendas.push({
   id:"bench-v"+i,clienteId:"bench-c"+(i%n),clienteNome:name("Cliente",i%n),data:iso(i%90),createdAt:iso(i%90),
   valorFinal:25,valorPago:25,lucro:15,status:"pago",formaPagamento:"pix", financialSpaceId:"fixture-space",
   itens:[{produtoId:"bench-p"+(i%n),nome:name("Produto",i%n),quantidade:1,subtotalFinal:25}]
 });
 for(let i=0;i<payCount;i++) data.pagamentos.push({id:"bench-pg"+i,clienteId:"bench-c"+(i%n),data:iso(i%90),valor:15,formaPagamento:"pix"});
 window.__fixtureLengths={products:data.produtos.length,clients:data.clientes.length,sales:data.vendas.length,payments:data.pagamentos.length};
`;
const routeFixture = shell
  .replace(/<link\b(?=[^>]*\brel="stylesheet")[^>]*>/g, '')
  .replace('</head>', links(index) + '</head>')
  .replace('data.campanhas = [];', seeded + 'data.campanhas = [];')
  .replace(/  <script>\r?\n    window\.__fixtureReady/, match => additions.join('\n') + '\n' + match)
  .replace('  <script src="../js/app.js"></script>', () =>
    '<script src="/js/financial-engine.js"></script>' + financeService[0].replace(/^.*window.Router=.+$/m,'') +
    '<script src="/js/financial-accounts-carousel.js"></script><script src="/js/financial-ui.js"></script>' +
    '<script src="../js/app.js"></script>');
const server = assetServer(file => file === '/tests/performance-lab-shell.html' ? routeFixture : null);
const rounds = Number(process.env.PERF_ROUNDS || 3);
const wanted=(value,key)=>!process.env[key]||process.env[key].split(',').includes(value);
const profiles = [{ mobile:false, theme:'light' },{ mobile:true, theme:'light' },{ mobile:true, theme:'dark' }].filter(p=>wanted((p.mobile?'mobile-':'desktop-')+p.theme,'PERF_PROFILE'));
const routes = ['vender','clientes','produtos','historico','relatorios','financeiro','crm','renovacoes','cobrancas','consignados',
  'equipe','campanhas','catalogo','pedidos','configuracoes','planos','cupons','inicio'].filter(route=>wanted(route,'PERF_ROUTES'));
const rows = [];

async function runRoute(page, route) {
  return page.evaluate(async route => {
    const start = performance.now(), app = document.querySelector('#app'), mount = app.dataset.pageInstance;
    window.__lab.routeStart=start;
    const rendered = await new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (app.dataset.route === route && app.dataset.pageInstance !== mount && app.children.length) finish(true);
      });
      const timer = setTimeout(() => finish(false), 1500);
      function finish(ok) { clearTimeout(timer); observer.disconnect(); resolve(ok); }
      observer.observe(app, { attributes:true, childList:true });
      Router.ir(route);
    });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const failure = !rendered || !!app.querySelector('.boot-recovery');
    return { total:performance.now()-start, route:app.dataset.route, content:app.children.length,
      nodes:app.querySelectorAll('*').length,
      cards:app.querySelectorAll('.pos-product,.desktop-pos-card,.mobile-swipe-shell,.mobile-product-card').length,
      theme:document.documentElement.dataset.theme,
      fault:failure?'render ficou indisponivel ou rota bloqueada':undefined };
  }, route);
}

async function actions(page, route) {
  return page.evaluate(async route => {
    const pick = selectors => selectors.map(s => document.querySelector(s)).find(n => n?.offsetWidth && n.offsetHeight);
    const paint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    async function record(name, perform, expected) {
      if (!perform) return { name, fault:'controle indisponivel' };
      try {
        const start = performance.now(), root = expected?.root;
        let observed = false, eventAt = null;
        const event = expected?.event;
        const onEvent = () => { observed = true; eventAt = performance.now(); };
        const observer = root && new MutationObserver(onEvent);
        observer?.observe(root,{childList:true,attributes:true,subtree:true});
        if (event) addEventListener(event,onEvent,{once:true});
        perform();
        const syncMs = performance.now()-start;
        if (expected && !observed) {
          const end = start + 1100;
          while (!observed && performance.now()<end) await new Promise(r => setTimeout(r,15));
        }
        observer?.disconnect();
        if (event) removeEventListener(event,onEvent);
        await paint();
        return {name,ms:performance.now()-start,syncMs,updateMs:eventAt===null?null:eventAt-start,
          fault:expected&&!observed?'nao houve atualizacao observavel':undefined};
      } catch(e) {return {name,fault:e.message};}
    }
    const input = pick(route === 'vender' ? ['#product-search','#desktop-sales-search','[data-desktop-pos-search]'] :
      route === 'clientes' ? ['#mobile-client-search','#client-search','#search','input[type=search]'] : ['#mobile-product-search','#search','input[type=search]']);
    const expected = route==='vender'?{event:'sale-products-filtered'}:
      {root:document.querySelector(route==='clientes'?'#app':'#mobile-products,#desktop-product-grid,#entity-list')};
    const set = (node,value,event='input') => () => {node.value=value;node.dispatchEvent(new Event(event,{bubbles:true}));};
    const query=route==='vender'?'Cone':'QA 0001';
    const result = [await record(route+'-busca',input&&set(input,query),expected.root||expected.event?expected:null)];
    if(input&&route==='clientes'){
      const beforeErrors=window.__lab.errors.length;
      const missing=await record('clientes-busca-sem-resultados',set(input,'QA nenhum nome correspondente'),expected);
      missing.emptyMessage=!!document.querySelector('.mobile-client-empty,.client-empty,[data-client-empty]')||
        /nenhum cliente/i.test(document.querySelector('#app')?.innerText||'');
      if(window.__lab.errors.length>beforeErrors||!missing.emptyMessage)missing.fault='estado vazio nao confirmado';
      result.push(missing);
    }
    if (input&&route!=='vender') {
      const reset=pick(route==='clientes'?['#mobile-client-search','#client-search']:['#mobile-product-search','#search']);
      if(reset)await record('limpar busca',set(reset,''),expected.root||expected.event?expected:null);
    }
    if (route==='produtos') {
      const sort = pick(['#mobile-product-sort']);
      const filter = pick(['[data-product-filter="favoritos"]','[data-desktop-product-filter="disponivel"]']);
      result.push(await record('produtos-ordenar',sort&&set(sort,'nomeDesc','change')));
      result.push(await record('produtos-filtrar',filter&&(()=>filter.click())));
    }
    if (route==='vender') {
      const card=pick(['.pos-product [data-add="p1"]','.pos-product[data-add="p1"]','[data-add="p1"]']), bag=pick(['#open-sale-summary']);
      result.push(await record('venda-adicionar',card&&(()=>card.click())));
      result.push(await record('venda-carrinho',bag&&(()=>bag.click())));
      const next=pick(['#desktop-continue-sale']);
      if(next) result.push(await record('venda-etapa-pagamento',()=>next.click()));
      const method=pick(['#sale-payment-method']), chip=pick(['[data-payment="dinheiro"]']);
      result.push(await record('venda-selecionar-pagamento',chip?()=>chip.click():method&&set(method,'dinheiro','change')));
      result.push({name:'venda-checagem',itemCount:document.querySelector('#cart')?.querySelectorAll('.editable-cart,[data-cart-row]').length,
        total:document.querySelector('#manual-total')?.value,payment:document.querySelector('#sale-payment-method')?.value});
      const close=pick(['#close-sale-summary']);
      if(close) close.click();
      Checkout.reset?.();
    }
    return result;
  },route);
}

async function persistence(page, volume, run) {
  return page.evaluate(async ({volume,run}) => {
    const source=DB.carregar(), large=volume==='large';
    const key='adiFestaDB_v1:perf-idb-'+volume+'-'+run+':owner:owner';
    await DB.businessCache.release();
    await DB.businessCache.open(key,[],()=>({}));
    const phase = async perform => {const start=performance.now();const result=await perform();return {ms:performance.now()-start,result};};
    const saveSource = async () => {DB.businessCache.stage(source,key);await DB.flush();return (await DB.businessCache.diagnostic()).lastCommit;};
    const initial = await phase(saveSource);
    source.produtos[0] = {...source.produtos[0],estoqueAtual:19};
    const oneChange = await phase(saveSource);
    await DB.businessCache.release();
    const reopen = await phase(async()=>{
      const data=await DB.businessCache.open(key,[],()=>({}));
      if(data.produtos[0].estoqueAtual!==19)throw Error('a gravacao nao foi reaberta');
      return {products:data.produtos.length,sales:data.vendas.length};
    });
    const estimation=await navigator.storage.estimate();
    const canvas=document.createElement('canvas'); canvas.width=2400;canvas.height=1800;
    const context=canvas.getContext('2d');
    const data=context.createImageData(canvas.width,canvas.height);
    let x=run+15;
    for (let i=0;i<data.data.length;i+=4) {
      x=(Math.imul(x,1664525)+1013904223)>>>0;data.data[i]=x>>>24;
      data.data[i+1]=((i>>2)%2400)/10;data.data[i+2]=(i/(2400*4))%256;data.data[i+3]=255;
    }
    context.putImageData(data,0,0);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.86));
    const image=await phase(async()=>{
      const result=await ProductImages.processImage(new File([blob],'qa.jpg',{type:blob.type}));
      return {input:blob.size,main:result.mainBlob.size,thumb:result.thumbBlob.size};
    });
    const imageCache=await caches.open('qa-image-volume');
    const response=new Response(blob,{headers:{'Content-Type':blob.type}});
    const count=large?30:4;
    const cacheWrite=await phase(async()=>{
      for(let i=0;i<count;i++)await imageCache.put('/qa-local-foto/'+i,response.clone());
      return {count,payloadBytes:count*blob.size};
    });
    const cacheRead=await phase(async()=>{
      const found=await imageCache.match('/qa-local-foto/'+(count-1));
      return (await found.blob()).size;
    });
    return { initial,oneChange,reopen,image,cacheWrite,cacheRead,sourceBytes:new Blob([JSON.stringify(source)]).size,
      storageBytes:estimation.usage,diagnostic:await DB.businessCache.diagnostic() };
  },{volume,run});
}

async function main() {
  const base=await listen(server), browser=await launch();
  try {
    for (const profile of profiles) for (const volume of ['small','large'].filter(v=>wanted(v,'PERF_VOLUME'))) for (let run=0;run<rounds;run++) {
      const ctx=await browser.createBrowserContext(), page=await ctx.newPage(), errors=[];
      try {
        page.on('pageerror',e=>{errors.push(e.stack||e.message);if(process.env.PERF_DEBUG)console.error(e.stack||e.message);});
        if(process.env.PERF_DEBUG)page.on('response',r=>{if(r.status()>=400)console.error(r.status(),r.url());});
        page.on('dialog',d=>d.dismiss().catch(()=>{}));
        const cdp=await setup(page,{...profile,allowed:[base]});
        await page.evaluateOnNewDocument(theme=>localStorage.setItem('veconi-theme',theme),profile.theme);
        await page.goto(base+'/tests/performance-lab-shell.html?visual=inicio&volume='+volume,{waitUntil:'domcontentloaded',timeout:55000});

        await page.waitForFunction(()=>document.body.dataset.visualReady==='inicio',{timeout:15000,polling:200});
        const theme=await page.evaluate(()=>document.documentElement.dataset.theme);
        const cssPaths=await page.evaluate(()=>[...document.querySelectorAll('link[rel=stylesheet]')].map(sheet=>new URL(sheet.href).pathname));
        assert.equal(new Set(cssPaths).size,cssPaths.length,'A fixture duplicou uma folha de estilos');
        assert.equal(theme,profile.theme);
        for (const visit of ['first','return']) for (const route of routes) {
          const errorsBefore=errors.length, start=await metrics(cdp);
          const timedCpu=run===0&&volume==='large'&&visit==='first'&&['vender','clientes','historico','inicio','produtos','crm','relatorios'].includes(route);
          if(timedCpu){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
          const nav=await runRoute(page,route);
          const cpu=timedCpu?profiler((await cdp.send('Profiler.stop')).profile):undefined;
          const end=await metrics(cdp);
          if(route==='vender'&&nav.cards===0&&!nav.fault)nav.fault='nenhum cartao da fixture entrou no escopo';
          const values=await page.evaluate(()=>({ids:window.__fixtureLengths, long:window.__lab.long.splice(0).filter(e=>e.at>=window.__lab.routeStart)}));
          const interactions=!nav.fault&&visit==='first'&&['vender','clientes','produtos'].includes(route)?await actions(page,route):[];
          const row={...profile,volume,run,type:'route',visit,target:route,...nav,...delta(start,end),...values,interactions,cpu,errors:errors.slice(errorsBefore)};
          rows.push(row);
          if(row.fault||row.errors.length)console.log(JSON.stringify({theme,mobile:profile.mobile,volume,run,visit,route,fault:row.fault,errors:row.errors}));
        }
        if(!process.env.PERF_SKIP_STORAGE)try {
          const start=await metrics(cdp);
          const result=await persistence(page,volume,run);
          rows.push({...profile,volume,run,type:'storage',...result,...delta(start,await metrics(cdp))});
        } catch(error) { rows.push({...profile,volume,run,type:'storage',fault:error.message}); }
        console.log(JSON.stringify({volume,run,profile,counts:await page.evaluate(()=>window.__fixtureLengths)}));
        save(process.env.PERF_RUNTIME_OUTPUT||'runtime.json',rows);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close();server.close(); }
}
module.exports = { routeFixture };
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
