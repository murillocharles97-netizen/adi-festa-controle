'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {review}=require('./helpers/prior-review-ui.cjs'),BASE='c06402d494b1e529ea7d8498f6406499873bfacf';
function check(h,key,value=true){const input=h.q(`[data-prior-attest="${key}"]`);input.checked=value;input.dispatchEvent(new h.w.Event('change'));}
for(const method of ['pix','fiado'])test(`${method}: exactly five distinct required attestations; prices appear once in final review`,async()=>{
 const h=review();try{const p=h.open(method);await h.flush();const nodes=[...h.q('#modal').querySelectorAll('[data-prior-attest]')],keys=nodes.map(n=>n.dataset.priorAttest);assert.equal(nodes.length,5);assert.equal(new Set(keys).size,5);assert.ok(keys.includes('pricesConfirmed'));assert.ok(keys.includes(method==='fiado'?'unpaid':'paymentAlreadyReceived'));assert.equal(h.q('#modal').querySelectorAll('[data-prior-originalPrices]').length,0);assert.equal(h.q('#modal').querySelectorAll('[data-prior-attest="pricesConfirmed"]').length,1);assert.ok(h.q('.prior-attest legend'));assert.equal(h.q('[data-prior-confirm]').disabled,true);for(const node of nodes)assert.ok(node.parentElement.classList.contains('prior-attest-row')&&node.nextElementSibling.tagName==='SPAN');h.q('[data-prior-close]').click();assert.equal(await p,false);
 }finally{h.close();}
});
test('four checks cannot enable confirmation; removing a check disables it again',async()=>{
 const h=review();try{h.open();await h.flush();const keys=[...h.q('#modal').querySelectorAll('[data-prior-attest]')].map(n=>n.dataset.priorAttest);keys.slice(0,4).forEach(k=>check(h,k));assert.equal(h.q('[data-prior-confirm]').disabled,true);check(h,keys[4]);assert.equal(h.q('[data-prior-confirm]').disabled,false);check(h,'pricesConfirmed',false);assert.equal(h.q('[data-prior-confirm]').disabled,true);assert.equal(h.w.PriorReviewQA.calls.length,1);
 }finally{h.close();}
});
test('label click toggles its single checkbox; touching text keeps native accessibility',async()=>{
 const h=review();try{h.open();await h.flush();const label=h.q('[data-prior-attest="goodsDelivered"]').parentElement;label.click();assert.equal(h.q('[data-prior-attest="goodsDelivered"]').checked,true);label.click();assert.equal(h.q('[data-prior-attest="goodsDelivered"]').checked,false);
 }finally{h.close();}
});
for(const method of ['pix','fiado'])test(`${method}: unchanged request and single-flight confirmation`,async()=>{
 const h=review();try{const finish=h.open(method);await h.flush();for(const input of h.q('#modal').querySelectorAll('[data-prior-attest]'))check(h,input.dataset.priorAttest);const release=h.w.PriorReviewQA.hold(),button=h.q('[data-prior-confirm]');button.click();button.click();assert.equal(button.disabled,true);release();await finish;const calls=h.w.PriorReviewQA.calls.filter(c=>c.name==='confirmPriorSale');assert.equal(calls.length,1);assert.equal(h.w.PriorReviewQA.completed(),1);for(const key of ['confirmed','pricesConfirmed','goodsDelivered','stockNotPreviouslyApplied','notPreviouslyRecorded',method==='fiado'?'unpaid':'paymentAlreadyReceived'])assert.equal(calls[0].data[key],true);assert.equal(calls[0].data.inputHash,'qa-visual-only');
 }finally{h.close();}
});
test('original-price input remains semantically independent from the final mandatory prices attestation',async()=>{
 for(const original of [false,true]){const h=review();try{h.q('[data-prior-originalPrices]').checked=original;const p=h.open();await h.flush();assert.equal(h.w.PriorReviewQA.calls[0].data.intent.items[0].originalUnitPrice,original?10:9.95);assert.equal(h.q('[data-prior-attest="pricesConfirmed"]').checked,false);h.q('[data-prior-close]').click();await p;}finally{h.close();}}
});
test('lost response reopens the preserved record for read-only status without a second commit',async()=>{
 const h=review();try{h.w.PriorReviewQA.lost(true);const first=h.open();await h.flush();for(const input of h.q('#modal').querySelectorAll('[data-prior-attest]'))check(h,input.dataset.priorAttest);h.q('[data-prior-confirm]').click();await h.flush();await h.flush();assert.match(h.q('.prior-result').textContent,/Resposta perdida/);h.q('[data-prior-close]').click();await first;const second=h.open();await h.flush();assert.equal(h.q('[data-prior-confirm]').disabled,false);assert.equal(h.q('[data-prior-confirm]').textContent,'Consultar confirmação');h.q('[data-prior-confirm]').click();await second;const calls=h.w.PriorReviewQA.calls.filter(c=>c.name==='confirmPriorSale');assert.equal(calls.length,2);assert.equal(calls[1].data.action,'status');assert.equal(calls[0].data.operationId,calls[1].data.operationId);assert.equal(h.w.PriorReviewQA.completed(),1);
 }finally{h.close();}
});
test('Escape returns safely and the focus loop remains inside review',async()=>{
 const h=review();try{const p=h.open();await h.flush();const panel=h.q('[role="dialog"]'),first=panel.querySelector('button'),last=panel.querySelector('.modal-foot [data-prior-close]');first.focus();first.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(h.w.document.activeElement,last);panel.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(await p,false);assert.equal(h.q('#modal').children.length,0);assert.equal(h.w.PriorReviewQA.calls.filter(c=>c.name==='confirmPriorSale').length,0);
 }finally{h.close();}
});
test('only final review markup changes in prior-sales.js; all commercial handlers are identical to published base',()=>{
 const trim=source=>{source=source.replaceAll('\r\n','\n');const a=source.indexOf('host.innerHTML=`'),b=source.indexOf('`;\n      const panel',a);assert.ok(a>=0&&b>a);return source.slice(0,a)+'REVIEW_MARKUP'+source.slice(b);};const before=cp.execFileSync('git',['show',BASE+':js/prior-sales.js'],{encoding:'utf8'});assert.equal(trim(fs.readFileSync('js/prior-sales.js','utf8')),trim(before));
});
test('all new CSS is scoped to final review and explicitly bounds the checkbox and label hit area',()=>{
 const before=cp.execFileSync('git',['show',BASE+':css/prior-sales.css'],{encoding:'utf8'}).replaceAll('\r\n','\n'),after=fs.readFileSync('css/prior-sales.css','utf8').replaceAll('\r\n','\n');assert.ok(after.startsWith(before));const extra=after.slice(before.length);assert.match(extra,/grid-template-columns:20px minmax\(0,1fr\)/);assert.match(extra,/width:20px;min-width:20px;max-width:20px;height:20px;min-height:20px/);assert.match(extra,/min-height:44px/);for(const match of extra.matchAll(/([^{}]+)\{/g)){const selector=match[1].replace(/\/\*[\s\S]*?\*\//g,'').trim();if(selector&&!selector.startsWith('@'))assert.ok(selector.startsWith('#modal .prior-sale-review'),selector);}
});
test('release diff is limited to final-review runtime and its reviewable support files',()=>{
 const m=JSON.parse(fs.readFileSync('releases/v226/prior-review-ui-manifest.json','utf8')),changed=cp.execFileSync('git',['diff','--name-only',BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);assert.equal(m.base,BASE);assert.equal(m.deploymentAuthorized,false);assert.deepEqual(m.runtimeFiles,['css/prior-sales.css','js/prior-sales.js']);assert.equal(m.functions.length+m.rules.length+m.indexes.length,0);for(const p of changed)assert.ok(m.runtimeFiles.concat(m.supportFiles).includes(p),p);
 for(const p of ['functions','js/firebase','js/plans.js','js/runtime-diagnostics.js','firestore.rules','firestore.prior-sales.rules','storage.rules','firestore.indexes.json','service-worker.js','js/build-info.js'])assert.equal(cp.execFileSync('git',['diff',BASE,'--',p],{encoding:'utf8'}),'',p);
});
