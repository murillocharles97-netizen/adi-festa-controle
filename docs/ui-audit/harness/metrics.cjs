// node metrics.cjs <repoRoot> <routes> [--proto file.css] -> JSON per route/width with design-consistency metrics
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),{serve}=require('./harness.cjs');
const [ROOT,ROUTES]=process.argv.slice(2),arg=n=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:null;};
const PROTO=arg('proto');
const measure=()=>{
 const app=document.querySelector('#app'),vis=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0;};
 const all=[...app.querySelectorAll('*')].filter(vis);
 const textEls=all.filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1));
 const fs=textEls.map(e=>parseFloat(getComputedStyle(e).fontSize));
 const sizes=[...new Set(fs.map(x=>Math.round(x*2)/2))].sort((a,b)=>a-b);
 const small=textEls.filter(e=>parseFloat(getComputedStyle(e).fontSize)<11).map(e=>e.textContent.trim().replace(/\s+/g,' ').slice(0,40));
 const weights=[...new Set(textEls.map(e=>getComputedStyle(e).fontWeight))].sort();
 const targets=all.filter(e=>e.matches('button,a,[role=button],select,input:not([type=hidden]),summary'));
 const tiny=targets.filter(e=>{const r=e.getBoundingClientRect();return r.height<40||r.width<40;}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().replace(/\s+/g,' ').slice(0,28)+` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
 const radii=[...new Set(all.map(e=>getComputedStyle(e).borderTopLeftRadius).filter(r=>r!=='0px'))];
 const shadows=[...new Set(all.map(e=>getComputedStyle(e).boxShadow).filter(s=>s!=='none'))];
 const colors=[...new Set(textEls.map(e=>getComputedStyle(e).color))];
 const buttons=targets.filter(e=>e.matches('button,a.btn,[role=button]'));
 const buttonStyles=[...new Set(buttons.map(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.borderTopColor!=='rgba(0, 0, 0, 0)'&&s.borderTopWidth!=='0px'?'b':'',Math.round(parseFloat(s.height)),s.borderTopLeftRadius].join('|');}))];
 return{texts:textEls.length,fontSizes:sizes,minFont:Math.min(...fs),smallTextCount:small.length,smallSamples:small.slice(0,6),fontWeights:weights,targets:targets.length,smallTargets:tiny.length,smallTargetSamples:tiny.slice(0,6),radii:radii.length,radiiValues:radii.slice(0,12),shadows:shadows.length,textColors:colors.length,buttonVariants:buttonStyles.length,pageHeight:document.documentElement.scrollHeight};
};
(async()=>{
 const server=serve(path.resolve(ROOT));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const b=await chromium.launch(),out={};
 for(const w of [390,1440]){
  const mobile=w<768,ctx=await b.newContext({viewport:{width:w,height:mobile?844:900},isMobile:mobile,hasTouch:mobile});
  await ctx.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const pg=await ctx.newPage();await pg.goto(base+'/audit.html');await pg.evaluate(()=>window.__auditReady).catch(()=>{});await pg.waitForTimeout(1200);
  await pg.evaluate(()=>{document.documentElement.classList.remove('auth-pending');document.body.classList.remove('auth-pending');try{SpaceContext.setSpaces?.([{id:'audit-space',businessId:'audit-business',name:'Loja Centro',type:'business',capabilities:{sales:true,products:true,goals:true,inventory:true}}]);}catch(e){}dispatchEvent(new Event('firebase-auth-ready'));const g=document.querySelector('#auth-gate');if(g)g.style.display='none';});
  await pg.waitForTimeout(900);
  if(PROTO)await pg.addStyleTag({url:base+'/__proto/'+path.basename(PROTO)});
  for(const r of ROUTES.split(',')){await pg.evaluate(r=>{location.hash='#/'+r;scrollTo(0,0);},r);await pg.waitForTimeout(1100);out[r+'@'+w]=await pg.evaluate(measure);}
  await ctx.close();
 }
 console.log(JSON.stringify(out,null,1));await b.close();server.close();
})();
