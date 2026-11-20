'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function fixture(){
 const dom=new JSDOM('<div id="app"></div><div id="modal"></div>',{url:'https://qa.invalid',runScripts:'outside-only'}),w=dom.window;
 w.structuredClone=structuredClone;w.Utils={toast(){}};w.BusinessContext={get:()=>({businessId:'qa-biz',role:'owner'})};
 w.eval(fs.readFileSync('js/financial-engine.js','utf8'));
 const source=fs.readFileSync('js/firebase/financial-space-service.js','utf8').replace(/import\s+[\s\S]*?from\s+"[^"]+";/g,'').replace('export { FinancialSpaceService };','');
 w.eval('const auth={currentUser:{uid:"qa-owner"}},app={},db={},getStorage=()=>({});'+source);
 const space={id:'qa-taxi',name:'Táxi QA',type:'other',businessId:'qa-biz',linkedBusinessId:null,ownerUid:'qa-owner',active:true,capabilities:{sales:true,finance:true}};
 w.dispatchEvent(new w.CustomEvent('veconi-spaces-ready',{detail:{spaces:[space]}}));
 w.FinancialSpaceService.listFinancialAccounts=async()=>[];
 // Expose the existing private modal only to the DOM test; production exports are untouched.
 w.eval(fs.readFileSync('js/financial-ui.js','utf8').replace('return { render, bind, refresh, destroy, resume, state:', 'return { openManageSpace, render, bind, refresh, destroy, resume, state:'));
 return {w,close:()=>w.close()};
}
test('manual Táxi modal activates through callable, retries same operation and undo removes the local undo action',async()=>{
 const f=fixture(),w=f.w;try{
 let calls=[],fail=true;
 w.FirebaseCallable=async(name,p)=>{calls.push({...p});assert.equal(name,'configureFinancialSpaceAutomation');if(fail){fail=false;throw Error('network');}
 return {data:{status:'confirmed',operationId:p.operationId,spaceId:p.spaceId,businessId:p.businessId,revision:p.expectedRevision+1,automation:p.revertOperationId?null:{enabled:p.enabled,linkedBusinessId:p.businessId,linkedSalesSpaceId:p.spaceId,activatedAt:'2026-11-20T15:00:00Z',autoIncome:{sales:p.sales,customerPayments:p.customerPayments,onlineOrders:p.onlineOrders}}}};};
 await w.FinanceiroUI.openManageSpace('qa-taxi');
 const form=w.document.querySelector('form');assert.match(form.textContent,/Despesas.*continuam manuais/);
 for(const name of ['enabled','sales','customerPayments'])form.elements[name].checked=true;
 await form.onsubmit({preventDefault(){}});assert.equal(w.FinancialSpaceService.automationState(w.FinancialSpaceService.listCachedSpaces()[0]).enabled,false);
 await form.onsubmit({preventDefault(){}});assert.equal(calls[0].operationId,calls[1].operationId);assert.equal(calls[1].expectedRevision,0);
 assert.equal(w.FinancialSpaceService.listCachedSpaces().length,1);assert.equal(w.FinancialSpaceService.automationState(w.FinancialSpaceService.listCachedSpaces()[0]).enabled,true);
 await w.FinanceiroUI.openManageSpace('qa-taxi');await w.document.querySelector('[data-financial-automation-revert]').onclick();
 await w.FinanceiroUI.openManageSpace('qa-taxi');assert.equal(w.document.querySelector('[data-financial-automation-revert]'),null);
 assert.equal(w.FinancialSpaceService.automationState(w.FinancialSpaceService.listCachedSpaces()[0]).enabled,false);
 }finally{f.close();}
});
test('offline activation refuses without changing cached space',async()=>{const f=fixture();try{Object.defineProperty(f.w.navigator,'onLine',{value:false});await assert.rejects(f.w.FinancialSpaceService.configureAutomation('qa-taxi',{enabled:true}),/Conecte-se/);assert.equal(f.w.FinancialSpaceService.listCachedSpaces()[0].automation,undefined);}finally{f.close();}});
