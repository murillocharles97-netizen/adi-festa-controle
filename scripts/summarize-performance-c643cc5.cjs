'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { out } = require('./performance-lab-helpers.cjs');

function input(file) {
  const name=path.join(out,file);
  return fs.existsSync(name)?JSON.parse(fs.readFileSync(name,'utf8')):[];
}
function values(rows,get) {
  return rows.map(get).filter(Number.isFinite).sort((a,b)=>a-b);
}
function stat(numbers) {
  const n=numbers.length;
  if(!n)return '—';
  const median=(numbers[Math.floor((n-1)/2)]+numbers[Math.floor(n/2)])/2;
  return [median,numbers[0],numbers[n-1]].map(x=>Math.round(x)).join('/');
}
function table(title, headers, rows) {
  console.log('\n## '+title+'\n');
  for(const row of [headers,headers.map(()=> '---'),...rows])console.log('| '+row.join(' | ')+' |');
}
function group(rows,key) {
  const index=new Map();
  for(const row of rows) {
    const k=key(row);
    if(!index.has(k))index.set(k,[]);
    index.get(k).push(row);
  }
  return [...index];
}
const profile=r=>(r.mobile?'Mobile':'Desktop')+' '+(r.theme==='dark'?'escuro':'claro');
const byProfile=['light','dark'].flatMap(t=>input('startup-mobile-'+t+'.json'));
const largeReopen=input('startup-large-reopen.json');
const startup=[...input('startup.json').filter(r=>!r.mobile||!byProfile.some(x=>x.theme===r.theme)),...byProfile,
  ...(largeReopen.length?largeReopen:input('startup-large.json'))];
const runtime=input('runtime.json');
console.log('# VECONI V242.1 — Tabelas de referência\n');
console.log('Todos os intervalos usam mediana/mínimo/máximo. Tempos em ms, salvo onde indicado. Pequeno e grande referem-se à fixture de navegação. A tabela de abertura informa a quantidade de produtos no emulador.');
const ok=rows=>rows.filter(r=>!r.fault);
const v=(rows,get)=>stat(values(rows,get));
const countLong=rows=>rows?.length;
table('Abertura, rede e sincronização', ['Perfil','Produtos','Etapa','n válido/total','ms med/mín/máx','FCP ms','Recursos','Transfer. kB','JS ms','Estilo+layout ms','Heap MB','Req. Auth/FS','Operações FS acumuladas','Docs FS acumulados','Pico listener FS','Tarefas longas acumuladas','Estado final'],group(startup,r=>profile(r)+'|'+(r.products||25)+'|'+r.phase).map(([key,rows])=>{
  const valid=ok(rows);
  return [...key.split('|'),valid.length+'/'+rows.length,v(valid,r=>r.elapsedMs),v(valid,r=>r.fcpMs),v(valid,r=>r.resources),v(valid,r=>r.transferBytes/1000),v(valid,r=>r.ScriptDurationMs),
    v(valid,r=>r.RecalcStyleDurationMs+r.LayoutDurationMs),v(valid,r=>r.heapUsedMB),
    v(valid,r=>r.network.length),v(valid,r=>r.usage?.queries),v(valid,r=>r.usage?.reads),v(valid,r=>r.usage?.peakListeners),v(valid,r=>countLong(r.longTasks)),[...new Set(rows.map(r=>r.bootstrap??'sem estado'))].join(', ')];
}));
table('Navegação local', ['Rota','Perfil','Pequeno 1ª','Pequeno retorno','Grande 1ª','Grande retorno','DOM grande 1ª','Heap grande MB','Listeners DOM','JS grande 1ª','Estilo+layout grande 1ª','Tarefas ≥50 ms (grande 1ª)','n grande 1ª'],group(runtime.filter(r=>r.type==='route'),r=>r.target+'|'+profile(r)).map(([key,rows])=>{
  const choose=(size,visit)=>ok(rows.filter(r=>r.volume===size&&r.visit===visit));
  const large=choose('large','first');
  return [...key.split('|'),v(choose('small','first'),r=>r.total),v(choose('small','return'),r=>r.total),v(large,r=>r.total),
    v(choose('large','return'),r=>r.total),v(large,r=>r.nodes),v(large,r=>r.heapUsedMB),v(large,r=>r.domListeners),v(large,r=>r.ScriptDurationMs),
    v(large,r=>r.RecalcStyleDurationMs+r.LayoutDurationMs),v(large,r=>countLong(r.long)),large.length];
}));
const interactions=runtime.flatMap(r=>(r.interactions||[]).filter(x=>x.name!=='venda-checagem').map(i=>({...i,mobile:r.mobile,theme:r.theme,volume:r.volume})));
table('Interações locais', ['Ação','Perfil','Volume','ms med/mín/máx','n válido/total','Falhas'],group(interactions,r=>r.name+'|'+profile(r)+'|'+r.volume).map(([key,rows])=>
  [...key.split('|'),v(ok(rows),r=>r.ms),ok(rows).length+'/'+rows.length,[...new Set(rows.map(r=>r.fault).filter(Boolean))].join(', ')||'—']));
table('IndexedDB e imagens', ['Perfil','Volume','n','Gravar base ms','Alterar 1 ms','Reabrir ms','Processar JPEG ms','Gravar Cache Storage ms','Ler 1 imagem ms','Linhas','Itens IDB alterados'],group(runtime.filter(r=>r.type==='storage'),r=>profile(r)+'|'+r.volume).map(([key,rows])=>{
  const valid=ok(rows);
  return [...key.split('|'),valid.length,v(valid,r=>r.initial.ms),v(valid,r=>r.oneChange.ms),v(valid,r=>r.reopen.ms),
    v(valid,r=>r.image.ms),v(valid,r=>r.cacheWrite.ms),v(valid,r=>r.cacheRead.ms),v(valid,r=>r.diagnostic.records),v(valid,r=>r.oneChange.result.written)];
}));
table('Falhas de execução ou observação', ['Origem','Perfil','Caso','Ocorrências','Erro'],group([...startup,...runtime].flatMap(r=>[...(r.fault?[r.fault]:[]),...new Set(r.errors||[])].map(e=>({...r,error:e.split('\n')[0]}))),
 r=>(r.phase?'PWA':'Fixture')+'|'+profile(r)+'|'+(r.phase||[r.target||r.type,r.volume,r.visit].filter(Boolean).join(' '))+'|'+r.error).map(([key,rows])=>{
  const [origin,device,operation,error]=key.split('|');
  return [origin,device,operation,rows.length,error.replace(/\|/g,'/')];
}));

const checkoutDesktop=input('checkout-desktop.json');
const checkout=[...input('checkout.json').filter(r=>r.mobile||!checkoutDesktop.length),...checkoutDesktop];
if(checkout.length){
 const data=checkout.flatMap(r=>r.timed.map(x=>({...x,mobile:r.mobile,fault:r.fault})));
 table('Checkout e relatório em Firestore Emulator', ['Perfil','Operação','ms med/mín/máx','n válido/total'],group(data,r=>(r.mobile?'Mobile':'Desktop')+'|'+r.name).map(([key,rows])=>[...key.split('|'),v(ok(rows),r=>r.ms),ok(rows).length+'/'+rows.length]));
 if(checkout.some(r=>r.fault))console.log('\nContextos do checkout interrompidos: '+checkout.filter(r=>r.fault).map(r=>(r.mobile?'Mobile':'Desktop')+' '+r.run+' '+r.fault.split('\n')[0]).join(' | '));
}

table('Movimento no Início mobile', ['Preferência','n','Animações iniciadas','Recálculo de estilos ms após a montagem'],group(input('motion.json'),r=>r.motion).map(([key,rows])=>
 [key,rows.length,v(rows,r=>r.animationEvents.length),v(rows,r=>r.RecalcStyleDurationMs)]));
