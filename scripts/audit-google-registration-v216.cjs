'use strict';
// Browser contract simulation; all external requests are intercepted or blocked.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),puppeteer=require('puppeteer');
const root=path.resolve('docs/qa/google-v216/registration-only/public'),origin='https://veconi-google-v216-lab.web.app',out='C:/Users/Murillo/.codex/visualizations/2026/10/30/v216-google-only-prod-preflight/browser';
const uid='vg216_12345678-1234-1234-1234-123456789012',types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const authStub=`window.__mock={current:null,listener:null};export const browserSessionPersistence={};export function getAuth(){return{get currentUser(){return __mock.current}}}export async function setPersistence(){}export function onAuthStateChanged(a,f){__mock.listener=f;f(null)}export async function getIdTokenResult(){return{claims:{veconi_google_v216:true,firebase:{sign_in_provider:'custom'}}}}export async function signInWithCustomToken(){__mock.current={uid:'${uid}',providerData:[]};__mock.listener(__mock.current);return{user:__mock.current}}export async function signOut(){__mock.current=null;__mock.listener(null)}`;
async function main(){fs.mkdirSync(out,{recursive:true});const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];let completeCalls=0,previewCalls=0,mode='ok',intent='signup',liveRequests=0;
 await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({})}}));
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',async req=>{try{
  const u=new URL(req.url());if(u.protocol==='data:'||u.protocol==='blob:')return req.continue();
  if(u.origin===origin){const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return req.respond({status:404,body:'not found'});if(u.pathname==='/config.json'){const cfg=JSON.parse(fs.readFileSync(file));Object.assign(cfg,{enabled:true,apiKey:'not-real',appId:'qa-only',googleClientId:'qa.apps.googleusercontent.com'});return req.respond({status:200,contentType:'application/json',body:JSON.stringify(cfg)});}return req.respond({status:200,contentType:types[path.extname(file)],body:fs.readFileSync(file)});}
  if(u.hostname==='www.gstatic.com')return req.respond({status:200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/javascript',body:u.pathname.endsWith('firebase-app.js')?'export function initializeApp(c){return c}':authStub});
  if(u.href==='https://accounts.google.com/gsi/client')return req.respond({status:200,contentType:'application/javascript',body:`window.google={accounts:{id:{initialize(c){window.__chooseGoogle=c.callback},renderButton(el){const b=document.createElement('button');b.id='choose-qa-google';b.textContent='Google QA fictício';b.onclick=()=>window.__chooseGoogle({credential:'qa-fictitious-proof'});el.append(b)}}}};`});
  if(u.hostname==='southamerica-east1-adi-festa-controle.cloudfunctions.net'){
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST'};
   if(req.method()==='OPTIONS')return req.respond({status:204,headers});
   assert.ok(['/prepareGoogleAccountAccess','/completeGoogleAccountAccess'].includes(u.pathname));assert.equal(req.method(),'POST');
   const d=JSON.parse(req.postData()).data;let result;
   if(u.pathname==='/completeGoogleAccountAccess'){completeCalls++;if(mode==='lost')return req.abort('failed');if(mode==='conflict')return req.respond({status:400,headers,contentType:'application/json',body:JSON.stringify({error:{code:'original-method-required'}})});result={uid,customToken:'qa-not-real-custom-token',companyCreated:false,accountLinking:false};}
   else if(d.step==='begin'){intent=d.intent;result={intentId:crypto.randomUUID(),nonce:'qa-nonce',csrf:'qa-csrf'};}
   else if(d.step==='status')result={confirmed:true,status:'completed'};
   else{previewCalls++;result={intent,googleEmail:'qa-person@example.test',requiresExplicitConfirmation:true,companyCreated:false,accountLinking:false};}
   return req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({data:result})});
  }
  liveRequests++;return req.abort();
 }catch{liveRequests++;await req.abort().catch(()=>{});}});
 await page.setViewport({width:1440,height:1000,deviceScaleFactor:1});await page.goto(origin,{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.getElementById('environment').textContent.includes('Projeto real'));
 assert.equal(await page.$eval('#create',b=>b.disabled),true);await page.click('#consent');
 const scenarios=[];
 for(const width of [1440,320,360,390,430,768]){await page.setViewport({width,height:844,deviceScaleFactor:1});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width===1440||width===390)await page.screenshot({path:path.join(out,'preview-'+width+'.png'),fullPage:true});scenarios.push('layout-'+width);}
 await page.setViewport({width:390,height:844,deviceScaleFactor:1});
 async function choose(button='#create'){await page.click(button);try{await page.waitForSelector('#choose-qa-google',{timeout:6000});}catch{throw Error(JSON.stringify({pickerMissing:true,completeCalls,previewCalls,mode,status:await page.$eval('#status',e=>e.textContent),errors}));}await page.click('#choose-qa-google');await page.waitForSelector('[role=dialog] input[type=checkbox]',{timeout:6000});}
 await choose();assert.equal(completeCalls,0);await page.keyboard.press('Escape');assert.equal(completeCalls,0);scenarios.push('cancel-before-explicit-consent');
 await choose();await page.click('[role=dialog] input[type=checkbox]');await page.evaluate(()=>document.querySelector('[role=dialog] .modal-footer button:last-child').click());await page.waitForFunction(()=>document.getElementById('identity').textContent.includes('vg216_'));
 assert.equal(completeCalls,1);assert.doesNotMatch(await page.$eval('main',m=>m.textContent),/Vincular|Conectar Google|senha atual/);scenarios.push('new-google-one-custom-session-no-link');
 await page.click('#logout');await page.waitForFunction(()=>document.getElementById('identity').hidden);
 mode='lost';await choose('#signin');await page.click('[role=dialog] input[type=checkbox]');await page.evaluate(()=>document.querySelector('[role=dialog] .modal-footer button:last-child').click());await page.waitForFunction(()=>!document.getElementById('check').hidden);const count=completeCalls;await page.click('#check');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Entre novamente'));assert.equal(completeCalls,count);assert.equal(await page.evaluate(()=>__mock.current),null);scenarios.push('lost-response-status-no-replay-no-false-login');
 mode='ok';await choose('#signin');await page.click('[role=dialog] input[type=checkbox]');await page.evaluate(()=>document.querySelector('[role=dialog] .modal-footer button:last-child').click());await page.waitForFunction(()=>document.getElementById('identity').textContent.includes('vg216_'));assert.equal(await page.evaluate(()=>__mock.current.uid),uid);scenarios.push('returning-google-same-uid');await page.click('#logout');
 mode='conflict';await choose();await page.click('[role=dialog] input[type=checkbox]');await page.evaluate(()=>document.querySelector('[role=dialog] .modal-footer button:last-child').click());await page.waitForFunction(()=>document.getElementById('status').textContent.includes('método usado'));assert.equal(await page.evaluate(()=>__mock.current),null);assert.equal(await page.$eval('#check',b=>b.hidden),true);scenarios.push('password-conflict-clear-no-pending-no-session');
 assert.deepEqual(errors,[]);assert.equal(liveRequests,0);const report={at:new Date().toISOString(),mode:'simulated-qa-only-no-live-network',passed:scenarios.length,scenarios,completeCalls,previewCalls,productionRequests:0,physicalAndroidPWA:false,realGoogleOAuth:false};fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}}
main().catch(e=>{console.error(JSON.stringify({failed:true,error:e.message}));process.exitCode=1;});
