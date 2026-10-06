'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),puppeteer=require('puppeteer');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):/.test(process.env[key]||''))throw Error('Local emulators required; production forbidden.');
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'adi-festa-variations-test'});
const db=admin.firestore(),bid='qa-presentation-v163',email='presentation-v163@example.test',password='LocalQa123!',output=path.resolve('artifacts/presentation-v163-cloud');fs.mkdirSync(output,{recursive:true});

let diagnosticPage;
const root=process.cwd(),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 if(pathname==='/js/firebase/firebase-config.js'){
  let source=fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test');
  source=source.replace('getAuth, setPersistence','connectAuthEmulator, getAuth, setPersistence').replace('initializeFirestore, memoryLocalCache','connectFirestoreEmulator, initializeFirestore, memoryLocalCache').replace('getFunctions, httpsCallable','connectFunctionsEmulator, getFunctions, httpsCallable');
  source=source.replace('export const auth=getAuth(app);',"export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});");
  source=source.replace('export const db=initializeFirestore(app,{localCache:memoryLocalCache()});',"export const db=initializeFirestore(app,{localCache:memoryLocalCache()});connectFirestoreEmulator(db,'127.0.0.1',8080);");
  source=source.replace("export const functions=getFunctions(app,'southamerica-east1');","export const functions=getFunctions(app,'southamerica-east1');connectFunctionsEmulator(functions,'127.0.0.1',5001);");return res.end(source);
 }
 if(pathname==='/js/firebase/sync.js')return res.end(fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test'));fs.createReadStream(file).pipe(res);
});

async function seed(){
 const user=await admin.auth().createUser({email,password}),uid=user.uid;
 const rows={
  ['users/'+uid]:{uid,email,name:'Owner QA',businessId:bid,active:true,role:'owner',tutorialVersions:{appIntro:1},tutorialVersionSeen:999},
  ['businesses/'+bid]:{id:bid,ownerId:uid,name:'Presentation QA',active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}},
  ['businesses/'+bid+'/members/'+uid]:{uid,email,name:'Owner QA',status:'active',role:'owner',spaceAccess:'all',allowedSpaceIds:[],schemaVersion:1,permissions:require('../functions/src/services/team-access-service').ROLE_PRESETS.owner},
  ['businesses/'+bid+'/settings/default']:{id:'default',nome:'Presentation QA',businessId:bid,updatedAt:admin.firestore.Timestamp.now(),operation:{operationMode:'physical_store',creditMode:'enabled',operationOnboardingCompleted:true,modules:{inventory:true,crm:true,creditSales:true}}},
  'financialSpaces/qa-presentation-space':{id:'qa-presentation-space',name:'Loja QA',type:'business',operationalType:'unit',businessId:bid,linkedBusinessId:bid,ownerUid:uid,active:true,status:'active',globalSpaceSchemaVersion:1,capabilities:{finance:true,sales:true,inventory:true}},
 };
 for(const [id,institution,institutionKey]of [['inter','Banco Inter','banco_inter'],['c6','C6 Bank','c6_bank'],['nubank','Nubank','nubank'],['carrefour','Banco Carrefour','banco_carrefour']]){
  const space='qa-presentation-space',common={id,financialSpaceId:space,ownerUid:uid,createdBy:uid,name:institution,institution,institutionKey,operationId:'qa-'+id,active:true,accessMode:'all_spaces',allowedFinancialSpaceIds:[],defaultFinancialSpaceId:space,schemaVersion:5};
  if(id==='inter')rows['financialSpaces/'+space+'/financialAccounts/'+id]={...common,type:'bank_account',accountHomeSpaceId:space,initialBalanceCents:862,currentBalanceCents:862,includeInAvailableBalance:true};
  rows['financialSpaces/'+space+'/creditCards/'+id]={...common,cardHomeSpaceId:space,last4:id==='inter'?'0937':'4521',limitCents:500000,committedCents:360000,closingDay:25,dueDay:5,schemaVersion:3};
 }
 const batch=db.batch();for(const [p,v]of Object.entries(rows))batch.set(db.doc(p),v);await batch.commit();
 return uid;
}
async function main(){
 await seed();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),errors=[];
 const url='http://127.0.0.1:'+server.address().port;
 async function authorize(page){
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{const u=new URL(r.url());if(/googleapis\.com|cloudfunctions\.net|\.run\.app/.test(u.hostname)&&u.hostname!=='fonts.googleapis.com')return r.abort();r.continue();});
  await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForSelector('#login-form');
  await page.type('[name=email]',email);await page.type('[name=password]',password);await page.click('#login-submit');
  await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden,{timeout:60000,polling:100});
  await new Promise(r=>setTimeout(r,1500));
  await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden&&!document.documentElement.classList.contains('auth-pending'),{timeout:60000,polling:100});
  await page.evaluate(()=>SyncFirebase.synchronizeNow());
  if(await page.$('.operation-flow [data-operation-next]')){await page.click('.operation-flow [data-operation-next]');await page.click('.operation-flow [data-operation-next]');}
  await finance(page);
 }
 async function finance(page){
  await page.evaluate(()=>{document.querySelector('#modal').innerHTML='';Router.ir('financeiro');});
  await page.waitForSelector('[data-vac-customize]',{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.vac-slide.is-active')&&document.querySelector('#auth-gate')?.hidden&&!document.documentElement.classList.contains('auth-pending'),{polling:100,timeout:60000});
  await new Promise(r=>setTimeout(r,1500));
  if(await page.$('.operation-flow [data-operation-next]')){await page.click('.operation-flow [data-operation-next]');await page.click('.operation-flow [data-operation-next]');await page.evaluate(()=>Router.ir('financeiro'));await page.waitForSelector('[data-vac-customize]');}
 }
 try{
  const page=await browser.newPage();diagnosticPage=page;await authorize(page);
  const original=(await db.doc('financialSpaces/qa-presentation-space/financialAccounts/inter').get()).data();
  await page.locator('[data-vac-customize]').click();await page.type('[name=displayName]','Inter Principal');await page.type('[data-nickname="0"]','Inter Pessoal');await page.click('[data-color="#c64e00"]');
  await page.click('[data-appearance-form] [type=submit]');await page.waitForFunction(()=>!document.querySelector('[data-appearance-form]'),{timeout:30000,polling:100});
  const after=(await db.doc('financialSpaces/qa-presentation-space/financialAccounts/inter').get()).data();
  assert.equal(after.presentation.displayName,'Inter Principal');for(const k of Object.keys(original))assert.deepEqual(after[k],original[k]);
  const savedCard=(await db.doc('financialSpaces/qa-presentation-space/creditCards/inter').get()).data();assert.equal(savedCard.presentation.cardNickname,'Inter Pessoal');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden,{polling:100,timeout:60000});await finance(page);
  assert.equal(await page.$eval('.vac-slide.is-active h3',e=>e.textContent),'Inter Principal');
  await page.screenshot({path:path.join(output,'1440-inter-real-app.png'),fullPage:true});
  await page.click('[data-vac-customize]');await page.select('[name=institution]','c6');await page.type('[name=displayName]','C6 Black');await page.click('[data-color="#242424"]');
  await page.click('[data-appearance-form] [type=submit]');await page.waitForFunction(()=>!document.querySelector('[data-appearance-form]'),{polling:100});
  const second=await browser.createBrowserContext(),device=await second.newPage();await authorize(device);
  assert.equal(await device.$eval('.vac-slide.is-active h3',e=>e.textContent),'Inter Principal');
  await device.evaluate(()=>{const index=document.querySelector('[data-carousel-key="c6"]').dataset.logicalIndex;document.querySelector('[data-vac-page="'+index+'"]').click();});await new Promise(r=>setTimeout(r,500));
  assert.equal(await device.$eval('.vac-slide.is-active h3',e=>e.textContent),'C6 Black');
  await device.screenshot({path:path.join(output,'1440-c6-real-app.png'),fullPage:true});
  for(const width of [320,360,375,390,412,430]){
   await device.setViewport({width,height:900});await new Promise(r=>setTimeout(r,400));
   const peeks=await device.$eval('.vac-slide.is-active',e=>{const section=e.closest('.financial-home-institutions').getBoundingClientRect();return [e.previousElementSibling,e.nextElementSibling].map(s=>{const r=s.querySelector('.vac-card').getBoundingClientRect();return Math.min(section.right,r.right)-Math.max(section.left,r.left);});});assert.ok(peeks.every(x=>x>=8),JSON.stringify({width,peeks}));
   await device.click('[data-vac-customize]');
   await device.waitForSelector('[data-appearance-form]');
   await new Promise(r=>setTimeout(r,450));
   assert.ok(await device.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const fit=await device.$eval('.vac-appearance-sheet',el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.height<=innerHeight;});assert.ok(fit);
   if(width===390)await device.screenshot({path:path.join(output,'390-modal-real-app.png')});
   await device.click('[data-appearance-form] [data-financial-close]');
   if(width===390)await device.screenshot({path:path.join(output,'390-carousel-real-app.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,actualService:true,actualRules:true,cloudPersistence:true,reload:true,secondDevice:true,financialFieldsUnchanged:true,mobileModalWidths:[320,360,375,390,412,430],productionWrites:0}));
 }catch(e){if(diagnosticPage)await diagnosticPage.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw e;}
 finally{await browser.close();server.close();await admin.app().delete();}
}
main().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
