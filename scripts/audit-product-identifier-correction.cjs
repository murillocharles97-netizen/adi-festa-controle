'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):/.test(process.env[key]||''))throw Error('Local emulators required. Production forbidden.');
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'adi-festa-variations-test'});
const suffix=Date.now().toString(36),db=admin.firestore(),bid='qa-skufix-'+suffix,email='skufix-'+suffix+'@example.test',password='LocalQa123!',space='qa-skufix-space-'+suffix;
const root=process.cwd(),output=path.resolve('qa-artifacts/product-identifier-correction'),pause=ms=>new Promise(r=>setTimeout(r,ms));fs.mkdirSync(output,{recursive:true});
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
});// V239 "Corrigir SKU/EAN" — fictitious products only, local emulators only.
async function seed(){
 let user;try{user=await admin.auth().getUserByEmail(email);}catch{user=await admin.auth().createUser({email,password});}const {uid}=user;
 const rows={
  ['users/'+uid]:{uid,email,name:'Owner QA',businessId:bid,active:true,role:'owner',tutorialVersions:{appIntro:1},tutorialVersionSeen:999},
  ['businesses/'+bid]:{id:bid,ownerId:uid,name:'Cosméticos QA',active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}},
  ['businesses/'+bid+'/members/'+uid]:{uid,email,name:'Owner QA',status:'active',role:'owner',spaceAccess:'all',allowedSpaceIds:[],schemaVersion:1,permissions:require('../functions/src/services/team-access-service').ROLE_PRESETS.owner},
  ['businesses/'+bid+'/settings/default']:{id:'default',nome:'Cosméticos QA',businessId:bid,onboardingCompleted:true,demonstracaoRemovida:true},
  ['financialSpaces/'+space]:{id:space,name:'Loja QA',type:'business',businessId:bid,linkedBusinessId:bid,ownerUid:uid,active:true,operationalType:'unit',capabilities:{finance:true,sales:true,products:true,inventory:true,goals:true}},
 };
 const items=[['qa-batom','Batom Matte QA','SKU-ERRADO','7890000000011'],['qa-base','Base Líquida QA','BASE-01','7890000000099'],['qa-rimel','Rímel QA','X1','111'],
  ['qa-gloss-a','Gloss Rosa QA','GLOSS-A','7891111111111'],['qa-gloss-b','Gloss Nude QA','GLOSS-B','7891111111111'],['qa-po','Pó Compacto QA','PO-01','7893333333333']];
 for(const [id,nome,codigo,barcode] of items){
  rows[`businesses/${bid}/products/${id}`]={id,businessId:bid,nome,codigo,barcode,categoria:'QA',preco:15,estoqueAtual:5,estoque:5,ativo:true,controlaEstoque:true,semControleEstoque:false,itemKind:'product',productType:'simple',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1,createdAt:admin.firestore.Timestamp.now(),updatedAt:admin.firestore.Timestamp.now()};
  rows[`businesses/${bid}/productFinancials/${id}`]={id,productId:id,businessId:bid,custo:4};
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
  await page.waitForFunction(()=>window.ProductSpreadsheetUI);await pause(600);
  await page.evaluate(()=>ProductSpreadsheetUI.open());await page.waitForFunction(()=>!document.querySelector('[data-sheet-export]').disabled,{timeout:30000});
  const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  await page.click('[data-sheet-export]');await page.waitForFunction(()=>document.querySelector('[data-sheet-status]').textContent.includes('exportados'));
  await pause(500);const XLSX=require('../assets/xlsx-0.20.3.full.min.js'),exported=fs.readdirSync(output).filter(f=>f.startsWith('produtos-veconi')&&f.endsWith('.xlsx')).sort((a,b)=>fs.statSync(path.join(output,b)).mtimeMs-fs.statSync(path.join(output,a)).mtimeMs)[0];
  const workbook=XLSX.read(fs.readFileSync(path.join(output,exported))),table=XLSX.utils.sheet_to_json(workbook.Sheets.Produtos,{header:1,defval:null});
  const at=id=>table.findIndex(r=>r[0]===id);
  table[at('qa-batom')][1]='BAT-001';                                         // SKU wrong -> right
  table[at('qa-base')][2]='7890000000028';                                    // EAN wrong -> right (but competes with pó below)
  table[at('qa-rimel')][1]='RIM-001';table[at('qa-rimel')][2]='7890000000035'; // both
  table[at('qa-gloss-a')][2]='7891111111128';                                 // split a duplicated EAN
  table[at('qa-po')][2]='7890000000028';table[at('qa-po')][6]=99;              // same new EAN as base -> conflict; price ignored
  table.push([null,'SEM-ID',null,'Linha sem ID',null,null,null,null]);
  table.push(['id-inexistente','GHOST',null,'Fantasma',null,null,null,null]);
  workbook.Sheets.Produtos=XLSX.utils.aoa_to_sheet(table);const importPath=path.join(output,'qa-identifiers.xlsx');fs.writeFileSync(importPath,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
  await page.select('[data-sheet-mode]','identifiers');
  await (await page.$('[data-sheet-file]')).uploadFile(importPath);await page.waitForSelector('[data-sheet-ack]');
  assert.equal(await page.$eval('[data-sheet-confirm]',b=>b.disabled),true,'confirm requires acknowledgement');
  assert.equal(await page.$$eval('.product-sheet-rows .is-update',e=>e.length),3,'batom, rimel, gloss-a');
  assert.equal((await db.doc(`businesses/${bid}/products/qa-batom`).get()).data().codigo,'SKU-ERRADO','preview writes nothing');
  for(const [width,height,mobile] of [[360,780,true],[390,900,true]]){
   await page.setViewport({width,height,isMobile:mobile,hasTouch:mobile});await pause(150);
   assert.ok(await page.$eval('.product-spreadsheet-modal',e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;}),'overflow '+width);
   await page.screenshot({path:path.join(output,`${width}-preview.png`)});
   await page.$eval('.product-sheet-ack',e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,`${width}-preview-rows.png`)});
  }
  await page.setViewport({width:390,height:900,isMobile:true,hasTouch:true});
  await page.click('[data-sheet-ack]');assert.equal(await page.$eval('[data-sheet-confirm]',b=>b.disabled),false);
  await page.$eval('[data-sheet-confirm]',b=>{b.click();b.click();});
  await page.waitForFunction(()=>/Concluído na nuvem|Não concluído/.test(document.querySelector('[data-sheet-status]').textContent),{timeout:60000});
  const statusText=await page.$eval('[data-sheet-status]',e=>e.textContent);console.log(statusText);
  assert.match(statusText,/Concluído na nuvem: 3 corrigidos/);
  const p=async id=>(await db.doc(`businesses/${bid}/products/${id}`).get()).data();
  assert.equal((await p('qa-batom')).codigo,'BAT-001');assert.equal((await p('qa-base')).barcode,'7890000000099');
  assert.deepEqual([(await p('qa-rimel')).codigo,(await p('qa-rimel')).barcode],['RIM-001','7890000000035']);
  assert.equal((await p('qa-gloss-a')).barcode,'7891111111128');assert.equal((await p('qa-gloss-b')).barcode,'7891111111111');
  assert.equal((await p('qa-po')).preco,15);
  for(const id of ['qa-batom','qa-rimel'])assert.equal((await p(id)).estoqueAtual,5);
  assert.equal((await db.collection(`businesses/${bid}/stockMovements`).get()).size,0);
  assert.equal((await db.collection(`businesses/${bid}/products`).get()).size,6);
  assert.equal(await page.evaluate(()=>Produtos.obter('qa-batom')?.codigo),'BAT-001','device refreshed before success');
  for(const [width,height,mobile] of [[390,900,true]]){await page.setViewport({width,height,isMobile:mobile,hasTouch:mobile});await pause(150);await page.screenshot({path:path.join(output,`${width}-result.png`)});}
  // Desktop: the app swaps layouts (closing modals), so reopen at 1366 px.
  await page.click('footer [data-sheet-close]');await page.setViewport({width:1366,height:900});await pause(1500);
  // Re-import the same sheet: what was applied now shows as unchanged.
  await page.evaluate(()=>ProductSpreadsheetUI.open());await page.waitForFunction(()=>!document.querySelector('[data-sheet-file]')?.disabled);
  await page.select('[data-sheet-mode]','identifiers');await (await page.$('[data-sheet-file]')).uploadFile(importPath);await page.waitForSelector('[data-sheet-ack]');
  assert.equal(await page.$$eval('.product-sheet-rows .is-update',e=>e.length),0,'base vs pó still compete; the rest is unchanged');
  assert.equal(await page.$$eval('.product-sheet-rows .is-unchanged',e=>e.length),4);
  assert.ok(await page.$eval('.product-spreadsheet-modal',e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:path.join(output,'1366-reimport.png')});await page.$eval('.product-sheet-ack',e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(output,'1366-reimport-rows.png')});
  // Regular import still works after the correction: price update through the Sync queue.
  await page.click('footer [data-sheet-close]');await page.evaluate(()=>ProductSpreadsheetUI.open());await page.waitForFunction(()=>!document.querySelector('[data-sheet-file]')?.disabled);
  const regular=[table[0],['qa-batom',null,null,null,null,null,21,null]],rbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(rbook,XLSX.utils.aoa_to_sheet(regular),'Produtos');
  const rpath=path.join(output,'qa-regular.xlsx');fs.writeFileSync(rpath,XLSX.write(rbook,{type:'buffer',bookType:'xlsx'}));
  await (await page.$('[data-sheet-file]')).uploadFile(rpath);await page.waitForSelector('.product-sheet-rows .is-update');
  await page.$eval('[data-sheet-confirm]',b=>b.click());await page.waitForFunction(()=>document.querySelector('[data-sheet-status]').textContent.includes('Concluído'),{timeout:60000});
  for(let i=0;i<30&&(await db.doc(`businesses/${bid}/products/qa-batom`).get()).data().preco!==21;i++)await pause(500);
  const batom=(await db.doc(`businesses/${bid}/products/qa-batom`).get()).data();assert.equal(batom.preco,21);assert.equal(batom.codigo,'BAT-001');assert.equal(batom.estoqueAtual,5);
  assert.deepEqual(errors,[]);console.log('OK identifier correction audit',output);
 }catch(e){console.error('DIAG',await page.evaluate(()=>({status:document.querySelector('[data-sheet-status]')?.textContent,error:document.querySelector('[data-sheet-error]')?.textContent,queue:(window.SyncFirebase?.getQueueDiagnostics?.()||[]).map(i=>[i.category,i.subtype,i.status])})).catch(x=>x.message),errors);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
 finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exit(1);});
