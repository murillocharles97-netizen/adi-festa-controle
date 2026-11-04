'use strict';
const fs=require('node:fs'),{JSDOM}=require('jsdom');
function review(){
 const dom=new JSDOM('<main><div class="prior-sale-entry" data-prior-entry></div><button id="open-sale-summary">Abrir carrinho fictício</button><button id="finish-sale">Revisar venda</button></main><div id="modal"></div>',{url:'http://127.0.0.1/review-qa',runScripts:'outside-only'}),w=dom.window;
 w.structuredClone=structuredClone;
 for(const p of ['functions/src/shared/prior-sale-policy.js','tests/fixtures/prior-review-ui.js','js/prior-sales.js'])w.eval(fs.readFileSync(p,'utf8'));
 w.PriorReviewQA.setup();return{w,q:s=>w.document.querySelector(s),open:m=>w.PriorReviewQA.open(m),flush:()=>new Promise(setImmediate),close:()=>w.close()};
}
module.exports={review};
