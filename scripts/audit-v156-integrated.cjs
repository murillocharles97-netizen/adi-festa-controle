// Full app smoke against local Auth/Firestore/Functions emulators only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),puppeteer=require('puppeteer');
if(!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!/^(127\.0\.0\.1|localhost):/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST||''))throw Error('Local emulators required; refusing production.');
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'adi-festa-variations-test'});
const db=admin.firestore(),businessId='qa-v156-integrated',spaceId='business_qa-v156-integrated',email='v156-owner@example.test',password='LocalQa123!';
const root=process.cwd(),results=[],errors=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  if(pathname==='/js/firebase/firebase-config.js'){
    let source=fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test');
    source=source.replace('getAuth, setPersistence','connectAuthEmulator, getAuth, setPersistence').replace('initializeFirestore, memoryLocalCache','connectFirestoreEmulator, initializeFirestore, memoryLocalCache').replace('getFunctions, httpsCallable','connectFunctionsEmulator, getFunctions, httpsCallable');
    source=source.replace('export const auth=getAuth(app);',"export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});");
    source=source.replace('export const db=initializeFirestore(app,{localCache:memoryLocalCache()});',"export const db=initializeFirestore(app,{localCache:memoryLocalCache()});connectFirestoreEmulator(db,'127.0.0.1',8080);");
    source=source.replace("export const functions=getFunctions(app,'southamerica-east1');","export const functions=getFunctions(app,'southamerica-east1');connectFunctionsEmulator(functions,'127.0.0.1',5001);");
    return res.end(source);
  }
  if(pathname==='/js/firebase/sync.js')return res.end(fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test'));
  fs.createReadStream(file).pipe(res);
});
async function seed(){
  let user;try{user=await admin.auth().getUserByEmail(email)}catch{user=await admin.auth().createUser({email,password})}
  const uid=user.uid,at=admin.firestore.Timestamp.now();
  const values={
    [`users/${uid}`]:{uid,name:'Owner QA V156',email,businessId,active:true,role:'owner',tutorialVersionSeen:999},
    [`businesses/${businessId}`]:{id:businessId,name:'V156 QA',ownerId:uid,active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}},
    [`financialSpaces/${spaceId}`]:{id:spaceId,name:'Loja QA',type:'business',businessId,linkedBusinessId:businessId,ownerUid:uid,active:true,status:'active'},
    [`businesses/${businessId}/settings/default`]:{id:'default',nome:'V156 QA',businessId,updatedAt:at,operation:{operationMode:'physical_store',creditMode:'enabled',operationOnboardingCompleted:true,modules:{inventory:true,crm:true,creditSales:true}}},
    [`businesses/${businessId}/products/qa-product`]:{id:'qa-product',businessId,nome:'Produto QA',preco:14,ativo:true,active:true,itemKind:'service',semControleEstoque:true,controlaEstoque:false,estoqueAtual:0,spaceAccessMode:'all_spaces',allowedSpaceIds:[],createdAt:at,updatedAt:at},
  };
  for(let i=1;i<=3;i++)values[`businesses/${businessId}/clients/qa-c${i}`]={id:`qa-c${i}`,businessId,nome:`Cliente QA ${i}`,telefone:`1799999000${i}`,saldo:-100,financialVersion:1,ativo:true,active:true,createdAt:at,updatedAt:at};
  const batch=db.batch();for(const [key,value]of Object.entries(values))batch.set(db.doc(key),value);await batch.commit();return uid;
}
async function main(){
  const uid=await seed();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const base=`http://127.0.0.1:${server.address().port}`,page=await browser.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    async function configure(p){
      await p.setRequestInterception(true);p.on('request',r=>{const u=new URL(r.url());if(/googleapis\.com|cloudfunctions\.net|\.run\.app/.test(u.hostname)&&!['fonts.googleapis.com'].includes(u.hostname))return r.abort();return r.continue()});
      p.on('pageerror',e=>{errors.push(e.message);console.log('[PAGE ERROR]',e.stack)});p.on('console',m=>{if(m.type()==='error')console.log('[browser]',m.text().slice(0,320))});
      await p.evaluateOnNewDocument(()=>{window.__qaOpened=[];window.open=url=>{__qaOpened.push(url);return {opener:null}}});
    }
    async function login(p){await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('#login-form',{timeout:30000});await p.type('#login-form [name=email]',email);await p.type('#login-form [name=password]',password);await p.click('#login-form .btn-primary');await p.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized',{timeout:45000});await p.waitForFunction(()=>window.SpaceContext?.list?.().length>0,{timeout:20000});await p.evaluate(()=>{document.querySelector('#modal').innerHTML='';window.SpaceContext?.select?.('sales','business_qa-v156-integrated')});}
    await configure(page);await login(page);results.push('owner login / active membership / all spaces');
    let sync=await page.evaluate(()=>SyncFirebase.synchronizeNow());assert.equal(sync.dataSynced,true);assert.equal(sync.integrityStatus,'completed');
    const route=async name=>{await page.evaluate(name=>{document.querySelector('#modal').innerHTML='';Router.ir(name)},name);await page.waitForFunction(name=>document.querySelector('#app')?.dataset.route===name,{},name);await page.waitForFunction(()=>!document.querySelector('#app .boot-recovery'));};
    await route('inicio');await route('vender');
    // Real sale/payment pipeline, Rules and durable storage; no real business data.
    const sale=await page.evaluate(async({spaceId})=>{
      await SyncFirebase.prepareCustomerForSale('qa-c1');
      const s=Vendas.registrar({id:'qa-credit-v156',operationId:'qa-credit-v156',spaceId,clienteId:'qa-c1',status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoOriginal:14,precoFinalUnitario:14}]});
      await DB.flush();await SyncFirebase.confirmCreditSale(s);return {id:s.id,balance:Clientes.obter('qa-c1').saldo};
    },{spaceId});assert.equal(sale.balance,-114);results.push('Home / Vender / credit sale durable and confirmed');
    await route('clientes');
    const payment=await page.evaluate(async()=>{const p=Fiados.receber('qa-c1',10,'QA emulator',{operationId:'qa-payment-v156'});await DB.flush();await SyncFirebase.synchronizeNow();return {id:p.id,balance:Clientes.obter('qa-c1').saldo}});assert.equal(payment.balance,-104);results.push('Clientes / Receber / cloud balance');
    await page.evaluate(()=>MobileMessages.openCenter());await page.waitForSelector('[data-center-start]');await page.click('[data-center-start]');
    for(let n=0;n<3;n++){
      await page.waitForSelector('#sequence-send');await page.click('#sequence-send');await page.waitForSelector('[data-sequence-open]');await page.click('[data-sequence-open]');
      await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('pageshow'));dispatchEvent(new Event('focus'))});
      await page.waitForSelector('[data-sequence-confirm]');await page.click('[data-sequence-confirm]');
      await page.waitForFunction(async expected=>(await MessageSequence.active())?.currentIndex===expected||expected===3&&(await MessageSequence.active())===null,{},n+1);
    }
    assert.equal(await page.evaluate(()=>MessageSequence.history().length),3);results.push('Central: 3 contacts / mocked WhatsApp / return / explicit confirmation / next');
    await page.evaluate(()=>{document.querySelector('#modal').innerHTML='';return MobileMessages.openComposer('qa-c1',{allowRepeat:true})});await page.waitForSelector('#message-send');await page.click('#message-send');await page.waitForSelector('[data-charge-send-continue]');await page.click('[data-charge-send-continue]');await page.evaluate(()=>DB.flush());
    assert.equal(await page.evaluate(()=>DB.carregar().messageHistory.filter(m=>m.source==='individual').length),1);assert.ok(await page.evaluate(()=>__qaOpened.length>=4));results.push('individual WhatsApp canonical balance / durable record');
    await page.evaluate(()=>SyncFirebase.synchronizeNow());
    // Separate browser context = separate device storage; same emulator business.
    const secondContext=await browser.createBrowserContext(),desktop=await secondContext.newPage();await desktop.setViewport({width:1440,height:900});await configure(desktop);await login(desktop);await desktop.evaluate(()=>SyncFirebase.synchronizeNow());
    assert.equal(await desktop.evaluate(()=>Clientes.obter('qa-c1').saldo),-104);
    await desktop.evaluate(async()=>{Clientes.salvar({...Clientes.obter('qa-c2'),observacoes:'QA second device'});await DB.flush();await SyncFirebase.synchronizeNow()});
    await page.evaluate(()=>SyncFirebase.synchronizeNow());assert.equal(await page.evaluate(()=>Clientes.obter('qa-c2').observacoes),'QA second device');results.push('two isolated devices converge both directions');
    await route('financeiro');await route('historico');await route('equipe');
    await page.waitForSelector('[data-team-add]');await page.click('[data-team-add]');await page.waitForSelector('.team-modal');await page.click('.team-modal [data-team-close]');await page.click('[data-team-add]');await page.waitForSelector('.team-modal');await page.click('.team-modal [data-team-close]');results.push('Financeiro / Histórico / Equipe / modal cancel-reopen');
    await page.evaluate(async()=>{await DB.flush()});await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized',{timeout:45000});
    assert.equal(await page.evaluate(()=>FirebaseSession.user.uid),uid);assert.equal(await page.evaluate(()=>DB.carregar().clientes.find(c=>c.id==='qa-c1').saldo),-104);results.push('reload session and financial cache preserved');
    const diagnostic=await page.evaluate(()=>SyncFirebase.exportLocalDiagnostic());assert.equal(diagnostic.storage.backend,'IndexedDB');
    assert.equal((await db.doc(`businesses/${businessId}/clients/qa-c1`).get()).data().saldo,-104);
    if(errors.length)throw Error(errors.join(' | '));
    console.log(JSON.stringify({ok:true,results,queue:diagnostic.queueCounts,storage:diagnostic.storage.backend,physicalAndroid:'pending user test',realWhatsApp:'not sent'},null,2));
  }finally{await browser.close();server.close();await admin.app().delete()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
