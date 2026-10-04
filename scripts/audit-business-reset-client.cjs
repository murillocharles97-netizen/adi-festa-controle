'use strict';
// Real application + two isolated browsers + Admin reset service. Local only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),puppeteer=require('puppeteer');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])
  if(!/^(127\.0\.0\.1|localhost):/.test(process.env[key]||''))throw Error(`Local ${key} required; production is forbidden.`);
const admin=require('../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'adi-festa-variations-test',storageBucket:'adi-festa-variations-test.appspot.com'});
const {businessResetService}=require('../functions/src/services/business-reset-service');
const db=admin.firestore(),businessId='qa-reset-client',spaceId=`business_${businessId}`,email='reset-client@example.test',password='LocalQa123!';
const root=process.cwd(),results=[],errors=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
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
  const user=await admin.auth().createUser({email,password}),uid=user.uid,at=admin.firestore.Timestamp.now();
  const batch=db.batch();
  for(const [key,value]of Object.entries({
    [`users/${uid}`]:{uid,email,name:'Owner reset QA',businessId,active:true,role:'owner',tutorialVersionSeen:999},
    [`businesses/${businessId}`]:{id:businessId,slug:businessId,name:'Reset QA',ownerId:uid,active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'},limits:{}},
    [`financialSpaces/${spaceId}`]:{id:spaceId,name:'QA loja',type:'business',businessId,linkedBusinessId:businessId,ownerUid:uid,active:true,status:'active'},
    [`businesses/${businessId}/products/old-product`]:{id:'old-product',businessId,nome:'Produto de teste',preco:25,ativo:true,active:true,itemKind:'service',semControleEstoque:true,controlaEstoque:false,estoqueAtual:0,spaceAccessMode:'all_spaces',allowedSpaceIds:[],createdAt:at,updatedAt:at},
    [`businesses/${businessId}/clients/old-client`]:{id:'old-client',businessId,nome:'Cliente QA antigo',saldo:0,ativo:true,active:true,createdAt:at,updatedAt:at}
  }))batch.set(db.doc(key),value);
  await batch.commit();return uid;
}
async function main(){
  const uid=await seed();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const base=`http://127.0.0.1:${server.address().port}`,mobile=await browser.createBrowserContext(),desktop=await browser.createBrowserContext();
    async function pageFor(context,width){
      const page=await context.newPage();await page.setViewport({width,height:844,isMobile:width<600,hasTouch:width<600});
      await page.setRequestInterception(true);page.on('request',request=>{
        const url=new URL(request.url());
        if(/googleapis\.com|cloudfunctions\.net|\.run\.app/.test(url.hostname)&&url.hostname!=='fonts.googleapis.com')return request.abort();
        return request.continue();
      });
      page.on('pageerror',error=>{errors.push(error.message);console.error('[PAGE]',error.stack||error.message);});
      page.on('console',async message=>{if(message.type()==='error')console.error('[BROWSER]',message.text().slice(0,300),await Promise.all(message.args().map(arg=>arg.jsonValue().catch(()=>null))));});
      return page;
    }
    async function login(page){
      await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('#login-form');
      await page.type('[name=email]',email);await page.type('[name=password]',password);await page.click('#login-submit');
      await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized',{timeout:45000});
      await page.evaluate(()=>SyncFirebase.synchronizeNow());
      await page.waitForFunction(()=>DB.carregar().clientes.some(row=>row.id==='old-client'));
    }
    const a=await pageFor(mobile,390),b=await pageFor(desktop,1366);await login(a);await login(b);
    await a.setOfflineMode(true);
    await a.evaluate(async()=>{
      Clientes.salvar({nome:'Somente local antes do reset',telefone:'17999990001',saldo:0});
      await DB.flush();localStorage.setItem('PrimeDocs:qa-preserve','preserved');
    });
    await a.close();results.push('mobile closed with old offline cache/queue');
    // First-use tutorial is a separate overlay, above ordinary application modals.
    await b.waitForSelector('[data-tour-action="skip"]',{timeout:8000}).then(()=>b.click('[data-tour-action="skip"]')).catch(()=>{});
    assert.equal(await b.evaluate(async()=>{
      const original=window.FirebaseCallable;let resolve;
      try{
        window.FirebaseCallable=()=>new Promise(done=>{resolve=done;});
        WorkspaceResetUI.risk();document.querySelector('[data-reset-start]').click();
        document.querySelector('[data-reset-cancel]').click();resolve({data:{enabled:true}});
        await Promise.resolve();await Promise.resolve();return !document.querySelector('#modal').textContent;
      }finally{window.FirebaseCallable=original;}
    }),true);
    results.push('cancel while capability read is in flight never reopens confirmation');
    fs.mkdirSync(path.join(root,'artifacts/reset-ui'),{recursive:true});
    for(const width of [320,360,375,390,412,430]){
      await b.setViewport({width,height:844,isMobile:true,hasTouch:true});
      await new Promise(resolve=>setTimeout(resolve,350));
      await b.evaluate(()=>{document.querySelector('#modal').innerHTML='';WorkspaceResetUI.risk();});
      await b.waitForSelector('[data-reset-start]',{timeout:5000}).catch(async cause=>{console.error('RESET UI STATE',await b.evaluate(()=>({role:FirebaseSession?.member?.role,status:FirebaseSession?.member?.status,bootstrap:FirebaseBootstrap?.state,modal:document.querySelector('#modal').textContent.slice(0,160)})));throw cause;});
      await b.click('[data-reset-start]');await b.waitForSelector('[data-reset-continue]',{timeout:15000}).catch(async cause=>{
        console.error('RESET CAPABILITY UI',await b.evaluate(()=>({error:document.querySelector('[data-reset-error]')?.textContent,disabled:document.querySelector('[data-reset-start]')?.disabled,online:navigator.onLine,modal:document.querySelector('#modal')?.textContent.slice(0,800)})));
        await b.screenshot({path:path.join(root,'artifacts/reset-ui/failure.png')});throw cause;
      });
      assert.match(await b.$eval('[data-reset-retention]',node=>node.textContent),/não cria backup.*até 7 dias/);
      await b.click('[data-reset-continue]');
      await b.waitForSelector('[data-reset-form]');
      assert.match(await b.$eval('[data-reset-retention]',node=>node.textContent),/não cria backup.*até 7 dias/);
      assert.equal(await b.$eval('[data-reset-submit]',node=>node.disabled),true);
      assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await new Promise(resolve=>setTimeout(resolve,350));
      await b.screenshot({path:path.join(root,`artifacts/reset-ui/${width}-confirmation.png`)});
      await b.click('[data-reset-cancel]');
    }
    results.push('two confirmations and layout at 320/360/375/390/412/430');
    await b.evaluate(()=>WorkspaceResetUI.risk());await b.click('[data-reset-start]');await b.waitForSelector('[data-reset-continue]');await b.click('[data-reset-continue]');
    await b.type('[name=password]',password);await b.type('[name=confirmation]','RESETAR');
    await b.click('[data-reset-submit]');
    await b.waitForFunction(()=>window.WorkspaceRuntime?.isBlocked(),{timeout:15000});
    assert.equal(await b.evaluate(()=>WorkspaceRuntime.isBlocked()),true);
    assert.equal(await b.evaluate(()=>{try{DB.alterar(data=>data.clientes.push({id:'late-client'}));return false;}catch{return true;}}),true);
    results.push('existing business listener blocks desktop writes without signing out');
    await b.waitForSelector('[data-reset-setup]',{timeout:90000});
    await b.screenshot({path:path.join(root,'artifacts/reset-ui/completed.png')});
    assert.equal((await db.collection(`businesses/${businessId}/workspaceResetJobs`).get()).size,1);
    results.push('password reauthentication / owner callable / background worker / completed UI');
    const reopened=await pageFor(mobile,390);await reopened.goto(base,{waitUntil:'domcontentloaded'});
    await reopened.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized',{timeout:45000});
    await reopened.evaluate(()=>SyncFirebase.synchronizeNow());
    const state=await reopened.evaluate(()=>({uid:FirebaseSession.user.uid,businessId:FirebaseSession.businessId,generation:DB.getWorkspaceGeneration(),clients:DB.carregar().clientes.length,products:DB.carregar().produtos.length,sales:DB.carregar().vendas.length,otherApp:localStorage.getItem('PrimeDocs:qa-preserve'),pending:SyncFirebase.getFirebaseDiagnostic().pendingOperations}));
    assert.equal(state.uid,uid);assert.equal(state.businessId,businessId);assert.equal(state.generation,1);
    assert.equal(state.clients,0);assert.equal(state.products,0);assert.equal(state.sales,0);assert.equal(state.pending,0);assert.equal(state.otherApp,'preserved');
    assert.equal((await db.collection('financialSpaces').where('businessId','==',businessId).get()).size,0);
    assert.equal((await db.collection(`businesses/${businessId}/clients`).get()).size,0);
    assert.equal((await db.doc(`businesses/${businessId}`).get()).data().subscription.status,'active');
    assert.equal((await admin.auth().getUser(uid)).uid,uid);
    results.push('reopened mobile cleans old scoped cache/queue; no seed/default space; Auth and subscription preserved');
    await reopened.evaluate(async()=>{Clientes.salvar({nome:'Cliente da nova geração',telefone:'17999990002',saldo:0});await DB.flush();await SyncFirebase.synchronizeNow();});
    const clients=await db.collection(`businesses/${businessId}/clients`).get();
    assert.equal(clients.size,1);assert.equal(clients.docs[0].data().workspaceGeneration,1);
    results.push('new-generation client write reaches cloud exactly once');
    const createdSpace=await reopened.evaluate(()=>SpaceService.create({name:'Loja nova QA',operationalType:'unit'}));
    assert.equal((await db.doc(`financialSpaces/${createdSpace.id}`).get()).data().workspaceGeneration,1);
    results.push('explicit new space creation after reset');
    const commerce=await reopened.evaluate(async spaceId=>{
      SpaceContext.selectSales(spaceId);
      const product=Produtos.salvar({nome:'Produto pós-reset QA',preco:25,custo:10,estoqueAtual:10});
      await DB.flush();await SyncFirebase.synchronizeNow();
      const client=DB.carregar().clientes[0];
      await SyncFirebase.prepareCustomerForSale(client.id);
      const sale=Vendas.registrar({id:'qa-post-reset-credit',operationId:'qa-post-reset-credit',spaceId,clienteId:client.id,status:'fiado',formaPagamento:'fiado',itens:[{produtoId:product.id,quantidade:1,precoOriginal:25,precoFinalUnitario:25}]});
      await DB.flush();await SyncFirebase.confirmCreditSale(sale);
      const payment=Fiados.receber(client.id,10,'Recebimento pós-reset QA',{operationId:'qa-post-reset-payment'});
      await DB.flush();await SyncFirebase.synchronizeNow();
      return{clientId:client.id,productId:product.id,paymentId:payment.id,balance:Clientes.obter(client.id).saldo,stock:Produtos.obter(product.id).estoqueAtual};
    },createdSpace.id);
    assert.equal(commerce.balance,-15);assert.equal(commerce.stock,9);
    for(const [collection,id]of [['sales','qa-post-reset-credit'],['payments',commerce.paymentId],['clients',commerce.clientId],['products',commerce.productId]])
      assert.equal((await db.doc(`businesses/${businessId}/${collection}/${id}`).get()).data().workspaceGeneration,1);
    results.push('post-reset product / stock / credit sale / payment reach cloud under generation-one Rules');
    await reopened.evaluate(()=>Router.ir('financeiro'));
    await reopened.waitForFunction(()=>Boolean(window.FinancialSpaceService),{timeout:15000});
    const finance=await reopened.evaluate(async spaceId=>{
      await FinancialSpaceService.listSpaces({force:true});
      const account=await FinancialSpaceService.createFinancialAccount(spaceId,{name:'Conta QA nova',type:'cash',initialBalanceCents:10000,accessMode:'single_space'});
      const entries=await FinancialSpaceService.createEntry(spaceId,{description:'Despesa QA nova',amountCents:500,direction:'out',paidNow:true,paymentMethod:'cash',financialAccountId:account.id,financialAccountHomeSpaceId:spaceId});
      await FinancialSpaceService.saveFinancialView({id:'qa-new-view',name:'Visão nova',financialSpaceIds:[spaceId]});
      await FinancialSpaceService.saveFinancialView({id:'qa-new-view',name:'Visão atualizada',financialSpaceIds:[spaceId]});
      return{accountId:account.id,entryId:entries[0].id};
    },createdSpace.id);
    const account=(await db.doc(`financialSpaces/${createdSpace.id}/financialAccounts/${finance.accountId}`).get()).data();
    assert.equal(account.currentBalanceCents,9500);assert.equal(account.workspaceGeneration,1);
    assert.equal((await db.doc(`financialSpaces/${createdSpace.id}/entries/${finance.entryId}`).get()).data().workspaceGeneration,1);
    assert.equal((await db.doc(`financialViewProfiles/${uid}`).get()).data().profileRevision,2);
    results.push('post-reset financial account / expense transaction / versioned personal views');
    if(errors.length)throw Error(errors.join(' | '));
    console.log(JSON.stringify({ok:true,results,physicalAndroid:false,resetInitiation:'actual UI, callable and worker in local emulator'},null,2));
  }finally{await browser.close();server.close();await admin.app().delete();}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
