'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const {JSDOM}=require('jsdom');
const {mercadoPagoService,normalizeDeviceSessionId}=require('../functions/src/services/mercado-pago-service');
const device='armor.'+'a'.repeat(225),plan={id:'premium',name:'Pro',amount:119.9,currency:'BRL'},billing={amount:119.9};
test('official SDK opaque punctuation is retained byte-for-byte; unsafe headers remain rejected',()=>{
 assert.equal(device.length,231);assert.equal(normalizeDeviceSessionId(device),device);
 for(const x of ['bad id','validid\r\nInjected:1','a'.repeat(2049),{},123,'não-ascii'])assert.throws(()=>normalizeDeviceSessionId(x));
 assert.equal(normalizeDeviceSessionId(null),null);
});
test('Orders HTTP contract rejects former notification_url, accepts Pix and preserves monetary/idempotency fields',async()=>{
 const requests=[],server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);requests.push({data,method:req.method,headers:req.headers});res.setHeader('Content-Type','application/json');if('notification_url' in data){res.writeHead(400);res.end(JSON.stringify({errors:[{code:'unsupported_properties',message:'Properties not supported'}]}));return;}assert.equal(data.total_amount,'119.90');assert.equal(data.transactions.payments[0].amount,'119.90');assert.equal(data.type,'online');res.writeHead(201);res.end(JSON.stringify({id:'qa_order',status:'action_required'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const adapter=(url,opts)=>{assert.equal(new URL(url).host,'api.mercadopago.com');return fetch(origin+new URL(url).pathname,opts);};
  const old=require('./fixtures/billing-orders-before-v225.cjs').mercadoPagoService({accessToken:'qa-local-only',fetchImpl:adapter}),next=mercadoPagoService({accessToken:'qa-local-only',fetchImpl:adapter}),input={businessId:'qa-company',email:'qa@example.invalid',plan,billing,operationId:'qa-original-operation',notificationUrl:'https://example.invalid/webhook'};
  await assert.rejects(old.createPixOrder(input),e=>e.status===400);
  const result=await next.createPixOrder(input);assert.equal(result.id,'qa_order');assert.equal(requests.length,2);assert.equal(requests[0].headers['x-idempotency-key'],requests[1].headers['x-idempotency-key']);assert.equal('notification_url' in requests[1].data,false);
 }finally{await new Promise(r=>server.close(r));}
});
test('monthly card requires SDK device, keeps antifraud/3DS and sends exact opaque value only in header',async()=>{
 let captured;const service=mercadoPagoService({accessToken:'qa',fetchImpl:async(u,o)=>{captured=o;return new Response(JSON.stringify({id:'qa-card'}),{status:201})}}),input={businessId:'qa-company',email:'qa@example.invalid',plan,billing,operationId:'qa-card-operation',payment:{token:'synthetic_card_token',paymentMethodId:'visa',installments:1}};
 assert.throws(()=>service.createCardOrder(input),e=>e.code==='device-session-required');assert.equal(captured,undefined);
 await service.createCardOrder({...input,deviceSessionId:device,notificationUrl:'https://example.invalid/webhook'});
 const body=JSON.parse(captured.body);assert.equal(captured.headers['X-meli-session-id'],device);assert.doesNotMatch(captured.body,/armor\./);assert.equal('notification_url' in body,false);assert.deepEqual(body.config.online.transaction_security,{validation:'on_fraud_risk',liability_shift:'required'});
});
test('provider search uses only exact business-operation reference, bounded dates and GET',async()=>{
 let call;const s=mercadoPagoService({accessToken:'qa',fetchImpl:async(u,o)=>{call={u,o};return new Response(JSON.stringify({data:[],paging:{total:0}}))}}),ref='billing_'+'a'.repeat(56);
 await s.searchOrders({externalReference:ref,beginDate:'2026-11-01T00:00:00Z',endDate:'2026-11-02T12:00:00Z'});assert.equal(call.o.method,'GET');assert.equal(new URL(call.u).searchParams.get('external_reference'),ref);
});
function deviceHelper(window){const s=fs.readFileSync('js/plans.js','utf8'),c={window,Error,Promise,setTimeout:(f,ms)=>setTimeout(f,ms>=8000?10:1),clearTimeout,loadScript:async()=>{}};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('  async function mercadoPagoDeviceId('),s.indexOf('  async function mercadoPagoBrick(')),c);return c;}
test('frontend obtains official global without inventing, truncating or coercing identifiers',async()=>{
 const h=deviceHelper({MP_DEVICE_SESSION_ID:device});assert.equal(await h.mercadoPagoDeviceId({required:true}),device);h.window.MP_DEVICE_SESSION_ID={value:device};await assert.rejects(h.mercadoPagoDeviceId({required:true}));
 h.window.MP_DEVICE_SESSION_ID='';await assert.rejects(h.mercadoPagoDeviceId({required:true}),/não foi concluída/);h.window.MP_DEVICE_SESSION_ID=device;assert.equal(await h.mercadoPagoDeviceId({required:true}),device);
});
test('a business switch during catalog verification prevents a commercial request',async()=>{
 const source=fs.readFileSync('js/firebase/business-context.js','utf8'),a=source.indexOf('requestUpgrade:async('),b=source.indexOf(',watchPixCheckout:',a),state={businessId:'qa-A',userProfile:{uid:'qa-owner'},role:'owner',loading:false,error:null},calls=[];let release;
 const c={state,auth:{currentUser:{uid:'qa-owner'}},JSON,Error,Catalog:{version:2,legacyState:()=>({legacy:true})},window:{FirebaseCallable:async(...v)=>{calls.push(v);return{data:{}}}},SubscriptionService:{getBillingCheckoutConfig:()=>new Promise(r=>release=r)}};vm.createContext(c);const fn=vm.runInContext('({'+source.slice(a,b)+'}).requestUpgrade',c),pending=fn('premium',{});state.businessId='qa-B';release({catalogVersion:2});await assert.rejects(pending,/empresa mudou/);assert.equal(calls.length,0);
});
function manage(){
 const d=new JSDOM('<div id="modal"></div>',{url:'http://127.0.0.1/qa',runScripts:'outside-only'}),w=d.window,calls=[];let session='qa-A',confirm=true;
 w.TeamAccess={captureSession:()=>session};w.BusinessContext={get:()=>({businessId:session})};w.SubscriptionService={getBillingCheckoutConfig:async()=>({migrationReservation:{requiresVerification:true,operationId:'qa-original-operation'}})};w.FirebaseCallable=async(name,data)=>{calls.push({name,data});return{data:{status:'reservation_released'}}};w.confirm=()=>confirm;
 const source=fs.readFileSync('js/plans.js','utf8'),a=source.indexOf('  function manageSubscription()'),b=source.indexOf('\n  ',source.indexOf('\n  }',a)+5);let depth=0,from=source.indexOf('{',a),end=from;for(;end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}'&&--depth===0)break;}
 // Extract through the next declaration; template literal braces are balanced here.
 const next=source.indexOf('  async function ',a+5),syncNext=source.indexOf('  function ',a+5),stop=Math.min(...[next,syncNext].filter(n=>n>a));
 const c={window:w,document:w.document,context:()=>({businessId:'qa-A',subscription:{},status:'pending'}),$: (s,r=w.document)=>r.querySelector(s),$$:(s,r=w.document)=>[...r.querySelectorAll(s)],esc:String,icon:()=>'',runSubscriptionAction(){},confirmCancellation(){},openPaymentMethodModal(){},changePendingPayerEmail(){}};vm.createContext(c);vm.runInContext(source.slice(a,stop),c);c.manageSubscription();
 return{w,calls,ready:()=>new Promise(setImmediate),setConfirm:x=>confirm=x,setSession:x=>session=x,close:()=>w.close()};
}
test('recovery UI requires a separate confirmation and never sends plan/payment creation data',async()=>{
 const h=manage();try{await h.ready();const b=h.w.document.querySelector('[data-recover-migration]');assert.ok(b);h.setConfirm(false);b.click();await h.ready();assert.equal(h.calls.length,0);h.setConfirm(true);b.click();b.click();await h.ready();assert.equal(h.calls.length,1);assert.equal(h.calls[0].data.action,'recover_failed_migration');assert.equal(h.calls[0].data.companyId,'qa-A');assert.equal(h.calls[0].data.planId,undefined);assert.match(h.w.document.body.textContent,/Nenhuma cobrança foi criada/);assert.equal(b.disabled,true);}finally{h.close();}
});
test('recovery UI restores its button and displays server error inline',async()=>{
 const h=manage();try{await h.ready();h.w.FirebaseCallable=async()=>{throw Error('Comprovação técnica necessária')};h.w.document.querySelector('[data-recover-migration]').click();await h.ready();assert.equal(h.w.document.querySelector('[data-recover-migration]').disabled,false);assert.match(h.w.document.querySelector('[role=alert]').textContent,/Comprovação/);}finally{h.close();}
});
function monthly(){
 const d=new JSDOM('<div id="modal"></div>',{url:'http://127.0.0.1/qa',runScripts:'outside-only'}),w=d.window;let session='qa-A',release,settings,creates=0,payments=0,toasts=0;
 w.TeamAccess={captureSession:()=>session};w.SubscriptionService={getBillingCheckoutConfig:()=>new Promise(r=>release=r),requestUpgrade:async()=>{payments++;return{card:{status:'payment_pending'}}}};w.Utils={toast:()=>toasts++};
 const source=fs.readFileSync('js/plans.js','utf8'),a=source.indexOf('  async function openMonthlyCardModal('),b=source.indexOf('  function openPaymentMethodModal(',a),c={window:w,document:w.document,console,Error,Promise,$:(s,r=w.document)=>r.querySelector(s),esc:String,icon:()=>'',money:n=>'R$ '+n,destroyCardBrick:async()=>{},newCheckoutOperationId:()=> 'qa-stable-operation',mercadoPagoDeviceId:async()=>device,mercadoPagoBrick:async()=>({create:async(_type,_id,v)=>{creates++;settings=v;return{unmount:async()=>{}}}}),openCardStatusModal(){},cardBrickController:null};vm.createContext(c);vm.runInContext(source.slice(a,b),c);
 return{w,c,flush:()=>new Promise(setImmediate),release:()=>release({publicKey:'qa'}),change:()=>{session='qa-B';w.document.querySelector('#modal').innerHTML='<p data-new-session>New session</p>';},stats:()=>({creates,payments,toasts}),settings:()=>settings,close:()=>w.close()};
}
test('late card initialization never replaces the new account modal or creates a Brick',async()=>{const h=monthly();try{const p=h.c.openMonthlyCardModal({plan:{id:'premium',name:'Pro',monthlyPrice:119.9},billingCycle:'monthly'});await h.flush();h.change();h.release();await p;assert.deepEqual(h.stats(),{creates:0,payments:0,toasts:0});assert.ok(h.w.document.querySelector('[data-new-session]'));}finally{h.close();}});
test('retired card callbacks cannot initiate a payment or alter the new account UI',async()=>{const h=monthly();try{const p=h.c.openMonthlyCardModal({plan:{id:'premium',name:'Pro',monthlyPrice:119.9},billingCycle:'monthly'});await h.flush();h.release();await p;assert.equal(h.stats().creates,1);h.change();await assert.rejects(h.settings().callbacks.onSubmit({token:'qa-discardable'}),/empresa mudou/);assert.equal(h.stats().payments,0);assert.equal(h.stats().toasts,0);assert.ok(h.w.document.querySelector('[data-new-session]'));}finally{h.close();}});
test('late approved card under review is not called declined and does not offer a second charge',()=>{const source=fs.readFileSync('js/plans.js','utf8'),a=source.indexOf('  function cardStatusView('),b=source.indexOf('  function openCardStatusModal(',a),c={icon:()=>'',esc:String,money:String};vm.createContext(c);vm.runInContext(source.slice(a,b),c);const html=c.cardStatusView({status:'payment_review_required'},{name:'Pro'},'monthly',null);assert.match(html,/Pagamento em conferência/);assert.doesNotMatch(html,/não aprovado|data-card-retry-monthly|data-card-fallback-pix/);});
test('compatible frontend rollback blocks new checkout before any config or payment request',async()=>{const source=fs.readFileSync('js/firebase/business-context.js','utf8'),a=source.indexOf('requestUpgrade:async('),b=source.indexOf(',watchPixCheckout:',a),c={window:{AdiFestaBuild:{billingCheckoutPaused:true}},Error};vm.createContext(c);const fn=vm.runInContext('({'+source.slice(a,b)+'}).requestUpgrade',c);await assert.rejects(fn('premium',{}),/temporariamente pausadas/);});
