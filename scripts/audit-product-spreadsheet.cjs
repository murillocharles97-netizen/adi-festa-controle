'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):/.test(process.env[key]||''))throw Error('Local emulators required. Production forbidden.');
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'adi-festa-variations-test'});
const db=admin.firestore(),bid='qa-product-sheet',email='product-sheet@example.test',password='LocalQa123!',space='qa-sheet-space';
const root=process.cwd(),output=path.resolve('artifacts/product-spreadsheet'),pause=ms=>new Promise(r=>setTimeout(r,ms));fs.mkdirSync(output,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
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
 if(pathname==='/js/firebase/sync.js')return res.end(fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test'));
 fs.createReadStream(file).pipe(res);
});
async function seed(){
 const {uid}=await admin.auth().createUser({email,password});
 const rows={
  ['users/'+uid]:{uid,email,name:'Owner QA',businessId:bid,active:true,role:'owner',tutorialVersions:{appIntro:1},tutorialVersionSeen:999},
  ['businesses/'+bid]:{id:bid,ownerId:uid,name:'Produtos QA',active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}},
  ['businesses/'+bid+'/members/'+uid]:{uid,email,name:'Owner QA',status:'active',role:'owner',spaceAccess:'all',allowedSpaceIds:[],schemaVersion:1,permissions:require('../functions/src/services/team-access-service').ROLE_PRESETS.owner},
  ['businesses/'+bid+'/settings/default']:{id:'default',nome:'Produtos QA',businessId:bid,onboardingCompleted:true,demonstracaoRemovida:true},
 };
 for(const id of [space,'qa-other-space'])rows['financialSpaces/'+id]={id,name:id===space?'Loja QA':'Outro espaço',type:'business',businessId:bid,linkedBusinessId:bid,ownerUid:uid,active:true,operationalType:'unit',capabilities:{finance:true,sales:true,products:true,inventory:true,goals:true}};
 for(let i=0;i<8;i++){
  const id='qa-product-'+i;
  rows[`businesses/${bid}/products/${id}`]={id,businessId:bid,nome:'Produto '+i,codigo:'00'+i,barcode:'00000000000'+i,categoria:'QA',preco:15,estoqueAtual:5,estoque:5,ativo:true,controlaEstoque:true,semControleEstoque:false,itemKind:'product',productType:'simple',spaceAccessMode:'single_space',allowedSpaceIds:[i===7?'qa-other-space':space],defaultSpaceId:i===7?'qa-other-space':space,spaceScopeVersion:1,createdAt:admin.firestore.Timestamp.now(),updatedAt:admin.firestore.Timestamp.now()};
  rows[`businesses/${bid}/productFinancials/${id}`]={id,productId:id,businessId:bid,custo:0};
 }
 const batch=db.batch();for(const [p,v] of Object.entries(rows))batch.set(db.doc(p),v);await batch.commit();
}
async function main(){
 await seed();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage(),errors=[];
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',r=>{const u=new URL(r.url());if(/googleapis\.com|cloudfunctions\.net|\.run\.app/.test(u.hostname)&&u.hostname!=='fonts.googleapis.com')return r.abort();r.continue();});
  await page.setViewport({width:390,height:900,isMobile:true,hasTouch:true});await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#login-form');await page.type('[name=email]',email);await page.type('[name=password]',password);await page.click('#login-submit');
  await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden,{timeout:60000});await pause(1800);
  await page.evaluate(()=>SyncFirebase.synchronizeNow());
  if(await page.$('.operation-flow [data-operation-next]')){await page.click('.operation-flow [data-operation-next]');await page.click('.operation-flow [data-operation-next]');}
  await page.evaluate(space=>{SpaceContext.selectHome(space);document.querySelector('#modal').innerHTML='';Router.ir('produtos');},space);
  await page.waitForSelector('[data-product-spreadsheet]');await pause(600);
  await page.click('[data-product-spreadsheet]');await page.waitForFunction(()=>!document.querySelector('[data-sheet-export]').disabled,{timeout:30000});
  assert.match(await page.$eval('[data-sheet-context]',e=>e.textContent),/7 produtos/);
  await page.screenshot({path:path.join(output,'390-actions.png'),fullPage:true});
  // Real browser worker/export and actual download; no authored spreadsheet substitute.
  const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await page.click('[data-sheet-export]');await page.waitForFunction(()=>document.querySelector('[data-sheet-status]').textContent.includes('exportados'));
  await pause(500);const XLSX=require('../assets/xlsx-0.20.3.full.min.js'),exported=fs.readdirSync(output).find(f=>f.startsWith('produtos-veconi')&&f.endsWith('.xlsx'));
  assert.ok(exported);const workbook=XLSX.read(fs.readFileSync(path.join(output,exported))),table=XLSX.utils.sheet_to_json(workbook.Sheets.Produtos,{header:1,defval:null});
  assert.equal(table.length,8);assert.equal(table[1][1],'000');assert.ok(!table.some(row=>row[0]==='qa-product-7'));
  table[1][5]='8,50';table[1][6]='19.90';table[1][7]=3;
  table[2][6]='inválido';table.push(['missing',null,null,'Ausente',null,null,25,null]);
  workbook.Sheets.Produtos=XLSX.utils.aoa_to_sheet(table);const importPath=path.join(output,'qa-import.xlsx');fs.writeFileSync(importPath,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
  await (await page.$('[data-sheet-file]')).uploadFile(importPath);await page.waitForSelector('.product-sheet-rows');
  assert.equal((await db.doc(`businesses/${bid}/products/qa-product-0`).get()).data().preco,15);
  assert.equal(await page.$$eval('.is-invalid',e=>e.length),1);
  await page.screenshot({path:path.join(output,'390-preview.png'),fullPage:true});
  for(const width of [320,360,375,390,412,430,1440]){
   await page.setViewport({width,height:900,isMobile:true,hasTouch:true});await pause(100);
   const fit=await page.$eval('.product-spreadsheet-modal',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1});assert.ok(fit,'Modal overflow '+width);
  }
  await page.setViewport({width:390,height:900,isMobile:true,hasTouch:true});
  await page.$eval('[data-sheet-confirm]',b=>{b.click();b.click();});await page.waitForFunction(()=>document.querySelector('[data-sheet-status]').textContent.includes('Concluído'),{timeout:45000});
  assert.match(await page.$eval('[data-sheet-status]',e=>e.textContent),/1 produtos atualizados; 0 falhas/);
  assert.equal((await db.doc(`businesses/${bid}/products/qa-product-0`).get()).data().preco,19.9);
  assert.equal((await db.doc(`businesses/${bid}/productFinancials/qa-product-0`).get()).data().custo,8.5);
  assert.equal((await db.collection(`businesses/${bid}/stockMovements`).get()).size,1);
  await page.screenshot({path:path.join(output,'390-success.png'),fullPage:true});
  await page.click('footer [data-sheet-close]');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.FirebaseBootstrap?.authenticated&&document.querySelector('#auth-gate')?.hidden&&window.BusinessContext?.get?.().role==='owner',{timeout:60000,polling:100});
  await page.evaluate(()=>Router.ir('produtos'));await page.waitForSelector('[data-product-spreadsheet]');
  await page.setViewport({width:1440,height:1000,isMobile:true,hasTouch:true});await page.evaluate(()=>Router.ir('home'));await page.evaluate(()=>Router.ir('produtos'));await page.waitForSelector('[data-product-spreadsheet]');
  await page.screenshot({path:path.join(output,'1440-products.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,cloudWrites:'emulator only',exportScoped:7,leadingZeros:true,previewZeroWrites:true,confirmed:1,stockMovements:1,doubleClick:true,widths:[320,360,375,390,412,430,1440],reload:true,physicalAndroid:false}));
 }catch(e){console.error(await page.evaluate(()=>({auth:window.FirebaseBootstrap?.state,authenticated:window.FirebaseBootstrap?.authenticated,gateHidden:document.querySelector('#auth-gate')?.hidden,role:window.BusinessContext?.get?.().role})));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw e;}
 finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
