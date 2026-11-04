'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),{JSDOM}=require('jsdom');
const BASE='e83635c0fee645ffeaf1a4dea9c6480cc153a2f9',PUBLISHED='5957fb9b1e78481f940f58766e17257cc1b0336f';
const read=(file,ref)=>ref?cp.execFileSync('git',['show',ref+':'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
function runtime({ref,width=390}={}){
  const dom=new JSDOM('<main id="app"></main><div id="modal"></div>',{url:'http://127.0.0.1/qa',runScripts:'outside-only'}),w=dom.window;
  let closed=false;w.structuredClone=structuredClone;w.matchMedia=q=>({matches:/max-width/.test(q)?width<=767:/min-width/.test(q)?width>=768:false,addEventListener(){}});w.scrollTo=()=>{};w.confirm=()=>true;w.CSS={escape:x=>x};w.queueMicrotask=fn=>queueMicrotask(()=>{if(!closed)fn();});
  w.eval(read('tests/fixtures/v226-ui-regression.js'));
  for(const file of w.V226UIQA.sourceScripts){if(ref===BASE&&/prior-sale/.test(file))continue;w.eval(read(file,ref));}
  w.SpaceContext.setSpaces(w.V226UIQA.spaces);w.SpaceContext.selectSales('qa-a');
  return{w,q:s=>w.document.querySelector(s),render:r=>w.V226UIQA.render(r),flush:()=>new Promise(setImmediate),close(){closed=true;w.PerformanceAccess?.invalidate();w.close();}};
}
module.exports={BASE,PUBLISHED,read,runtime};
