// Uso: node docs/ui-audit/harness/shoot.cjs <repo> <saida> inicio,vender,produtos [--proto p1-inicio.css] [--widths 390,1440]
// node shoot.cjs <repoRoot> <outDir> <routes,comma> [--proto file.css] [--widths 390,1440] [--full]
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{serve}=require('./harness.cjs');
const [ROOT,OUT,ROUTES]=process.argv.slice(2),arg=n=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:null;};
const PROTO=arg('proto'),WIDTHS=(arg('widths')||'390,1440').split(',').map(Number),FULL=process.argv.includes('--full'),DSF=Number(process.env.DSF||2);
(async()=>{
 const server=serve(path.resolve(ROOT));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const b=await chromium.launch();fs.mkdirSync(OUT,{recursive:true});const report=[];
 for(const w of WIDTHS){
  const mobile=w<768,ctx=await b.newContext({viewport:{width:w,height:mobile?844:900},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:DSF});
  await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const pg=await ctx.newPage();await pg.goto(base+'/audit.html');
  await pg.evaluate(()=>window.__auditReady).catch(()=>{});await pg.waitForTimeout(1200);
  await pg.evaluate(()=>{document.documentElement.classList.remove('auth-pending');document.body.classList.remove('auth-pending');
   try{SpaceContext.setSpaces?.([{id:'audit-space',businessId:'audit-business',name:'Loja Centro',type:'business',capabilities:{sales:true,products:true,goals:true,inventory:true}}]);}catch(e){}
   dispatchEvent(new Event('firebase-auth-ready'));const g=document.querySelector('#auth-gate');if(g)g.style.display='none';});
  await pg.waitForTimeout(900);
  if(process.env.HIDE_TOASTS)await pg.addStyleTag({content:'#toasts{display:none!important}'});
  if(PROTO)await pg.addStyleTag({url:base+'/__proto/'+path.basename(PROTO)});
  for(const route of ROUTES.split(',')){
   const [spec,action]=route.split(':'),[name,scroll]=spec.split('@');
   await pg.evaluate(r=>{const m=document.querySelector('#modal');if(m)m.innerHTML='';window.__auditErrors.length=0;try{location.hash='#/'+r;}catch(e){__auditErrors.push('route:'+e.message);}scrollTo(0,0);},name);
   await pg.waitForTimeout(1100);
   if(action)await pg.evaluate(a=>{try{(new Function(a))();}catch(e){__auditErrors.push('action:'+e.message);}},decodeURIComponent(action));
   if(action)await pg.waitForTimeout(700);
   if(scroll){await pg.evaluate(y=>scrollTo(0,Number(y)),scroll);await pg.waitForTimeout(250);}
   const info=await pg.evaluate(()=>{const app=document.querySelector('#app');return{route:(window.Router?.atual?.())||location.hash,textLen:app?.innerText.trim().length||0,overflow:document.documentElement.scrollWidth-innerWidth,height:document.documentElement.scrollHeight,errors:[...new Set(__auditErrors)].slice(0,3),empty:/indispon[ií]vel/i.test(app?.innerText||'')};});
   const file=`${OUT}/${name}${scroll?'@'+scroll:''}${action?'-'+(arg('tag')||'action'):''}-${w}.png`;
   await pg.screenshot({path:file,fullPage:FULL});report.push({file:path.basename(file),w,...info});
   console.log(w,name,JSON.stringify(info));
  }
  await ctx.close();
 }
 fs.writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,1));
 await b.close();server.close();
})();
